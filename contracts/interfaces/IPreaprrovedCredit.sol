//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

/**
 * @notice Interface for contracts that can record pre-approved credit request
 */
interface IPreapprovedCredit {
    /**
     * @param _borrower the borrower address
     * @param _creditAmount the limit of the credit
     * @param _collateralAsset the collateral asset used for this credit
     * @param _collateralParam additional parameter of the collateral asset, e.g. NFT tokenid
     * @param _collateralAmount amount of the collateral asset
     * @param _intervalInDays time interval for each payback in units of days
     * @param _remainingPeriods the number of pay periods for this credit
     */
    function recordPreapprovedCredit(
        address _borrower,
        uint256 _creditAmount,
        address _collateralAsset,
        uint256 _collateralAmount,
        uint256 _collateralParam,
        uint256 _intervalInDays,
        uint256 _remainingPeriods
    ) external;
}
