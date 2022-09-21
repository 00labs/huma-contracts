//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ICredit {
    function requestCredit(
        uint256 _borrowAmount,
        uint256 _intervalInDays,
        uint256 _numOfPayments
    ) external;

    /**
     * @param _borrower the borrower address
     * @param _creditAmount the limit of the credit
     * @param _receivableAsset the receivable asset used for this credit
     * @param _receivableParam additional parameter of the receivable asset, e.g. NFT tokenid
     * @param _receivableAmount amount of the receivable asset
     * @param _intervalInDays time interval for each payback in units of days
     * @param _remainingPeriods the number of pay periods for this credit
     */
    function recordApprovedCredit(
        address _borrower,
        uint256 _creditAmount,
        address _receivableAsset,
        uint256 _receivableAmount,
        uint256 _receivableParam,
        uint256 _intervalInDays,
        uint256 _remainingPeriods
    ) external;

    function approveCredit(address borrower) external;

    function drawdown(uint256 _borrowAmount) external;

    function drawdownWithReceivable(
        address _borrower,
        uint256 borrowAmount,
        address receivableAsset,
        uint256 receivableParam,
        uint256 receivableCount
    ) external;

    function invalidateApprovedCredit(address _borrower) external;

    function makePayment(
        address _borrower,
        address _asset,
        uint256 _amount
    ) external;

    function triggerDefault(address borrower) external returns (uint256 losses);

    // function assessLateFee(address borrower) external returns (uint256 fees);

    // function assessEarlyPayoffFees(address borrower)
    //     external
    //     returns (uint256 fees);

    // function getNextPayment(address borrower)
    //     external
    //     returns (
    //         uint256 totalAmount,
    //         uint256 principal,
    //         uint256 interest,
    //         uint256 fees,
    //         uint256 dueDate
    //     );

    function isApproved(address borrower) external view returns (bool);
}
