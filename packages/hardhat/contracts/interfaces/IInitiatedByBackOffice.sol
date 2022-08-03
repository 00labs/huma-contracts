//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface IInvoiceFactoring {
    function postApprovedCreditRequest(
        address borrower,
        uint256 _borrowAmt,
        uint256 _paymentInterval,
        uint256 _numOfPayments,
        uint256[] memory _terms
    ) external returns (address);
}
