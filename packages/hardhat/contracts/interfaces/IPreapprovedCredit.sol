//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

interface IPreapprovedCredit {
    function recordPreapprovedCreditRequest(
        address borrower,
        uint256 borrowAmount,
        address collateralAsset,
        uint256 collateralAmount,
        uint256 collateralParam,
        uint256 _intervalInDays,
        uint256 _remainingPayments
    ) external;
}
