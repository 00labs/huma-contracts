//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/IReceivable.sol";

import "./BaseCreditPool.sol";
import "./Errors.sol";

/**
 * @notice Receivable Factoring is the process for the receivable owner to trade in their
 * receivable for immediate access to portion of the fund tied with the receivable, and
 * receive the remainder minus fees after the receivable is paid in full.
 */
contract ReceivableFactoringPool is BaseCreditPool, IReceivable {
    using SafeERC20 for IERC20;

    event ReceivedPayment(
        address indexed sender,
        address indexed borrower,
        address asset,
        uint256 amount,
        uint256 paymentId
    );

    /**
     * @notice After the EA (EvalutionAgent) has approved a factoring, it calls this function
     * to record the approval on chain and mark as factoring as approved, which will enable
     * the borrower to drawdown (borrow) from the approved credit.
     * @param borrower the borrower address
     * @param creditLimit the limit of the credit
     * @param receivableAsset the receivable asset used for this credit
     * @param receivableParam additional parameter of the receivable asset, e.g. NFT tokenid
     * @param receivableAmount amount of the receivable asset
     * @param intervalInDays time interval for each payback in units of days
     * @param remainingPeriods the number of pay periods for this credit
     * @dev Only Evaluation Agents for this contract can call this function.
     */
    function recordApprovedCredit(
        address borrower,
        uint256 creditLimit,
        address receivableAsset,
        uint256 receivableParam,
        uint256 receivableAmount,
        uint256 intervalInDays,
        uint256 remainingPeriods
    ) external virtual override {
        onlyEAServiceAccount();

        _receivableRequirementCheck(creditLimit, receivableAmount);

        // Populates fields related to receivable
        if (receivableAsset != address(0)) {
            BS.ReceivableInfo memory ri;
            ri.receivableAsset = receivableAsset;
            ri.receivableParam = receivableParam;
            ri.receivableAmount = uint88(receivableAmount);
            _receivableInfoMapping[borrower] = ri;
        }

        // Pool status and data validation happens within initiate().
        initiateCredit(
            borrower,
            creditLimit,
            _poolConfig.poolAprInBps(),
            intervalInDays,
            remainingPeriods,
            true
        );
    }

    /**
     * @notice Borrower makes one payment. If this is the final payment,
     * it automatically triggers the payoff process.
     * @dev Reverted with assetNotMatchWithPoolAsset() when asset address does not match
     *
     */
    function onReceivedPayment(
        address borrower,
        address asset,
        uint256 amount,
        uint256 paymentId
    ) external virtual override {
        // todo Need to  discuss whether to accept payments when the protocol is paused.
        protocolAndPoolOn();
        onlyPDSServiceAccount();
        BaseStructs.CreditRecord memory cr = _creditRecordMapping[borrower];

        if (asset != address(_underlyingToken)) revert Errors.assetNotMatchWithPoolAsset();

        // todo handle multiple payments.
        // todo decide what to do if the payment amount is insufficient.
        // todo add test to cover the case when the amount is too low
        if (amount < cr.unbilledPrincipal) revert Errors.amountTooLow();

        if (_processedPaymentIds[paymentId] == true) revert Errors.paymentAlreadyProcessed();
        _processedPaymentIds[paymentId] = true;

        // todo For security, verify that we have indeeded received the payment.
        // If asset is not received, EA might be compromised. Emit event.

        uint256 lateFee = IFeeManager(_feeManager).calcLateFee(
            cr.dueDate,
            cr.totalDue,
            cr.unbilledPrincipal
        );
        uint256 refundAmount = amount - cr.totalDue - lateFee;

        // Sends the remainder to the borrower
        cr.unbilledPrincipal = 0;
        cr.remainingPeriods = 0;

        _creditRecordMapping[borrower] = cr;

        disperseRemainingFunds(borrower, refundAmount);

        emit ReceivedPayment(msg.sender, borrower, asset, amount, paymentId);
    }

    /**
     * @notice disperse the remaining funds associated with the factoring to the borrower
     * @param receiver receiver of the funds, namely, the borrower
     * @param amount the amount of the dispersement
     */
    function disperseRemainingFunds(address receiver, uint256 amount) internal {
        _underlyingToken.safeTransfer(receiver, amount);
    }
}
