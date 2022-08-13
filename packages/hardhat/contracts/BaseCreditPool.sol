//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./HumaConfig.sol";
import "./BasePool.sol";
import "./HDT/HDT.sol";
import "./interfaces/ICredit.sol";
import "./interfaces/IPoolLocker.sol";
import "./libraries/SafeMathInt.sol";
import "./libraries/SafeMathUint.sol";
import "./libraries/BaseStructs.sol";
import "./interfaces/IFeeManager.sol";
import "./interfaces/IFeeManager.sol";
import "./BaseFeeManager.sol";

import "hardhat/console.sol";

contract BaseCreditPool is ICredit, BasePool {
    // Divider to get monthly interest rate from APR BPS. 10000 * 12
    uint256 public constant BPS_DIVIDER = 120000;

    using SafeERC20 for IERC20;
    using ERC165Checker for address;
    using BaseStructs for BaseCreditPool;

    // The primary mapping of the status of the credit.
    mapping(address => BaseStructs.CreditStatus) internal creditStateMapping;
    mapping(address => BaseStructs.CreditInfo) internal creditInfoMapping;
    mapping(address => BaseStructs.CreditFeeStructure)
        internal creditFeesMapping;

    constructor(
        address _poolToken,
        address _humaConfig,
        address _poolLockerAddr,
        address _feeManagerAddr
    ) BasePool(_poolToken, _humaConfig, _poolLockerAddr, _feeManagerAddr) {}

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
            creditStateMapping[msg.sender].state ==
                BaseStructs.CreditState.Deleted,
            "BaseCreditPool:DENY_EXISTING_LOAN"
        );

        // Borrowing amount needs to be higher than min for the pool.
        require(
            _borrowAmt >= minBorrowAmt,
            "BaseCreditPool:SMALLER_THAN_LIMIT"
        );

        // Borrowing amount needs to be lower than max for the pool.
        require(
            maxBorrowAmt >= _borrowAmt,
            "BaseCreditPool:GREATER_THAN_LIMIT"
        );

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
     *                [1] payment_interval, in days
     *                [2] numOfPayments
     * todo remove dynamic array, need to coordinate with client for that change.
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
        BaseStructs.CreditInfo memory ci;
        ci.collateralAsset = collateralAsset;
        ci.collateralAmt = uint32(collateralAmt);
        ci.numOfPayments = uint16(terms[6]);
        ci.loanAmt = uint32(liquidityAmt);
        creditInfoMapping[_borrower] = ci;

        // Populates fields related to fee structure
        BaseStructs.CreditFeeStructure memory cfs;
        cfs.apr_in_bps = uint16(terms[0]);
        creditFeesMapping[_borrower] = cfs;

        // Populates key status fields. Fields nextDueDate, nextAmtDue,
        // lastLateFeeTimestamp, and feesDue are left at initial value.
        BaseStructs.CreditStatus memory cs;
        cs.remainingPrincipal = uint32(liquidityAmt); // remaining principal balance
        cs.remainingPayments = uint16(terms[6]);
        cs.paymentInterval = uint16(terms[5]); // in days
        cs.state = BaseStructs.CreditState.Requested;
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
        BaseStructs.CreditStatus storage cs = creditStateMapping[borrower];
        cs.state = BaseStructs.CreditState.Approved;
        creditStateMapping[borrower] = cs;
    }

    function invalidateApprovedCredit(address borrower)
        public
        virtual
        override
    {
        poolOn();
        // todo need to add back access control if it is calling from outside
        // require(
        //     creditApprovers[msg.sender] == true,
        //     "HumaPool:ILLEGAL_CREDIT_POSTER"
        // );
        creditStateMapping[borrower].state = BaseStructs.CreditState.Deleted;
        creditStateMapping[borrower].deleted = true;
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
        if (
            creditStateMapping[borrower].state >=
            BaseStructs.CreditState.Approved
        ) return true;
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
        require(isApproved(borrower), "BaseCreditPool:CREDIT_NOT_APPROVED");

        //    Updates credit info. Critical to update ci.loanAmt since borrowAmt
        // might be lowered than the approved loan amount
        BaseStructs.CreditInfo storage ci = creditInfoMapping[borrower];
        ci.loanAmt = uint32(borrowAmt);
        ci.collateralAsset = collateralAsset;
        ci.collateralAmt = uint32(collateralCount);
        ci.collateralParam = collateralParam;
        creditInfoMapping[borrower] = ci;

        // // Calculates next payment amount and due date
        BaseStructs.CreditStatus storage cs = creditStateMapping[borrower];
        cs.nextDueDate = uint64(
            block.timestamp + uint256(cs.paymentInterval) * 24 * 3600
        );
        cs.nextAmtDue = uint32(
            (borrowAmt * creditFeesMapping[borrower].apr_in_bps) / BPS_DIVIDER
        );
        creditStateMapping[borrower] = cs;

        (
            uint256 amtToBorrower,
            uint256 protocolFee,
            uint256 poolIncome
        ) = IFeeManager(feeManagerAddr).distBorrowingAmt(borrowAmt, humaConfig);

        distributeIncome(poolIncome);

        // //CRITICAL: Asset transfers
        // // Transfers collateral asset
        if (collateralAsset != address(0)) {
            // todo not sure why compiler compalined about supportsInterface.
            // Need to look into it and uncomment to support both ERc721 and ERC20.
            if (collateralAsset.supportsInterface(type(IERC721).interfaceId)) {
                IERC721(collateralAsset).safeTransferFrom(
                    borrower,
                    poolLockerAddr,
                    collateralParam
                );
            } else if (
                collateralAsset.supportsInterface(type(IERC20).interfaceId)
            ) {
                IERC20(collateralAsset).safeTransferFrom(
                    msg.sender,
                    poolLockerAddr,
                    collateralCount
                );
            } else {
                revert("BaseCreditPool:COLLATERAL_ASSET_NOT_SUPPORTED");
            }
        }

        // Transfer protocole fee and funds the borrower
        address treasuryAddress = HumaConfig(humaConfig).humaTreasury();
        PoolLocker locker = PoolLocker(poolLockerAddr);
        locker.transfer(treasuryAddress, protocolFee);
        locker.transfer(borrower, amtToBorrower);
    }

    /**
     * @notice Borrower makes one payment. If this is the final payment,
     * it automatically triggers the payoff process.
     * @dev "BaseCreditPool:WRONG_ASSET" reverted when asset address does not match
     *
     */
    function makePayment(
        address borrower,
        address asset,
        uint256 amount
    ) external virtual override {
        protoNotPaused();
        BaseStructs.CreditStatus storage cs = creditStateMapping[msg.sender];

        require(asset == address(poolToken), "BaseCreditPool:WRONG_ASSET");
        require(
            cs.remainingPayments > 0,
            "BaseCreditPool:LOAN_PAID_OFF_ALREADY"
        );

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

            ) = getPayoffInfoInterestOnly(borrower);
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
        require(amount >= totalAmt, "BaseCreditPool:AMOUNT_TOO_LOW");

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
            invalidateApprovedCredit(borrower);
        }

        // Transfer assets from the borrower to pool locker
        IERC20 assetIERC20 = IERC20(poolToken);
        assetIERC20.transferFrom(borrower, poolLockerAddr, amount);
    }

    /**
     * @notice Assess and charge penalty fee for early payoff.
     */
    // function assessEarlyPayoffFees(address borrower)
    //     public
    //     virtual
    //     override
    //     returns (uint256 penalty)
    // {
    //     BaseStructs.CreditFeeStructure storage cfs = creditFeesMapping[borrower];
    //     BaseStructs.CreditStatus storage cs = creditStateMapping[borrower];
    //     if (cfs.back_loading_fee_flat > 0) penalty = cfs.back_loading_fee_flat;
    //     if (cfs.back_loading_fee_bps > 0) {
    //         penalty +=
    //             (cs.remainingPrincipal *
    //                 creditFeesMapping[borrower].back_loading_fee_bps) /
    //             BPS_DIVIDER;
    //     }
    //     cs.feesDue += uint32(penalty);
    // }

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

    // /**
    //  * @notice Checks if a late fee should be charged and charges if needed
    //  * @return fees the amount of fees charged
    //  */
    // function assessLateFee(address borrower)
    //     public
    //     virtual
    //     override
    //     returns (uint256 fees)
    // {
    //     BaseStructs.CreditFeeStructure storage cfs = creditFeesMapping[
    //         borrower
    //     ];
    //     BaseStructs.CreditStatus storage cs = creditStateMapping[borrower];

    //     // Charge a late fee if 1) passed the due date and 2) there is no late fee charged
    //     // between the due date and the current timestamp.

    //     uint256 newFees;
    //     if (
    //         block.timestamp > cs.nextDueDate &&
    //         cs.lastLateFeeTimestamp < cs.nextDueDate
    //     ) {
    //         if (cfs.late_fee_flat > 0) newFees = cfs.late_fee_flat;
    //         if (cfs.late_fee_bps > 0) {
    //             newFees += (cs.nextAmtDue * cfs.late_fee_bps) / BPS_DIVIDER;
    //         }
    //         cs.feesDue += uint32(newFees);
    //         cs.lastLateFeeTimestamp = uint64(block.timestamp);
    //         creditStateMapping[borrower] = cs;
    //     }
    //     return newFees;
    // }

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
    //     BaseStructs.CreditInfo storage ci = loanInfo;
    //     BaseStructs.CreditStatus storage cs = creditStateMapping[borrower];
    //     uint256 monthlyRateBP = ci.apr_in_bps / 12;
    //     monthlyPayment = ci
    //         .loanAmt
    //         .mul(monthlyRateBP.mul(monthlyRateBP.add(10000)) ^ cs.numOfPayments)
    //         .div(monthlyRateBP.add(10000) ^ cs.numOfPayments.sub(10000));
    // }

    // /**
    //  * @notice Gets the information of the next payment due
    //  * @return totalAmt the full amount due for the next payment
    //  * @return principal the amount towards principal
    //  * @return interest the amount towards interest
    //  * @return fees the amount towards fees
    //  * @return dueDate the datetime of when the next payment is due
    //  */
    // function getNextPayment(address borrower)
    //     public
    //     virtual
    //     override
    //     returns (
    //         uint256 totalAmt,
    //         uint256 principal,
    //         uint256 interest,
    //         uint256 fees,
    //         uint256 dueDate
    //     )
    // {
    //     fees = assessLateFee(borrower);
    //     BaseStructs.CreditStatus storage cs = creditStateMapping[borrower];
    //     // For loans w/ fixed payments, the portion towards interest is this month's interest charge,
    //     // which is remaining principal times monthly interest rate. The difference b/w the total amount
    //     // and the interest payment pays down principal.
    //     interest =
    //         (cs.remainingPrincipal * creditFeesMapping[borrower].apr_in_bps) /
    //         BPS_DIVIDER;
    //     principal = cs.nextAmtDue - interest;
    //     return (
    //         principal + interest + fees,
    //         principal,
    //         interest,
    //         fees,
    //         block.timestamp
    //     );
    // }

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
        fees = IFeeManager(feeManagerAddr).calcLateFee(
            creditStateMapping[borrower].nextAmtDue,
            creditStateMapping[borrower].nextDueDate,
            creditStateMapping[borrower].lastLateFeeTimestamp,
            creditStateMapping[borrower].paymentInterval
        );

        interest =
            (creditInfoMapping[borrower].loanAmt *
                creditFeesMapping[borrower].apr_in_bps) /
            BPS_DIVIDER;
        return (interest + fees, 0, interest, fees, block.timestamp);
    }

    // /**
    //  * @notice Gets the payoff information
    //  * @return total the total amount for the payoff
    //  * @return principal the remaining principal amount
    //  * @return interest the interest amount for the last period
    //  * @return fees fees including early payoff penalty
    //  * @return dueDate the date that payment needs to be made for this payoff amount
    //  */
    // function getPayoffInfo(address borrower)
    //     public
    //     virtual
    //     override
    //     returns (
    //         uint256 total,
    //         uint256 principal,
    //         uint256 interest,
    //         uint256 fees,
    //         uint256 dueDate
    //     )
    // {
    //     principal = creditStateMapping[borrower].remainingPrincipal;
    //     interest =
    //         (principal * creditFeesMapping[borrower].apr_in_bps) /
    //         BPS_DIVIDER;
    //     fees = assessLateFee(borrower);
    //     fees += (assessEarlyPayoffFees(borrower));
    //     total = principal + interest + fees;
    //     return (total, principal, interest, fees, block.timestamp);
    // }

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
        override
        returns (
            uint256 total,
            uint256 principal,
            uint256 interest,
            uint256 fees,
            uint256 dueDate
        )
    {
        BaseStructs.CreditStatus memory cs = creditStateMapping[borrower];
        principal = cs.remainingPrincipal;
        interest =
            (principal * creditFeesMapping[borrower].apr_in_bps) /
            BPS_DIVIDER;
        // todo
        fees = IFeeManager(feeManagerAddr).calcLateFee(
            cs.nextAmtDue,
            cs.nextDueDate,
            cs.lastLateFeeTimestamp,
            cs.paymentInterval
        );

        // todo need to call with the original principal amount
        fees += IFeeManager(feeManagerAddr).calcBackLoadingFee(principal);
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
            uint16 _numOfPayments,
            bool _deleted
        )
    {
        BaseStructs.CreditInfo memory ci = creditInfoMapping[borrower];
        BaseStructs.CreditStatus memory cs = creditStateMapping[borrower];
        BaseStructs.CreditFeeStructure memory cfs = creditFeesMapping[borrower];
        return (
            ci.loanAmt,
            cs.nextAmtDue,
            cs.paymentInterval,
            cfs.apr_in_bps,
            cs.nextDueDate,
            cs.remainingPrincipal,
            cs.remainingPayments,
            ci.numOfPayments,
            cs.deleted
        );
    }

    function protoNotPaused() internal view {
        require(
            HumaConfig(humaConfig).isProtocolPaused() == false,
            "BaseCreditPool:PROTOCOL_PAUSED"
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
        terms[0] = aprInBps; //apr_in_bps
        terms[1] = front_loading_fee_flat;
        terms[2] = front_loading_fee_bps;
        terms[3] = late_fee_flat;
        terms[4] = late_fee_bps;
        terms[5] = _paymentInterval; //payment_interval, in days
        terms[6] = _numOfPayments; //numOfPayments
        terms[7] = back_loading_fee_flat;
        terms[8] = back_loading_fee_bps;
    }

    function getApprovalStatusForBorrower(address borrower)
        external
        view
        returns (bool)
    {
        return
            creditStateMapping[borrower].state >=
            BaseStructs.CreditState.Approved;
    }
}
