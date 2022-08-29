//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IFeeManager.sol";
import "./HumaConfig.sol";
import {BaseStructs as BS} from "./libraries/BaseStructs.sol";
import "hardhat/console.sol";

contract BaseFeeManager is IFeeManager, Ownable {
    using BS for BS.CreditRecord;

    // Divider to get monthly interest rate from APR BPS. 10000 * 12
    uint256 public constant BPS_DIVIDER = 10000;
    uint256 public constant APR_BPS_DIVIDER = 120000;
    uint256 public constant SECONDS_IN_A_YEAR = 31536000;
    uint256 public constant SECONDS_IN_A_DAY = 86400;

    // Platform fee, charged when a loan is originated
    uint256 public frontLoadingFeeFlat;
    uint256 public frontLoadingFeeBps;
    // Late fee, charged when the borrow is late for a pyament.
    uint256 public lateFeeFlat;
    uint256 public lateFeeBps;

    // The min percentage of principal to be paid each period for credit line
    uint256 public minPrincipalRateInBps;

    function setFees(
        uint256 _frontLoadingFeeFlat,
        uint256 _frontLoadingFeeBps,
        uint256 _lateFeeFlat,
        uint256 _lateFeeBps
    ) public onlyOwner {
        frontLoadingFeeFlat = _frontLoadingFeeFlat;
        frontLoadingFeeBps = _frontLoadingFeeBps;
        lateFeeFlat = _lateFeeFlat;
        lateFeeBps = _lateFeeBps;
    }

    /**
     * @notice Sets the min and max of each loan/credit allowed by the pool.
     */
    function setMinPrincipalRateInBps(uint256 _minPrincipalRateInBps)
        external
        onlyOwner
    {
        require(_minPrincipalRateInBps < 5000, "RATE_TOO_HIGH");
        minPrincipalRateInBps = _minPrincipalRateInBps;
    }

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

    function calcLateFee(
        uint256 dueDate,
        uint256 totalDue,
        uint256 totalBalance
    ) public view virtual override returns (uint256 fees) {
        if (block.timestamp >= dueDate && totalDue > 0) {
            fees = lateFeeFlat;
            if (lateFeeBps > 0)
                fees += (totalBalance * lateFeeBps) / BPS_DIVIDER;
        }
    }

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
     * @notice Gets the current total due, fees and interest due, and payoff amount
     * @dev the difference between totalDue and feesAndInterestDue is required principal payment
     * @dev payoffAmount is good until the next statement date. It includes the interest for the
     * entire current/new billing period.
     * @return periodsPassed the number of billing periods has passed since the last statement
     * @return feesAndInterestDue the sum of fees and interest charged in this period
     * @return totalDue amount due in this period, it includes fees, interest, and min principal
     * @return payoffAmount amount for payoff. It includes totalDue, unbilled principal, and
     * interest for the final period
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
        // Without a cron job, the user may have missed multiple payments.
        if (block.timestamp < _cr.dueDate) {
            payoffAmount = uint96(
                int96(
                    _cr.feesAndInterestDue +
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

        periodsPassed =
            1 +
            (block.timestamp - _cr.dueDate) /
            (_cr.intervalInDays * SECONDS_IN_A_DAY);

        uint256 i;
        uint256 fees;
        uint256 interest;
        for (i = 0; i < periodsPassed; i++) {
            if (_cr.totalDue > 0)
                fees = calcLateFee(
                    _cr.dueDate + i * _cr.intervalInDays * SECONDS_IN_A_DAY,
                    _cr.totalDue,
                    _cr.unbilledPrincipal + _cr.totalDue
                );

            _cr.unbilledPrincipal += _cr.totalDue;
            interest =
                (_cr.unbilledPrincipal *
                    _cr.aprInBps *
                    _cr.intervalInDays *
                    SECONDS_IN_A_DAY) /
                SECONDS_IN_A_YEAR /
                BPS_DIVIDER;

            // If r.correction is negative, its absolute value is guaranteed to be
            // no more than interest. Thus, the following statement is safe.
            // No correction after the 1st period since no drawdown is allowed
            // when there are outstanding late payments
            if (i == 0) interest = uint256(int256(interest) + _cr.correction);

            uint256 principalToBill = (_cr.unbilledPrincipal *
                minPrincipalRateInBps) / 10000;
            _cr.feesAndInterestDue = uint96(fees + interest);
            _cr.totalDue = uint96(fees + interest + principalToBill);
            _cr.unbilledPrincipal = uint96(
                _cr.unbilledPrincipal - principalToBill
            );
            // todo add logic to make sure totalDue meets the min requirement.
        }

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

    // The payoff amount is good until the due date.
    // todo add a test to final interest calculation
    function calcPayoffInterest(BS.CreditRecord memory _cr)
        internal
        pure
        returns (uint96 payoffInterest)
    {
        payoffInterest = uint96(
            ((_cr.unbilledPrincipal + _cr.totalDue - _cr.feesAndInterestDue) *
                _cr.aprInBps *
                _cr.intervalInDays *
                SECONDS_IN_A_DAY) /
                SECONDS_IN_A_YEAR /
                BPS_DIVIDER
        );
    }

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

    /// returns the four fields for fees. The last two fields are unused. Kept it for compatibility.
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

    function getRecurringPayment(BaseStructs.CreditRecord memory _cr)
        external
        pure
        virtual
        override
        returns (uint256 amount)
    {
        // todo implement this
        return _cr.totalDue;
    }
}
