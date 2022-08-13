//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./BaseCreditPool.sol";
import "./PoolLocker.sol";
import "./interfaces/ICredit.sol";
import "./interfaces/IPreapprovedCredit.sol";
import "./interfaces/IPoolLocker.sol";
import "./libraries/SafeMathInt.sol";
import "./libraries/SafeMathUint.sol";
import "./libraries/BaseStructs.sol";

import "hardhat/console.sol";

/**
 * @notice Invoice Financing
 * @dev please note abbreviation HumaIF is used in error messages to shorten the length of error msg.
 */
contract HumaInvoiceFactoring is IPreapprovedCredit, BaseCreditPool {
    using BaseStructs for HumaInvoiceFactoring;

    constructor(
        address _poolToken,
        address _humaConfig,
        address _poolLockerAddr,
        address _feeManagerAddr
    )
        BaseCreditPool(
            _poolToken,
            _humaConfig,
            _poolLockerAddr,
            _feeManagerAddr
        )
    {}

    function postPreapprovedCreditRequest(
        address borrower,
        uint256 borrowAmt,
        address collateralAsset,
        uint256 collateralAmt,
        uint256 _paymentIntervalInDays,
        uint256 _remainingPayments
    ) public virtual override {
        poolOn();
        require(
            creditApprovers[msg.sender] == true,
            "HumaIF:ILLEGAL_CREDIT_POSTER"
        );

        // Borrowers must not have existing loans from this pool
        require(
            creditRecordMapping[msg.sender].state ==
                BaseStructs.CreditState.Deleted,
            "HumaIF:DENY_EXISTING_LOAN"
        );

        // Borrowing amount needs to be higher than min for the pool.
        require(borrowAmt >= minBorrowAmt, "HumaIF:SMALLER_THAN_LIMIT");

        // Borrowing amount needs to be lower than max for the pool.
        require(maxBorrowAmt >= borrowAmt, "HumaIF:GREATER_THAN_LIMIT");

        initiate(
            borrower,
            borrowAmt,
            collateralAsset,
            collateralAmt,
            aprInBps,
            _paymentIntervalInDays,
            _remainingPayments
        );
        approveCredit(borrower);
    }

    /**
     * @notice Borrower makes one payment. If this is the final payment,
     * it automatically triggers the payoff process.
     * @dev "HumaIF:WRONG_ASSET" reverted when asset address does not match
     * @return status if the payment is successful or not
     *
     */
    function receivedPayment(
        address borrower,
        address asset,
        uint256 amount
    ) public virtual returns (bool) {
        // todo Need to  discuss more on whether to accept invoice pyaments from RN
        // when the protocol is paused.
        // todo add security control to make sure the caller is either borrower or approver
        protoNotPaused();
        BaseStructs.CreditRecord memory cr = creditRecordMapping[borrower];

        // todo handle multiple payments.

        require(asset == address(poolToken), "HumaIF:WRONG_ASSET");

        // todo decide what to do if the payment amount is insufficient.
        require(amount >= cr.remainingPrincipal, "HumaIF:AMOUNT_TOO_LOW");

        // todo verify that we have indeeded received the payment.

        uint256 lateFee = IFeeManager(feeManagerAddr).calcLateFee(
            cr.nextAmtDue,
            cr.nextDueDate,
            lastLateFeeDateMapping[borrower],
            cr.paymentIntervalInDays
        );
        uint256 refundAmt = amount - cr.remainingPrincipal - lateFee;

        // Sends the remainder to the borrower
        cr.remainingPrincipal = 0;
        cr.remainingPayments = 0;

        processRefund(borrower, refundAmt);

        return true;
    }

    function processRefund(address receiver, uint256 amount)
        public
        returns (bool)
    {
        PoolLocker locker = PoolLocker(poolLockerAddr);
        locker.transfer(receiver, amount);

        return true;
    }

    function originateCreditWithPreapproval(
        address borrower,
        uint256 borrowAmt,
        address collateralAsset,
        uint256 collateralParam,
        uint256 collateralAmount,
        uint256 _paymentIntervalInDays,
        uint256 _remainingPayments
    ) external {
        postPreapprovedCreditRequest(
            borrower,
            borrowAmt,
            collateralAsset,
            collateralAmount,
            _paymentIntervalInDays,
            _remainingPayments
        );

        originateCreditWithCollateral(
            borrower,
            borrowAmt,
            collateralAsset,
            collateralParam,
            collateralAmount
        );
    }
}
