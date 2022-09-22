//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/IReceivable.sol";

import "./BaseCreditPool.sol";

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
     * @notice Borrower makes one payment. If this is the final payment,
     * it automatically triggers the payoff process.
     * @dev "HumaIF:WRONG_ASSET" reverted when asset address does not match
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
        onlyEvaluationAgent();
        BaseStructs.CreditRecord memory cr = _creditRecordMapping[borrower];

        require(asset == address(_underlyingToken), "HumaIF:WRONG_ASSET");

        // todo handle multiple payments.
        // todo decide what to do if the payment amount is insufficient.
        require(amount >= cr.unbilledPrincipal, "HumaIF:AMOUNT_TOO_LOW");

        // todo For security, verify that we have indeeded received the payment.
        // If asset is not received, EA might be compromised. Emit event.

        uint256 lateFee = IFeeManager(_feeManagerAddress).calcLateFee(
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
