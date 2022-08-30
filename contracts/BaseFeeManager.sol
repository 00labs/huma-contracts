//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IFeeManager.sol";
import "./HumaConfig.sol";
import {BaseStructs as BS} from "./libraries/BaseStructs.sol";
import "hardhat/console.sol";

/**
 *
 */
contract BaseFeeManager is IFeeManager, Ownable {
    using BS for BS.CreditRecord;

    // Divider to convert BPS to percentage
    uint256 public constant BPS_DIVIDER = 10000;
    // Divider to get monthly interest rate from APR BPS. 10000 * 12
    uint256 public constant APR_BPS_DIVIDER = 120000;
    uint256 public constant SECONDS_IN_A_YEAR = 31536000;
    uint256 public constant SECONDS_IN_A_DAY = 86400;

    /// Part of platform fee, charged when a borrow happens as a flat amount of the pool token
    uint256 public frontLoadingFeeFlat;

    /// Part of platform fee, charged when a borrow happens as a % of the borrowing amount
    uint256 public frontLoadingFeeBps;

    /// Part of late fee, charged when a payment is late as a flat amount of the pool token
    uint256 public lateFeeFlat;

    /// Part of late fee, charged when a payment is late as % of the totaling outstanding balance
    uint256 public lateFeeBps;

    ///The min % of the outstanding principal to be paid in the statement for each each period
    uint256 public minPrincipalRateInBps;

    /**
     * @notice Computes the amuont to be offseted due to in-cycle drawdown or principal payment
     * @param _cr the credit record associated with the account associated with the drawdown/payment
     * @param amount the amount of the drawdown/payment that we are trying to compute correction
     * @dev Correction is used when there is change to the principal in the middle of the cycle
     * due to drawdown or principal payment. For a drawdown, principal goes up, the interest at
     * the end of cycle will be higher than the actual interest that should have been generated
     * since the balance was lower for a portion of the cycle. For drawdown, the correction is
     * negative to offset the over-count at the end of the cycle. It will be positive for
     * principal payment.
     */
    function calcCorrection(BS.CreditRecord memory _cr, uint256 amount)
        external
        view
        virtual
        override
        returns (uint256 correction)
    {
        // rounding to days
        uint256 timePassed = block.timestamp -
            (_cr.dueDate - _cr.intervalInDays * SECONDS_IN_A_DAY);
        uint256 numOfDays = timePassed / SECONDS_IN_A_DAY;
        uint256 remainder = timePassed % SECONDS_IN_A_DAY;
        if (remainder > 43200) numOfDays++;

        (amount * _cr.aprInBps * numOfDays * SECONDS_IN_A_DAY) /
            SECONDS_IN_A_YEAR /
            10000;

        return
            (amount * _cr.aprInBps * numOfDays * SECONDS_IN_A_DAY) /
            SECONDS_IN_A_YEAR /
            10000;
    }

    /**
     * @notice Computes the front loading fee including both the flat fee and percentage fee
     * @param _amount the borrowing amount
     * @return fees the amount of fees to be charged for this borrowing
     */
    function calcFrontLoadingFee(uint256 _amount)
        public
        virtual
        override
        returns (uint256 fees)
    {
        fees = frontLoadingFeeFlat;
        if (frontLoadingFeeBps > 0)
            fees += (_amount * frontLoadingFeeBps) / 10000;
    }

    /**
     * @notice Computes the late fee including both the flat fee and percentage fee
     * @param dueDate the due date of the payment
     * @param totalDue the amount that is due
     * @param totalBalance the total balance including amount due and unbilled principal
     * @return fees the amount of late fees to be charged
     * @dev Charges only if 1) there is outstanding due, 2) the due date has passed
     */
    function calcLateFee(
        uint256 dueDate,
        uint256 totalDue,
        uint256 totalBalance
    ) public view virtual override returns (uint256 fees) {
        if (block.timestamp > dueDate && totalDue > 0) {
            fees = lateFeeFlat;
            if (lateFeeBps > 0)
                fees += (totalBalance * lateFeeBps) / BPS_DIVIDER;
        }
    }

    /**
     * @notice Apply front loading fee, distribute the total amount to borrower, pool, & protocol
     * @param borrowAmount the amount of the borrowing
     * @param humaConfig address of the configurator
     * @return amtToBorrower the amount that the borrower can take
     * @return protocolFee the portion of the fee charged that goes to the protocol
     * @return poolIncome the portion of the fee charged that goes to the pool as income
     * @dev the protocol always takes a percentage of the total fee generated
     */
    function distBorrowingAmount(uint256 borrowAmount, address humaConfig)
        external
        virtual
        override
        returns (
            uint256 amtToBorrower,
            uint256 protocolFee,
            uint256 poolIncome
        )
    {
        // Calculate platform fee, which includes protocol fee and pool fee
        uint256 platformFees = calcFrontLoadingFee(borrowAmount);

        // Split the fee between treasury and the pool
        protocolFee =
            (uint256(HumaConfig(humaConfig).treasuryFee()) * borrowAmount) /
            10000;

        assert(platformFees >= protocolFee);

        poolIncome = platformFees - protocolFee;

        amtToBorrower = borrowAmount - platformFees;

        return (amtToBorrower, protocolFee, poolIncome);
    }

    /**
     * @notice Gets the current total due, fees and interest due, and payoff amount.
     * Because there is no "cron" kind of mechanism, it is possible that the account is behind
     * for multiple cycles due to a lack of activities. This function will traverse through
     * these cycles to get the most up-to-date due information.
     * @dev This is a view only function, it does not update the account status. It is used to
     * help the borrowers to get their balances without paying gases.
     * @dev the difference between totalDue and feesAndInterestDue is required principal payment
     * @dev payoffAmount is good until the next statement date. It includes the interest for the
     * entire current/new billing period. We will ask for allowance of the total payoff amount,
     * but if the borrower pays off before the next due date, we will subtract the interest saved
     * and only transfer an amount lower than the original payoff estimate.
     * @dev please note the first due date is set after the initial drawdown. All the future due
     * dates are computed by adding multiples of the payment interval to the first due date.
     * @param _cr the credit record associated the account
     * @return periodsPassed the number of billing periods has passed since the last statement.
     * If it is within the same period, it will be 0.
     * @return feesAndInterestDue the sum of fees and interest due. If multiple cycles have passed,
     * this amount is not necessarily the stotal fees and interest charged. It only returns the amount
     * that is due currently.
     * @return totalDue amount due in this period, it includes fees, interest, and min principal
     * @return payoffAmount amount for payoff. It includes totalDue, unbilled principal, and
     * interest for the final period.
     */
    function getDueInfo(BaseStructs.CreditRecord memory _cr)
        public
        view
        virtual
        override
        returns (
            uint256 periodsPassed,
            uint96 feesAndInterestDue,
            uint96 totalDue,
            uint96 payoffAmount,
            uint96 unbilledPrincipal
        )
    {
        // Directly returns if it is still within the current period
        if (block.timestamp <= _cr.dueDate) {
            // payoff amount includes 4 elements: 1) outstanding due 2) unbilled principal
            // 3) interest for the current period 4) correction generated due to borrowing
            // or payment happened past last due date (i.e. to be included in the next period)
            payoffAmount = uint96(
                // todo add a test for this code path
                int96(
                    _cr.totalDue +
                        _cr.unbilledPrincipal +
                        calcPayoffInterest(_cr)
                ) + _cr.correction
            );
            return (
                0,
                _cr.feesAndInterestDue,
                _cr.totalDue,
                payoffAmount,
                _cr.unbilledPrincipal
            );
        }

        // Computes how many billing periods have passed. 1+ is needed since Solidity always
        // round to zero. When it is exactly at a billing cycle, it is desirable to 1+ as well
        periodsPassed =
            1 +
            (block.timestamp - _cr.dueDate) /
            (_cr.intervalInDays * SECONDS_IN_A_DAY);

        /**
         * Loops through the cycles as we would generate statements for each cycle.
         * The logic for each iteration is as follows:
         * 1. Calcuate late fee if it is past due
         * 2. Add outstanding due amount to the unbilled principal as the new base for principal
         * 3. Calcuate interest for this new cycle using the new principal
         * 4. Incorporate outstanding correction for the first iteration. The correction shall
         *    reset after the first iteration, but cannot be udpated due to view only function.
         *    We will just ignore the correction for follow-on iterations.
         * 5. Calculate the principal due, and minus it from the unbilled principal amount
         */
        uint256 i;
        uint256 fees;
        uint256 interest;
        for (i = 0; i < periodsPassed; i++) {
            // step 1. late fee calculation
            if (_cr.totalDue > 0)
                fees = calcLateFee(
                    _cr.dueDate + i * _cr.intervalInDays * SECONDS_IN_A_DAY,
                    _cr.totalDue,
                    _cr.unbilledPrincipal + _cr.totalDue
                );

            // step 2. adding dues to principal
            _cr.unbilledPrincipal += _cr.totalDue;

            // step 3. computer interest
            interest =
                (_cr.unbilledPrincipal *
                    _cr.aprInBps *
                    _cr.intervalInDays *
                    SECONDS_IN_A_DAY) /
                SECONDS_IN_A_YEAR /
                BPS_DIVIDER;

            // step 4. incorporate correction
            // If r.correction is negative, its absolute value is guaranteed to be
            // no more than interest. Thus, the following statement is safe.
            // No correction after the 1st period since no drawdown is allowed
            // when there are outstanding late payments
            if (i == 0) interest = uint256(int256(interest) + _cr.correction);

            // step 5. compute principal due and adjust unbilled principal
            uint256 principalToBill = (_cr.unbilledPrincipal *
                minPrincipalRateInBps) / 10000;
            _cr.feesAndInterestDue = uint96(fees + interest);
            _cr.totalDue = uint96(fees + interest + principalToBill);
            _cr.unbilledPrincipal = uint96(
                _cr.unbilledPrincipal - principalToBill
            );
        }

        // todo add logic to make sure totalDue meets the min requirement.

        payoffAmount = uint96(
            _cr.unbilledPrincipal + _cr.totalDue + calcPayoffInterest(_cr)
        );

        // If passed final period, all principal is due
        if (periodsPassed >= _cr.remainingPeriods - 1)
            totalDue = uint96(payoffAmount);

        return (
            periodsPassed,
            _cr.feesAndInterestDue,
            _cr.totalDue,
            payoffAmount,
            _cr.unbilledPrincipal
        );
    }

    /**
     * @notice Sets the standard front loading and late fee policy for the fee manager
     * @param _frontLoadingFeeFlat flat fee portion of the front loading fee
     * @param _frontLoadingFeeBps a fee in the percentage of a new borrowing
     * @param _lateFeeFlat flat fee portion of the late
     * @param _lateFeeBps a fee in the percentage of the outstanding balance
     * @dev Only owner can make this setting
     */
    function setFees(
        uint256 _frontLoadingFeeFlat,
        uint256 _frontLoadingFeeBps,
        uint256 _lateFeeFlat,
        uint256 _lateFeeBps
    ) public virtual override onlyOwner {
        frontLoadingFeeFlat = _frontLoadingFeeFlat;
        frontLoadingFeeBps = _frontLoadingFeeBps;
        lateFeeFlat = _lateFeeFlat;
        lateFeeBps = _lateFeeBps;
    }

    /**
     * @notice Sets the min percentage of principal to be paid in each billing period
     * @param _minPrincipalRateInBps the min % in unit of bps. For example, 5% will be 500
     * @dev Only owner can make this setting
     * @dev This is a global limit of 5000 bps (50%).
     */
    function setMinPrincipalRateInBps(uint256 _minPrincipalRateInBps)
        external
        virtual
        override
        onlyOwner
    {
        require(_minPrincipalRateInBps < 5000, "RATE_TOO_HIGH");
        minPrincipalRateInBps = _minPrincipalRateInBps;
    }

    /**
     * @notice Gets the fee structure for the pool
     * @param _frontLoadingFeeFlat flat fee portion of the front loading fee
     * @param _frontLoadingFeeBps a fee in the percentage of a new borrowing
     * @param _lateFeeFlat flat fee portion of the late
     * @param _lateFeeBps a fee in the percentage of the outstanding balance
     */
    function getFees()
        public
        view
        virtual
        override
        returns (
            uint256 _frontLoadingFeeFlat,
            uint256 _frontLoadingFeeBps,
            uint256 _lateFeeFlat,
            uint256 _lateFeeBps
        )
    {
        return (
            frontLoadingFeeFlat,
            frontLoadingFeeBps,
            lateFeeFlat,
            lateFeeBps
        );
    }

    /**
     * @notice Calculates the interest for payoff. The amount is good until the next due date
     * @param _cr the credit record associated the account
     * @return payoffInterest the final period interest amount for the payoff
     */
    function calcPayoffInterest(BS.CreditRecord memory _cr)
        internal
        pure
        returns (uint96 payoffInterest)
    {
        // todo add a test to final interest calculation
        payoffInterest = uint96(
            ((_cr.unbilledPrincipal + _cr.totalDue - _cr.feesAndInterestDue) *
                _cr.aprInBps *
                _cr.intervalInDays *
                SECONDS_IN_A_DAY) /
                SECONDS_IN_A_YEAR /
                BPS_DIVIDER
        );
    }
}
