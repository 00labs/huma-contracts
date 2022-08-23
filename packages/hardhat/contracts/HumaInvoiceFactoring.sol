//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "./interfaces/IPreapprovedCredit.sol";

import "./BaseCreditPool.sol";

/**
 * @notice Invoice Financing
 * @dev please note abbreviation HumaIF is used in error messages to shorten the length of error msg.
 */
contract HumaInvoiceFactoring is IPreapprovedCredit, BaseCreditPool {
    using BaseStructs for HumaInvoiceFactoring;

    constructor(
        address _poolToken,
        address _humaConfig,
        address _poolLockerAddress,
        address _feeManagerAddress,
        string memory _poolName,
        string memory _hdtName,
        string memory _hdtSymbol
    )
        BaseCreditPool(
            _poolToken,
            _humaConfig,
            _poolLockerAddress,
            _feeManagerAddress,
            _poolName,
            _hdtName,
            _hdtSymbol
        )
    {}

    function recordPreapprovedCreditRequest(
        address borrower,
        uint256 borrowAmount,
        address collateralAsset,
        uint256 collateralParam,
        uint256 collateralAmount,
        uint256 _paymentIntervalInDays,
        uint256 _remainingPayments
    ) public virtual override {
        onlyApprovers();

        // Pool status and data validation happens within initiate().
        initiate(
            borrower,
            borrowAmount,
            collateralAsset,
            collateralParam,
            collateralAmount,
            poolAprInBps,
            interestOnly,
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
        protocolAndpoolOn();
        onlyApprovers();
        BaseStructs.CreditRecord memory cr = creditRecordMapping[borrower];

        // todo handle multiple payments.

        require(asset == address(poolToken), "HumaIF:WRONG_ASSET");

        // todo decide what to do if the payment amount is insufficient.
        require(amount >= cr.balance, "HumaIF:AMOUNT_TOO_LOW");

        // todo verify that we have indeeded received the payment.

        uint256 lateFee = IFeeManager(feeManagerAddress).calcLateFee(
            cr.dueAmount,
            cr.dueDate,
            lastLateFeeDateMapping[borrower],
            cr.paymentIntervalInDays
        );
        uint256 refundAmount = amount - cr.balance - lateFee;

        // Sends the remainder to the borrower
        cr.balance = 0;
        cr.remainingPayments = 0;

        processRefund(borrower, refundAmount);

        return true;
    }

    function processRefund(address receiver, uint256 amount)
        internal
        returns (bool)
    {
        PoolLocker locker = PoolLocker(poolLockerAddress);
        locker.transfer(receiver, amount);

        return true;
    }

    function originatePreapprovedCredit(
        address borrower,
        uint256 borrowAmount,
        address collateralAsset,
        uint256 collateralParam,
        uint256 collateralAmount,
        uint256 _paymentIntervalInDays,
        uint256 _remainingPayments
    ) external {
        // There are repeated calls to onlyApprovers() here and the called functions.
        // This is intentional in case we make changes and forget to add access control
        onlyApprovers();

        recordPreapprovedCreditRequest(
            borrower,
            borrowAmount,
            collateralAsset,
            collateralParam,
            collateralAmount,
            _paymentIntervalInDays,
            _remainingPayments
        );

        originateCollateralizedCredit(
            borrower,
            borrowAmount,
            collateralAsset,
            collateralParam,
            collateralAmount
        );
    }
}
