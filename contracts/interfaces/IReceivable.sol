//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

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
     * @param _intervalInDays time interval for each payback in units of days
     * @param _remainingPeriods the number of pay periods for this credit
     */
    function recordPreapprovedCredit(
        address _borrower,
        uint256 _creditAmount,
        address _receivableAsset,
        uint256 _receivableAmount,
        uint256 _receivableParam,
        uint256 _intervalInDays,
        uint256 _remainingPeriods
    ) external;

        /**
     * @notice reports after an payment is received for the borrower from a source
     * other than the borrower wallet
     */
    function onReceivedPayment(
        address borrower,
        address asset,
        uint256 amount
    ) external;
}
