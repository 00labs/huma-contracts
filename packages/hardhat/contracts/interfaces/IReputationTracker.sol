//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IReputationTracker {
    enum TrackingMode {
        Borrowing,
        Payoff,
        Default
    }

    event ReputationReported(
        address reporter,
        address borrower,
        TrackingMode mode
    );
    event ReputationTrackingRevoked(address reporter, address borrower);

    function report(address borrower, TrackingMode mode) external;

    function revokeTracking(address borrower) external;
}
