//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./HumaConfig.sol";
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
    using SafeMathUint for uint256;

    uint256 globalLoanId; // todo move to the Factory once it is implementated

    address public poolLocker;
    address public treasury;
    address public borrower;
    LoanInfo public loanInfo;

    // todo reorder the fields for packing. expect to use 4 256bits storage units.
    struct LoanInfo {
        // fields related to the overall picture of the loan
        uint256 loanId; // 32 bits
        address liquidityAsset; // 160 bits
        uint256 issuedTimestamp; // 48 bits
        uint256 loanAmount; // 32 bits, original borrow amount
        uint256 numOfPayments; // 16 bits
        uint256 paymentInterval; // 32 bits. in seconds, but can be changed to days
        uint256 apr_in_bps; // 16 bits, interest rate in bps
        // fields related to all the fees
        uint256 platform_fee_flat; // 16 bits
        uint256 platform_fee_bps; // 16 bits
        uint256 late_fee_flat; // 16 bits
        uint256 late_fee_bps; // 16 bits
        uint256 early_payoff_fee_flat; // 16 bits
        uint256 early_payoff_fee_bps; // 16 bits
        // fields related to payment tracking
        uint256 feesDue; // 32 bits
        uint256 principalPaidBack; // 32 bits, remaining principal balance
        uint256 nextAmountDue; // 32 bits
        uint256 nextDueDate; // 48 bits
        uint256 lastPaymentTimestamp; // 48 bits
        uint256 lastLateFeeTimestamp; // 48 bits
        uint256 remainingPayments; // 32 bits
        // fields related to collateral
        address collateralAsset; // 160 bits
        uint256 collateralAmount; // 32 bits
        uint256 amountLiquidated; // 32 bits
        uint256 amountRecovered; // 32 bits
        uint256 amountDefaulted; // 32 bits
        uint256 liquidationExcess; // 32 bits
    }

    /// Contructor accepts 0 para per FactoryClone requirement.
    constructor() {}

    /**
     * @notice the initiation of a loan
     * @param _poolLocker the address of pool locker that holds the liquidity asset
     * @param _treasury the address of the treasury that accepts fees
     * @param _borrower the address of the borrower
     * @param liquidityAsset the address of the liquidity asset that the borrower obtains
     * @param liquidityAmount the amount of the liquidity asset that the borrower obtains
     * @param collateralAsset the address of the collateral asset.
     * @param collateralAmount the amount of the collateral asset
     * @param terms[] the terms for the loan.
     *                [0] numOfPayments
     *                [1] payment_interval, in seconds
     *                [2] apr_in_bps
     *                [3] platform_fee_flat
     *                [4] platform_fee_bps
     *                [5] late_fee_flat
     *                [6] late_fee_bps
     *                [7] early_payff_fee_flat
     *                [8] early_payoff_fee_bps
     */
    function originateCredit(
        address _poolLocker,
        address _treasury,
        address _borrower,
        address liquidityAsset,
        uint256 liquidityAmount,
        address collateralAsset,
        uint256 collateralAmount,
        uint256[] calldata terms
    ) external returns (uint256 netAmount) {
        poolLocker = _poolLocker;
        treasury = _treasury;
        borrower = _borrower;

        // Populate LoanInfo object
        LoanInfo memory li;
        li.loanId = ++globalLoanId;
        li.liquidityAsset = liquidityAsset;
        li.loanAmount = liquidityAmount;
        li.collateralAsset = collateralAsset;
        li.collateralAmount = collateralAmount;
        li.numOfPayments = terms[0];
        li.paymentInterval = terms[1];
        li.apr_in_bps = terms[2];

        li.platform_fee_flat = terms[3];
        li.platform_fee_bps = terms[4];
        li.late_fee_flat = terms[5];
        li.late_fee_bps = terms[6];
        li.early_payoff_fee_flat = terms[7];
        li.early_payoff_fee_bps = terms[8];

        li.principalPaidBack = 0;
        li.issuedTimestamp = block.timestamp;
        li.lastPaymentTimestamp = 0;
        li.lastLateFeeTimestamp = 0;
        li.nextDueDate = block.timestamp + li.paymentInterval;
        // todo Calculate the next payment for different payback interval.
        li.nextAmountDue = calcMonthlyPayment();
        li.remainingPayments = li.numOfPayments;

        // Calculate platform fee due
        uint256 fees;
        if (li.platform_fee_flat != 0) fees = li.platform_fee_flat;
        if (li.platform_fee_bps != 0)
            fees += (li.loanAmount * li.platform_fee_bps) / 100;

        loanInfo = li;

        // CRITICAL: Transfer fees to treasury, remaining proceeds to the borrower
        netAmount = liquidityAmount - fees;
        IHumaPoolLocker locker = IHumaPoolLocker(poolLocker);
        locker.transfer(treasury, fees);
        locker.transfer(msg.sender, liquidityAmount - fees);
        return netAmount;
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
        returns (bool)
    {
        LoanInfo storage li = loanInfo;

        require(asset == li.liquidityAsset, "HumaLoan:WRONG_ASSET");

        require(li.remainingPayments > 0, "HumaLoan:LOAN_PAID_OFF_ALREADY");

        uint256 totalAmount;
        uint256 principal;
        uint256 interest;
        uint256 fees;
        if (li.remainingPayments == 1) {
            (totalAmount, principal, interest, fees, ) = getPayoffInfo();
        } else {
            (totalAmount, principal, interest, fees, ) = getNextPayment();
        }

        // Do not accept partial payments. Requires amount to be able to cover
        // the next payment and all the outstanding fees.
        require(amount >= totalAmount, "HumaLoan:AMOUNT_TOO_LOW");

        if (li.remainingPayments == 1) {
            li.principalPaidBack = li.loanAmount; // avoids penny difference
            li.lastPaymentTimestamp = block.timestamp;
            li.feesDue = 0;
            li.nextAmountDue = 0;
            li.nextDueDate = 0;
            li.remainingPayments = 0;
        } else {
            li.feesDue = 0;
            // Covers the case when the user paid extra amount than required
            // todo needs to address the case when the amount paid can actually pay off
            li.principalPaidBack += (amount - interest - fees);
            li.nextDueDate += li.paymentInterval;
            li.lastPaymentTimestamp = block.timestamp;
            li.remainingPayments -= 1;
        }

        // todo, use config to get treasury address
        IERC20 assetIERC20 = IERC20(li.liquidityAsset);
        assetIERC20.transfer(address(0), fees);
        assetIERC20.transfer(poolLocker, totalAmount);

        return true;
    }

    /**
     * @notice Assess and charge penalty fee for early payoff.
     */
    function assessEarlyPayoffFees() private returns (uint256) {
        LoanInfo storage li = loanInfo;
        uint256 penalty;
        if (li.early_payoff_fee_flat > 0) penalty = li.early_payoff_fee_flat;
        if (li.early_payoff_fee_bps > 0)
            penalty += ((li.loanAmount - li.principalPaidBack) *
                (li.early_payoff_fee_bps / 100 / 12));
        li.feesDue.add(penalty);
        loanInfo = li;
        return penalty;
    }

    /**
     * @notice Borrower requests to payoff the credit
     * @return status if the payoff is successful or not
     */
    function payoff(address asset, uint256 amount)
        external
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

        // if block.timestamp > lastPaymentTimestamp + interval and
        // there is no late fee charged between lastPaymentTimestamp and block timestamp
        uint256 newFees;
        if (
            block.timestamp > li.lastPaymentTimestamp + li.paymentInterval &&
            li.lastLateFeeTimestamp < li.lastPaymentTimestamp
        ) {
            if (li.late_fee_flat > 0) newFees = li.late_fee_flat;
            if (li.late_fee_bps > 0) {
                newFees += li.nextAmountDue.mul(
                    li.late_fee_bps.div(100).div(12)
                );
            }
            li.feesDue.add(newFees);
            li.lastLateFeeTimestamp = block.timestamp;
            loanInfo = li;
        }
        return newFees;
    }

    /**
     * @notice Triggers the default process
     * @return losses the amount of remaining losses to the pool after collateral
     * liquidation, pool cover, and staking.
     */
    function triggerDefault(address _borrower)
        external
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
        uint256 monthlyRate = li.apr_in_bps / 100 / 12;
        monthlyPayment = li
            .loanAmount
            .mul(monthlyRate.mul(monthlyRate.add(1)) ^ li.numOfPayments)
            .div(monthlyRate.add(1) ^ li.numOfPayments.sub(1));
    }

    /**
     * @notice Calculates the monthly payment for interest only borrowing
     */
    function calcInterestOnlyMonthlyPayment(LoanInfo calldata li)
        private
        pure
        returns (uint256 amount)
    {
        uint256 monthlyRate = li.apr_in_bps / 100 / 12;
        return li.loanAmount.mul(monthlyRate);
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
        uint256 remainingPrincipal = li.loanAmount - li.principalPaidBack;
        uint256 monthlyRate = li.apr_in_bps / 100 / 12;
        interest = remainingPrincipal * monthlyRate;
        principal = li.nextAmountDue - interest;
        fees = assessLateFee();
        return (
            principal + interest + fees,
            principal,
            interest,
            fees,
            li.nextDueDate
        );
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
        uint256 monthlyRate = li.apr_in_bps / 100 / 12;
        principal = li.loanAmount - li.principalPaidBack;
        interest = principal.mul(monthlyRate);
        fees = assessLateFee();
        fees += assessEarlyPayoffFees();
        total = principal + interest + fees;
        return (total, principal, interest, fees, li.nextDueDate);
    }

    function getLoanInformation()
        external
        view
        returns (
            uint256 _amount,
            uint256 _principalPaidBack,
            uint256 _issuedTimestamp,
            uint256 _lastPaymentTimestamp,
            uint256 _paybackPerInterval,
            uint256 _paybackInterval,
            uint256 _interestRateBasis
        )
    {
        LoanInfo storage li = loanInfo;
        return (
            li.loanAmount,
            li.principalPaidBack,
            li.issuedTimestamp,
            li.lastPaymentTimestamp,
            li.nextAmountDue,
            li.paymentInterval,
            li.apr_in_bps
        );
    }

    /**
     * @notice Gets the balance of principal
     * @return amount the amount of the balance
     */
    function getPrincipalBalance() external view returns (uint256 amount) {
        LoanInfo storage li = loanInfo;
        return li.loanAmount - li.principalPaidBack;
    }
}
