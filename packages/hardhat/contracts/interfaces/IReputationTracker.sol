//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IReputationTracker {
    enum TrackingType {
        Borrowing,
        Payoff,
        Default
    }

    event ReputationReported(
        address reporter,
        address borrower,
        TrackingType mode
    );
    event ReputationTrackingRevoked(address reporter, address borrower);

    function report(address borrower, TrackingType mode) external;

    function revokeTracking(address borrower) external;
}
