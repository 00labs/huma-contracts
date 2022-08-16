//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

interface IPreapprovedCredit {
    function recordPreapprovedCreditRequest(
        address borrower,
        uint256 borrowAmt,
        address collateralAsset,
        uint256 collateralAmt,
        uint256 _paymentIntervalInDays,
        uint256 _remainingPayments
    ) external;
}
