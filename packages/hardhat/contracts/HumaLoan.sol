//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./HumaConfig.sol";
import "./HumaPool.sol";
import "./HDT/HDT.sol";
import "./interfaces/IHumaCredit.sol";
import "./interfaces/IHumaPoolAdmins.sol";
import "./interfaces/IHumaPoolLoanHelper.sol";
import "./interfaces/IHumaPoolLocker.sol";
import "./libraries/SafeMathInt.sol";
import "./libraries/SafeMathUint.sol";

import "hardhat/console.sol";

contract HumaLoan is IHumaCredit {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using SafeMath for uint16;
    using SafeMath for uint32;
    using SafeMathUint for uint256;
    using SafeMathUint for uint16;
    using SafeMathUint for uint32;

    address payable pool;
    address private poolLocker;
    address private humaConfig;
    address public treasury;
    address public borrower;
    bool public approved;
    LoanInfo public loanInfo;
    LoanState public loanState;

    /**
     * @notice LoanInfo stores the overall info about a loan.
     * Struct is used to pack the data in 2 storage units (512 bits)
     * @dev amounts are stored in uint32, all counts are stored in uint16
     * @dev all fields in LoanInfo will not change after initialization.
     * @dev each struct can have no more than 13 elements. Some fields
     * are stored in LoanState because of space limitation.
     */
    struct LoanInfo {
        // fields related to the overall picture of the loan
        address liquidityAsset;
        uint16 apr_in_bps; // interest rate in bps
        uint16 platform_fee_flat;
        uint16 platform_fee_bps;
        uint16 late_fee_flat;
        uint16 late_fee_bps;
        uint16 early_payoff_fee_flat;
        uint16 early_payoff_fee_bps;
        uint32 loanAmount;
        uint32 collateralAmount;
        address collateralAsset;
        uint256 id;
    }

    /**
     * @notice LoanState tracks the state such as how much has been paid,
     * how many payments are remaining.
     * @dev most fields in LaonState change as the borrower pays back
     */
    struct LoanState {
        uint48 lastLateFeeTimestamp;
        uint48 nextDueDate;
        uint32 feesDue;
        uint32 principalPaidBack; // remaining principal balance
        uint32 nextAmountDue;
        uint16 remainingPayments;
        uint16 paymentInterval; // in days
        uint16 numOfPayments;
    }

    /// Contructor accepts 0 para per FactoryClone requirement.
    constructor() {}

    /**
     * @notice the initiation of a loan
     * @param id the unique id for this loan
     * @param _poolLocker the address of pool locker that holds the liquidity asset
     * @param _treasury the address of the treasury that accepts fees
     * @param _borrower the address of the borrower
     * @param liquidityAsset the address of the liquidity asset that the borrower obtains
     * @param liquidityAmount the amount of the liquidity asset that the borrower obtains
     * @param collateralAsset the address of the collateral asset.
     * @param collateralAmount the amount of the collateral asset
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
        address payable _pool,
        uint256 id,
        address _poolLocker,
        address _humaConfig,
        address _treasury,
        address _borrower,
        address liquidityAsset,
        uint256 liquidityAmount,
        address collateralAsset,
        uint256 collateralAmount,
        uint256[] memory terms
    ) external virtual override {
        pool = _pool;
        humaConfig = _humaConfig;
        protoNotPaused();
        poolLocker = _poolLocker;
        treasury = _treasury;
        borrower = _borrower;

        // Populate LoanInfo object
        LoanInfo memory li;
        li.liquidityAsset = liquidityAsset;
        li.apr_in_bps = uint16(terms[0]);
        li.platform_fee_flat = uint16(terms[1]);
        li.platform_fee_bps = uint16(terms[2]);
        li.late_fee_flat = uint16(terms[3]);
        li.late_fee_bps = uint16(terms[4]);
        li.early_payoff_fee_flat = uint16(terms[7]);
        li.early_payoff_fee_bps = uint16(terms[8]);
        li.loanAmount = uint32(liquidityAmount);
        li.collateralAsset = collateralAsset;
        li.collateralAmount = uint32(collateralAmount);
        li.id = id;

        LoanState memory ls;
        ls.paymentInterval = uint16(terms[5]);
        ls.numOfPayments = uint16(terms[6]);
        ls.principalPaidBack = 0;

        approved = false;
        loanInfo = li;
        loanState = ls;
    }

    /**
     * Approves the loan request with the terms on record.
     */
    function approve() external virtual override returns (bool) {
        // todo add access control.
        protoNotPaused();
        approved = true;
        return approved;
    }

    function isApproved() external view virtual override returns (bool) {
        return approved;
    }

    /**
     * @notice
     */
    function originateCredit()
        external
        virtual
        override
        returns (uint256 amtForBorrower, uint256 amtForTreasury)
    {
        protoNotPaused();
        require(approved, "HumaLoan:LOAN_NOT_APPROVED");

        LoanState storage ls = loanState;
        ls.principalPaidBack = 0;
        ls.lastLateFeeTimestamp = 0;
        ls.nextDueDate = uint48(block.timestamp + uint256(ls.paymentInterval));
        // todo Calculate the next payment for different payback interval.
        ls.nextAmountDue = uint16(calcInterestOnlyMonthlyPayment());
        ls.remainingPayments = ls.numOfPayments;

        loanState = ls;

        // Calculate platform fee due
        uint256 fees;
        LoanInfo storage li = loanInfo;
        if (li.platform_fee_flat != 0) fees = li.platform_fee_flat;
        if (li.platform_fee_bps != 0)
            fees += li.loanAmount.mul(li.platform_fee_bps).div(10000);

        assert(li.loanAmount > fees);

        // CRITICAL: Transfer fees to treasury, remaining proceeds to the borrower
        return (li.loanAmount - fees, fees);
    }

    /**
     * @notice Borrower makes one payment. If this is the final payment,
     * it automatically triggers the payoff process.
     * @dev "HumaLoan:WRONG_ASSET" reverted when asset address does not match
     * @return status if the payment is successful or not
     *
     */
    function makePayment(address asset, uint256 amount)
        external
        virtual
        override
        returns (bool)
    {
        protoNotPaused();
        LoanInfo storage li = loanInfo;
        LoanState storage ls = loanState;

        require(asset == li.liquidityAsset, "HumaLoan:WRONG_ASSET");

        require(ls.remainingPayments > 0, "HumaLoan:LOAN_PAID_OFF_ALREADY");

        uint256 totalAmount;
        uint256 principal;
        uint256 interest;
        uint256 fees;
        if (ls.remainingPayments == 1) {
            (totalAmount, principal, interest, fees, ) = getPayoffInfo();
        } else {
            (
                totalAmount,
                principal,
                interest,
                fees,

            ) = getNextPaymentInterestOnly();
        }

        // Do not accept partial payments. Requires amount to be able to cover
        // the next payment and all the outstanding fees.
        require(amount >= totalAmount, "HumaLoan:AMOUNT_TOO_LOW");

        // Handle overpayment towards principal.
        principal += (amount - totalAmount);
        totalAmount = amount;

        if (ls.remainingPayments == 1) {
            ls.principalPaidBack = li.loanAmount; // avoids penny difference
            ls.feesDue = 0;
            ls.nextAmountDue = 0;
            ls.nextDueDate = 0;
            ls.remainingPayments = 0;
        } else {
            ls.feesDue = 0;
            // Covers the case when the user paid extra amount than required
            // todo needs to address the case when the amount paid can actually pay off
            ls.principalPaidBack =
                ls.principalPaidBack +
                uint32(amount - interest - fees);
            ls.nextDueDate = ls.nextDueDate + ls.paymentInterval;
            ls.remainingPayments -= 1;
        }

        console.log("Before paying, totalAmount=", totalAmount);
        console.log("Before paying, principal=", principal);
        console.log("Before paying, interest=", interest);
        console.log("Before paying, fees=", fees);

        uint256 poolIncome = interest.add(fees);
        HumaPool(pool).distributeIncome(poolIncome);

        IERC20 assetIERC20 = IERC20(li.liquidityAsset);
        assetIERC20.transferFrom(msg.sender, poolLocker, amount);

        return true;
    }

    /**
     * @notice Assess and charge penalty fee for early payoff.
     */
    function assessEarlyPayoffFees() private returns (uint256) {
        LoanInfo storage li = loanInfo;
        LoanState storage ls = loanState;
        uint256 penalty;
        if (li.early_payoff_fee_flat > 0) penalty = li.early_payoff_fee_flat;
        if (li.early_payoff_fee_bps > 0) {
            uint32 remainingPrincipal = li.loanAmount - ls.principalPaidBack;
            penalty.add(
                remainingPrincipal.mul(li.early_payoff_fee_bps).div(120000)
            ); //120000 = 10000(due to bps) * 12 (convert rate to monthly)
        }
        ls.feesDue.add(penalty);
        loanInfo = li;
        return penalty;
    }

    /**
     * @notice Borrower requests to payoff the credit
     * @return status if the payoff is successful or not
     */
    function payoff(address asset, uint256 amount)
        external
        virtual
        override
        returns (bool status)
    {
        //todo to implement
    }

    /**
     * @notice Checks if a late fee should be charged and charges if needed
     * @return fees the amount of fees charged
     */
    function assessLateFee() public returns (uint256 fees) {
        LoanInfo storage li = loanInfo;
        LoanState storage ls = loanState;

        // Charge a late fee if 1) passed the due date and 2) there is no late fee charged
        // between the due date and the current timestamp.
        uint256 newFees;
        if (
            block.timestamp > ls.nextDueDate &&
            ls.lastLateFeeTimestamp < ls.nextDueDate
        ) {
            if (li.late_fee_flat > 0) newFees = li.late_fee_flat;
            if (li.late_fee_bps > 0) {
                // 120000 = 10000 (due to bps) * 12 (convert to monthly), combined for gas opt.
                newFees += ls.nextAmountDue.mul(li.late_fee_bps).div(120000);
            }
            ls.feesDue.add(newFees);
            ls.lastLateFeeTimestamp = uint48(block.timestamp);
            loanState = ls;
        }
        return newFees;
    }

    /**
     * @notice Triggers the default process
     * @return losses the amount of remaining losses to the pool after collateral
     * liquidation, pool cover, and staking.
     */
    function triggerDefault()
        external
        virtual
        override
        returns (uint256 losses)
    {
        // TODO implement default logic.
    }

    /**
     * @notice Calculates monthly payment for a loan.
     * M = P [ i(1 + i)^n ] / [ (1 + i)^n – 1].
     * M = Total monthly payment
     * P = The total amount of the loan
     * I = Interest rate, as a monthly percentage
     * N = Number of payments.
     */
    function calcMonthlyPayment()
        private
        view
        returns (uint256 monthlyPayment)
    {
        LoanInfo storage li = loanInfo;
        LoanState storage ls = loanState;
        uint256 monthlyRateBP = li.apr_in_bps / 12;
        monthlyPayment = li
            .loanAmount
            .mul(monthlyRateBP.mul(monthlyRateBP.add(10000)) ^ ls.numOfPayments)
            .div(monthlyRateBP.add(10000) ^ ls.numOfPayments.sub(10000));
    }

    /**
     * @notice Calculates the monthly payment for interest only borrowing
     */
    function calcInterestOnlyMonthlyPayment()
        private
        view
        returns (uint256 amount)
    {
        LoanInfo storage li = loanInfo;
        return li.loanAmount.mul(li.apr_in_bps).div(120000); //1200=10000*12
    }

    /**
     * @notice Gets the information of the next payment due
     * @return totalAmount the full amount due for the next payment
     * @return principal the amount towards principal
     * @return interest the amount towards interest
     * @return fees the amount towards fees
     * @return dueDate the datetime of when the next payment is due
     */
    function getNextPayment()
        public
        virtual
        override
        returns (
            uint256 totalAmount,
            uint256 principal,
            uint256 interest,
            uint256 fees,
            uint256 dueDate
        )
    {
        fees = assessLateFee();
        LoanInfo storage li = loanInfo;
        LoanState storage ls = loanState;
        // For loans w/ fixed payments, the portion towards interest is this month's interest charge,
        // which is remaining principal times monthly interest rate. The difference b/w the total amount
        // and the interest payment pays down principal.
        uint256 remainingPrincipal = li.loanAmount - ls.principalPaidBack;
        interest = remainingPrincipal.mul(li.apr_in_bps).div(120000); // 120000=10000*12
        principal = ls.nextAmountDue - interest;
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
     * @return totalAmount the full amount due for the next payment
     * @return principal the amount towards principal
     * @return interest the amount towards interest
     * @return fees the amount towards fees
     * @return dueDate the datetime of when the next payment is due
     */
    function getNextPaymentInterestOnly()
        public
        virtual
        returns (
            uint256 totalAmount,
            uint256 principal,
            uint256 interest,
            uint256 fees,
            uint256 dueDate
        )
    {
        fees = assessLateFee();
        LoanInfo storage li = loanInfo;

        interest = li.loanAmount.mul(li.apr_in_bps).div(120000); //120000 = 10000 * 12
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
    function getPayoffInfo()
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
        LoanInfo storage li = loanInfo;
        LoanState storage ls = loanState;
        principal = li.loanAmount - ls.principalPaidBack;
        interest = principal.mul(li.apr_in_bps).div(1200); //1200=100*12
        fees = assessLateFee();
        fees.add(assessEarlyPayoffFees());
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
    function getPayoffInfoInterestOnly()
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
        LoanInfo storage li = loanInfo;
        principal = li.loanAmount;
        interest = principal.mul(li.apr_in_bps).div(120000); //1200=10000*12
        fees = assessLateFee();
        fees.add(assessEarlyPayoffFees());
        total = principal + interest + fees;
        return (total, principal, interest, fees, block.timestamp);
    }

    /**
     * @notice Gets high-level information about the loan.
     */
    function getLoanInformation()
        external
        view
        returns (
            uint256 _id,
            uint32 _amount,
            uint32 _paybackPerInterval,
            uint48 _paybackInterval,
            uint32 _interestRateBasis,
            uint48 _nextDueDate,
            uint32 _principalPaidBack,
            uint16 _remainingPayments,
            uint16 _numOfPayments
        )
    {
        LoanInfo storage li = loanInfo;
        LoanState storage ls = loanState;
        return (
            li.id,
            li.loanAmount,
            ls.nextAmountDue,
            ls.paymentInterval,
            li.apr_in_bps,
            ls.nextDueDate,
            ls.principalPaidBack,
            ls.remainingPayments,
            ls.numOfPayments
        );
    }

    /**
     * @notice Gets the balance of principal
     * @return amount the amount of the balance
     */
    function getCreditBalance()
        external
        view
        virtual
        override
        returns (uint256 amount)
    {
        LoanInfo storage li = loanInfo;
        LoanState storage ls = loanState;
        amount = li.loanAmount.sub(ls.principalPaidBack);
    }

    function protoNotPaused() internal view {
        require(
            HumaConfig(humaConfig).isProtocolPaused() == false,
            "HumaLoan:PROTOCOL_PAUSED"
        );
    }
}
