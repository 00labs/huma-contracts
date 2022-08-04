//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

import "./HumaConfig.sol";
import "./BasePool.sol";
import "./HDT/HDT.sol";
import "./interfaces/ICredit.sol";
import "./interfaces/IPoolLocker.sol";
import "./interfaces/IReputationTracker.sol";
import "./libraries/SafeMathInt.sol";
import "./libraries/SafeMathUint.sol";

import "hardhat/console.sol";

contract BaseCredit is ICredit, BasePool {
    // Divider to get monthly interest rate from APR BPS. 10000 * 12
    uint256 public constant BPS_DIVIDER = 120000;

    using SafeERC20 for IERC20;

    // The primary mapping of the status of the credit.
    mapping(address => CreditStatus) internal creditStateMapping;
    mapping(address => CreditInfo) internal creditInfoMapping;
    mapping(address => CreditFeeStructure) internal creditFeesMapping;

    /**
     * @notice CreditInfo stores the overall info about a loan.
     * @dev amounts are stored in uint32, all counts are stored in uint16
     * @dev all fields in CreditInfo will not change after initialization.
     * @dev each struct can have no more than 13 elements. Some fields
     * are stored in CreditStatus because of space limitation.
     */
    struct CreditInfo {
        // fields related to the overall picture of the loan
        address collateralAsset;
        uint32 collateralAmt;
        uint32 loanAmt;
        uint16 numOfPayments;
        bool deleted;
        uint256 collateralParam;
    }

    struct CreditFeeStructure {
        uint16 apr_in_bps; // interest rate in bps
        uint16 platform_fee_flat;
        uint16 platform_fee_bps;
        uint16 late_fee_flat;
        uint16 late_fee_bps;
        uint16 early_payoff_fee_flat;
        uint16 early_payoff_fee_bps;
        bool deleted;
    }

    /**
     * @notice CreditStatus tracks the state such as how much has been paid,
     * how many payments are remaining.
     * @dev most fields in LaonState change as the borrower pays back
     */
    struct CreditStatus {
        uint48 nextDueDate;
        uint32 nextAmtDue;
        uint32 remainingPrincipal; // remaining principal balance
        uint16 remainingPayments;
        uint16 paymentInterval; // in days
        uint48 lastLateFeeTimestamp;
        uint32 feesDue;
        CreditState state;
        bool deleted;
    }

    enum CreditState {
        Deleted,
        Requested,
        Approved,
        Originated,
        GoodStanding,
        Delayed,
        PaidOff,
        InDefaultGracePeriod,
        Defaulted
    }

    constructor(
        address _poolToken,
        address _humaConfig,
        address _reputationTrackerFactory
    ) BasePool(_poolToken, _humaConfig, _reputationTrackerFactory) {}

    // Apply to borrow from the pool. Borrowing is subject to interest,
    // collateral, and maximum loan requirements as dictated by the pool
    function requestCredit(
        uint256 _borrowAmt,
        uint256 _paymentInterval,
        uint256 _numOfPayments
    ) external {
        poolOn();
        uint256[] memory terms = getLoanTerms(_paymentInterval, _numOfPayments);

        // Borrowers must not have existing loans from this pool
        require(
            creditStateMapping[msg.sender].state == CreditState.Deleted,
            "BaseCredit:DENY_EXISTING_LOAN"
        );

        // Borrowing amount needs to be higher than min for the pool.
        require(_borrowAmt >= minBorrowAmt, "BaseCredit:SMALLER_THAN_LIMIT");

        // Borrowing amount needs to be lower than max for the pool.
        require(maxBorrowAmt >= _borrowAmt, "BaseCredit:GREATER_THAN_LIMIT");

        initiate(msg.sender, _borrowAmt, address(0), 0, terms);
    }

    /**
     * @notice the initiation of a loan
     * @param _borrower the address of the borrower
     * @param liquidityAmt the amount of the liquidity asset that the borrower obtains
     * @param collateralAsset the address of the collateral asset.
     * @param collateralAmt the amount of the collateral asset
     * @param terms[] the terms for the loan.
     *                [0] apr_in_bps
     *                [1] platform_fee_flat
     *                [2] platform_fee_bps
     *                [3] late_fee_flat
     *                [4] late_fee_bps
     *                [5] payment_interval, in days
     *                [6] numOfPayments
     *                [7] early_payff_fee_flat
     *                [8] early_payoff_fee_bps
     */
    function initiate(
        address _borrower,
        uint256 liquidityAmt,
        address collateralAsset,
        uint256 collateralAmt,
        uint256[] memory terms
    ) public virtual override {
        protoNotPaused();

        // Populates basic credit info fields
        CreditInfo memory ci;
        ci.collateralAsset = collateralAsset;
        ci.collateralAmt = uint32(collateralAmt);
        ci.numOfPayments = uint16(terms[6]);
        ci.loanAmt = uint32(liquidityAmt);
        creditInfoMapping[_borrower] = ci;

        // Populates fields related to fee structure
        CreditFeeStructure memory cfs;
        cfs.apr_in_bps = uint16(terms[0]);
        cfs.platform_fee_flat = uint16(terms[1]);
        cfs.platform_fee_bps = uint16(terms[2]);
        cfs.late_fee_flat = uint16(terms[3]);
        cfs.late_fee_bps = uint16(terms[4]);
        cfs.early_payoff_fee_flat = uint16(terms[7]);
        cfs.early_payoff_fee_bps = uint16(terms[8]);
        creditFeesMapping[_borrower] = cfs;

        // Populates key status fields. Fields nextDueDate, nextAmtDue,
        // lastLateFeeTimestamp, and feesDue are left at initial value.
        CreditStatus memory cs;
        cs.remainingPrincipal = uint32(liquidityAmt); // remaining principal balance
        cs.remainingPayments = uint16(terms[6]);
        cs.paymentInterval = uint16(terms[5]); // in days
        cs.state = CreditState.Requested;
        creditStateMapping[_borrower] = cs;
    }

    /**
     * Approves the loan request with the terms on record.
     */
    function approveCredit(address borrower) public virtual override {
        protoNotPaused();
        // Only credit approvers can call this function
        require(
            creditApprovers[msg.sender] = true,
            "BasePool:APPROVER_REQUIRED"
        );
        CreditStatus storage cs = creditStateMapping[borrower];
        cs.state = CreditState.Approved;
        creditStateMapping[borrower] = cs;
    }

    function invalidateCreditRecord(address borrower) public virtual override {
        poolOn();
        require(
            creditApprovers[msg.sender] == true,
            "HumaPool:ILLEGAL_CREDIT_POSTER"
        );

        creditStateMapping[borrower].state = CreditState.Deleted;
        creditInfoMapping[borrower].deleted = true;
        creditFeesMapping[borrower].deleted = true;
    }

    function isApproved(address borrower)
        public
        view
        virtual
        override
        returns (bool)
    {
        if (creditStateMapping[borrower].state >= CreditState.Approved)
            return true;
        else return false;
    }

    function originateCredit(uint256 borrowAmt) external virtual override {
        return
            originateCreditWithCollateral(
                msg.sender,
                borrowAmt,
                address(0),
                0,
                0
            );
    }

    function originateCreditWithCollateral(
        address borrower,
        uint256 borrowAmt,
        address collateralAsset,
        uint256 collateralParam,
        uint256 collateralCount
    ) public virtual override {
        poolOn();
        require(isApproved(borrower), "BaseCredit:CREDIT_NOT_APPROVED");

        //    Updates credit info. Critical to update ci.loanAmt since borrowAmt
        // might be lowered than the approved loan amount
        CreditInfo storage ci = creditInfoMapping[borrower];
        ci.loanAmt = uint32(borrowAmt);
        ci.collateralAsset = collateralAsset;
        ci.collateralAmt = uint32(collateralCount);
        ci.collateralParam = collateralParam;
        creditInfoMapping[borrower] = ci;

        // // Calculates next payment amount and due date
        CreditStatus storage cs = creditStateMapping[borrower];
        cs.nextDueDate = uint48(
            block.timestamp + uint256(cs.paymentInterval) * 24 * 3600
        );
        cs.nextAmtDue = uint32(
            borrowAmt * creditFeesMapping[borrower].apr_in_bps
        );
        creditStateMapping[borrower] = cs;

        (
            uint256 amtToBorrower,
            uint256 protocolFee,
            uint256 poolIncome
        ) = calculateFees(borrower, borrowAmt);

        distributeIncome(poolIncome);

        IReputationTracker(reputationTrackerContractAddress).report(
            borrower,
            IReputationTracker.TrackingType.Borrowing
        );

        // //CRITICAL: Asset transfers
        // // Transfers collateral asset
        // if (collateralAsset != address(0)) {
        //     if (collateralAsset.supportsInterface(type(IERC721).interfaceId)) {
        //         IERC721(collateralAsset).safeTransferFrom(
        //             msg.sender,
        //             poolLocker,
        //             collateralParam
        //         );
        //     } else if (
        //         collateralAsset.supportsInterface(type(IERC20).interfaceId)
        //     ) {
        //         IERC20(collateralAsset).safeTransferFrom(
        //             msg.sender,
        //             poolLocker,
        //             collateralCount
        //         );
        //     } else {
        //         revert("BaseCredit:COLLATERAL_ASSET_NOT_SUPPORTED");
        //     }
        // }

        // Transfer protocole fee and funds the borrower
        address treasuryAddress = HumaConfig(humaConfig).humaTreasury();
        PoolLocker locker = PoolLocker(poolLocker);
        locker.transfer(treasuryAddress, protocolFee);
        locker.transfer(msg.sender, amtToBorrower);
    }

    function calculateFees(address borrower, uint256 borrowAmt)
        internal
        view
        returns (
            uint256 amtToBorrower,
            uint256 protocolFee,
            uint256 poolIncome
        )
    {
        CreditFeeStructure memory cfs = creditFeesMapping[borrower];

        // Calculate platform fee, which includes protocol fee and pool fee
        uint256 platformFees;
        if (cfs.platform_fee_flat != 0) platformFees = cfs.platform_fee_flat;
        if (cfs.platform_fee_bps != 0)
            platformFees +=
                (creditInfoMapping[borrower].loanAmt * cfs.platform_fee_bps) /
                10000;

        // Split the fee between treasury and the pool
        protocolFee =
            (uint256(HumaConfig(humaConfig).treasuryFee()) * borrowAmt) /
            10000;

        assert(platformFees >= protocolFee);

        poolIncome = platformFees - protocolFee;

        amtToBorrower = borrowAmt - platformFees;

        return (amtToBorrower, protocolFee, poolIncome);
    }

    /**
     * @notice Borrower makes one payment. If this is the final payment,
     * it automatically triggers the payoff process.
     * @dev "BaseCredit:WRONG_ASSET" reverted when asset address does not match
     *
     */
    function makePayment(
        address borrower,
        address asset,
        uint256 amount
    ) external virtual override {
        protoNotPaused();
        CreditStatus storage cs = creditStateMapping[msg.sender];

        require(asset == address(poolToken), "BaseCredit:WRONG_ASSET");
        require(cs.remainingPayments > 0, "BaseCredit:LOAN_PAID_OFF_ALREADY");

        uint256 totalAmt;
        uint256 principal;
        uint256 interest;
        uint256 fees;
        if (cs.remainingPayments == 1) {
            (
                totalAmt,
                principal,
                interest,
                fees, /*unused*/

            ) = getPayoffInfo(borrower);
        } else {
            (
                totalAmt,
                principal,
                interest,
                fees, /*unused*/

            ) = getNextPaymentInterestOnly(borrower);
        }

        // Do not accept partial payments. Requires amount to be able to cover
        // the next payment and all the outstanding fees.
        require(amount >= totalAmt, "BaseCredit:AMOUNT_TOO_LOW");

        // Handle overpayment towards principal.
        principal += (amount - totalAmt);
        totalAmt = amount;

        if (cs.remainingPayments == 1) {
            cs.remainingPrincipal = 0;
            cs.feesDue = 0;
            cs.nextAmtDue = 0;
            cs.nextDueDate = 0;
            cs.remainingPayments = 0;
        } else {
            cs.feesDue = 0;
            // Covers the case when the user paid extra amount than required
            // todo needs to address the case when the amount paid can actually pay off
            cs.remainingPrincipal = cs.remainingPrincipal - uint32(principal);
            cs.nextDueDate = cs.nextDueDate + cs.paymentInterval;
            cs.remainingPayments -= 1;
        }

        // Distribute income
        uint256 poolIncome = interest + fees;
        distributeIncome(poolIncome);

        if (cs.remainingPayments == 0) {
            // No way to delete entries in mapping, thus mark the deleted field to true.
            invalidateCreditRecord(borrower);

            // Reputation reporting
            IReputationTracker(reputationTrackerContractAddress).report(
                borrower,
                IReputationTracker.TrackingType.Payoff
            );
        }

        // Transfer assets from the borrower to pool locker
        IERC20 assetIERC20 = IERC20(poolToken);
        assetIERC20.transferFrom(msg.sender, poolLocker, amount);
    }

    /**
     * @notice Assess and charge penalty fee for early payoff.
     */
    function assessEarlyPayoffFees(address borrower)
        public
        virtual
        override
        returns (uint256 penalty)
    {
        CreditFeeStructure storage cfs = creditFeesMapping[borrower];
        CreditStatus storage cs = creditStateMapping[borrower];
        if (cfs.early_payoff_fee_flat > 0) penalty = cfs.early_payoff_fee_flat;
        if (cfs.early_payoff_fee_bps > 0) {
            penalty +=
                (cs.remainingPrincipal *
                    creditFeesMapping[borrower].early_payoff_fee_bps) /
                BPS_DIVIDER;
        }
        cs.feesDue += uint32(penalty);
    }

    /**
     * @notice Borrower requests to payoff the credit
     */
    function payoff(
        address borrower,
        address asset,
        uint256 amount
    ) external virtual override {
        //todo to implement
    }

    /**
     * @notice Checks if a late fee should be charged and charges if needed
     * @return fees the amount of fees charged
     */
    function assessLateFee(address borrower)
        public
        virtual
        override
        returns (uint256 fees)
    {
        CreditFeeStructure storage cfs = creditFeesMapping[borrower];
        CreditStatus storage cs = creditStateMapping[borrower];

        // Charge a late fee if 1) passed the due date and 2) there is no late fee charged
        // between the due date and the current timestamp.
        uint256 newFees;
        if (
            block.timestamp > cs.nextDueDate &&
            cs.lastLateFeeTimestamp < cs.nextDueDate
        ) {
            if (cfs.late_fee_flat > 0) newFees = cfs.late_fee_flat;
            if (cfs.late_fee_bps > 0) {
                newFees += (cs.nextAmtDue * cfs.late_fee_bps) / BPS_DIVIDER;
            }
            cs.feesDue += uint32(newFees);
            cs.lastLateFeeTimestamp = uint48(block.timestamp);
            creditStateMapping[borrower] = cs;
        }
        return newFees;
    }

    /**
     * @notice Triggers the default process
     * @return losses the amount of remaining losses to the pool after collateral
     * liquidation, pool cover, and staking.
     */
    function triggerDefault(address borrower)
        external
        virtual
        override
        returns (uint256 losses)
    {
        // check to make sure the default grace period has passed.
        require(
            block.timestamp >
                creditStateMapping[borrower].nextDueDate +
                    poolDefaultGracePeriod,
            "HumaIF:DEFAULT_TRIGGERED_TOO_EARLY"
        );

        // FeatureRequest: add pool cover logic

        // FeatureRequest: add staking logic

        // Trigger loss process
        losses = creditStateMapping[borrower].remainingPrincipal;
        distributeLosses(losses);

        // Retutation reporting
        IReputationTracker(reputationTrackerContractAddress).report(
            borrower,
            IReputationTracker.TrackingType.Default
        );

        return losses;
    }

    // /**
    //  * @notice Calculates monthly payment for a loan.
    //  * M = P [ i(1 + i)^n ] / [ (1 + i)^n – 1].
    //  * M = Total monthly payment
    //  * P = The total amount of the loan
    //  * I = Interest rate, as a monthly percentage
    //  * N = Number of payments.
    //  */
    // function calcMonthlyPayment()
    //     private
    //     view
    //     returns (uint256 monthlyPayment)
    // {
    //     CreditInfo storage ci = loanInfo;
    //     CreditStatus storage cs = creditStateMapping[borrower];
    //     uint256 monthlyRateBP = ci.apr_in_bps / 12;
    //     monthlyPayment = ci
    //         .loanAmt
    //         .mul(monthlyRateBP.mul(monthlyRateBP.add(10000)) ^ cs.numOfPayments)
    //         .div(monthlyRateBP.add(10000) ^ cs.numOfPayments.sub(10000));
    // }

    /**
     * @notice Gets the information of the next payment due
     * @return totalAmt the full amount due for the next payment
     * @return principal the amount towards principal
     * @return interest the amount towards interest
     * @return fees the amount towards fees
     * @return dueDate the datetime of when the next payment is due
     */
    function getNextPayment(address borrower)
        public
        virtual
        override
        returns (
            uint256 totalAmt,
            uint256 principal,
            uint256 interest,
            uint256 fees,
            uint256 dueDate
        )
    {
        fees = assessLateFee(borrower);
        CreditStatus storage cs = creditStateMapping[borrower];
        // For loans w/ fixed payments, the portion towards interest is this month's interest charge,
        // which is remaining principal times monthly interest rate. The difference b/w the total amount
        // and the interest payment pays down principal.
        interest =
            (cs.remainingPrincipal * creditFeesMapping[borrower].apr_in_bps) /
            BPS_DIVIDER;
        principal = cs.nextAmtDue - interest;
        return (
            principal + interest + fees,
            principal,
            interest,
            fees,
            block.timestamp
        );
    }

    /**
     * @notice Gets the information of the next payment due for interest only
     * @return totalAmt the full amount due for the next payment
     * @return principal the amount towards principal
     * @return interest the amount towards interest
     * @return fees the amount towards fees
     * @return dueDate the datetime of when the next payment is due
     */
    function getNextPaymentInterestOnly(address borrower)
        public
        virtual
        override
        returns (
            uint256 totalAmt,
            uint256 principal,
            uint256 interest,
            uint256 fees,
            uint256 dueDate
        )
    {
        fees = assessLateFee(borrower);

        interest =
            (creditInfoMapping[borrower].loanAmt *
                creditFeesMapping[borrower].apr_in_bps) /
            BPS_DIVIDER;
        return (interest + fees, 0, interest, fees, block.timestamp);
    }

    /**
     * @notice Gets the payoff information
     * @return total the total amount for the payoff
     * @return principal the remaining principal amount
     * @return interest the interest amount for the last period
     * @return fees fees including early payoff penalty
     * @return dueDate the date that payment needs to be made for this payoff amount
     */
    function getPayoffInfo(address borrower)
        public
        virtual
        override
        returns (
            uint256 total,
            uint256 principal,
            uint256 interest,
            uint256 fees,
            uint256 dueDate
        )
    {
        principal = creditStateMapping[borrower].remainingPrincipal;
        interest =
            (principal * creditFeesMapping[borrower].apr_in_bps) /
            BPS_DIVIDER;
        fees = assessLateFee(borrower);
        fees += (assessEarlyPayoffFees(borrower));
        total = principal + interest + fees;
        return (total, principal, interest, fees, block.timestamp);
    }

    /**
     * @notice Gets the payoff information
     * @return total the total amount for the payoff
     * @return principal the remaining principal amount
     * @return interest the interest amount for the last period
     * @return fees fees including early payoff penalty
     * @return dueDate the date that payment needs to be made for this payoff amount
     */
    function getPayoffInfoInterestOnly(address borrower)
        public
        virtual
        returns (
            uint256 total,
            uint256 principal,
            uint256 interest,
            uint256 fees,
            uint256 dueDate
        )
    {
        principal = creditStateMapping[borrower].remainingPrincipal;
        interest =
            (principal * creditFeesMapping[borrower].apr_in_bps) /
            BPS_DIVIDER;
        fees = assessLateFee(borrower);
        fees += (assessEarlyPayoffFees(borrower));
        total = principal + interest + fees;
        return (total, principal, interest, fees, block.timestamp);
    }

    /**
     * @notice Gets high-level information about the loan.
     */
    function getCreditInformation(address borrower)
        external
        view
        returns (
            uint32 _amount,
            uint32 _paybackPerInterval,
            uint64 _paybackInterval,
            uint32 _interestRateBasis,
            uint64 _nextDueDate,
            uint32 _remainingPrincipal,
            uint16 _remainingPayments,
            uint16 _numOfPayments
        )
    {
        CreditInfo storage ci = creditInfoMapping[borrower];
        CreditStatus storage cs = creditStateMapping[borrower];
        CreditFeeStructure storage cfs = creditFeesMapping[borrower];
        return (
            ci.loanAmt,
            cs.nextAmtDue,
            cs.paymentInterval,
            cfs.apr_in_bps,
            cs.nextDueDate,
            cs.remainingPrincipal,
            cs.remainingPayments,
            ci.numOfPayments
        );
    }

    function protoNotPaused() internal view {
        require(
            HumaConfig(humaConfig).isProtocolPaused() == false,
            "BaseCredit:PROTOCOL_PAUSED"
        );
    }

    /**
     * Retrieve loan terms from pool config. 
     //todo It is hard-coded right now. Need to call poll config to get the real data
    */
    function getLoanTerms(uint256 _paymentInterval, uint256 _numOfPayments)
        private
        view
        returns (uint256[] memory terms)
    {
        terms = new uint256[](9);
        terms[0] = interestRateBasis; //apr_in_bps
        terms[1] = platform_fee_flat;
        terms[2] = platform_fee_bps;
        terms[3] = late_fee_flat;
        terms[4] = late_fee_bps;
        terms[5] = _paymentInterval; //payment_interval, in days
        terms[6] = _numOfPayments; //numOfPayments
        terms[7] = early_payoff_fee_flat;
        terms[8] = early_payoff_fee_bps;
    }
}
