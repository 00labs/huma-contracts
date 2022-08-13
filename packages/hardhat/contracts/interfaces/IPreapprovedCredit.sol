//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface IPreapprovedCredit {
    function postPreapprovedCreditRequest(
        address borrower,
        uint256 borrowAmt,
        address collateralAsset,
        uint256 collateralAmt,
        uint256 _paymentIntervalInDays,
        uint256 _remainingPayments
    ) external;
}
