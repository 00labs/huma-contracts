//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./ReputationTracker.sol";

contract ReputationTrackerFactory {
    event ReputationTrackerDeployed(address trackerAddress);

    constructor() {}

    // Create a new ReputationTracker.
    function deployReputationTracker(
        string calldata _name,
        string calldata _symbol
    ) external returns (address) {
        ReputationTracker tracker = new ReputationTracker(_name, _symbol);
        tracker.transferOwnership(msg.sender);

        emit ReputationTrackerDeployed(address(tracker));

        return address(tracker);
    }
}
