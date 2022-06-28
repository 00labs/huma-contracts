//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ICreditTracking {
    event NewCreditTracking(address borrower, address provider, string uri);

    event CreditPaidoff(address borrower, address provider, string uri);

    event CreditDefault(address borrower, address provider, string uri);

    event CreditTrackingRevoked(address borrower, address provider);

    function reportBorrowing(address borrower) external;

    function reportPayoff(address borrower) external;

    function reportDefault(address borrower) external;

    function revokeTracking(address borrower) external;
}
