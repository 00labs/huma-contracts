// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

/**
 * @notice Interface for contracts that can record pre-approved credit request
 */
interface IReceivable {
    /**
     * @param _borrower the borrower address
     * @param _creditAmount the limit of the credit
     * @param _receivableAsset the receivable asset used for this credit
     * @param _receivableParam additional parameter of the receivable asset, e.g. NFT tokenid
     * @param _receivableAmount amount of the receivable asset
     * @param _intervalInSeconds time interval for each payback in units of days
     * @param _remainingPeriods the number of pay periods for this credit
     */
    function recordApprovedCredit(
        address _borrower,
        uint256 _creditAmount,
        address _receivableAsset,
        uint256 _receivableAmount,
        uint256 _receivableParam,
        uint256 _intervalInSeconds,
        uint256 _remainingPeriods,
        uint256 aprInBps
    ) external;

    /**
     * @notice reports after an payment is received for the borrower from a source
     * other than the borrower wallet
     */
    function onReceivedPayment(
        address borrower,
        uint256 amount,
        bytes32 paymentIdHash
    ) external;

    /**
     * @notice Reports if a payment has been processed
     * @param paymentIdHash the hash of the payment id
     */
    function isPaymentProcessed(bytes32 paymentIdHash) external view returns (bool);

    /// Makes drawdown using receivables included in the approval of the credit line
    function drawdownWithReceivable(
        address _borrower,
        uint256 borrowAmount,
        address receivableAsset,
        uint256 receivableParam
    ) external;
}
