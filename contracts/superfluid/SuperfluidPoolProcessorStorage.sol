// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

contract SuperfluidPoolProcessorStorage {
    address public host;

    address public cfa;

    struct StreamInfo {
        address borrower;
        uint256 lastStartTime;
        uint256 endTime;
        uint256 flowrate;
        uint256 receivedFlowAmount;
        uint256 receivedAllowanceAmount;
    }

    /// mapping from the keccak256 hash of the receivableAddress and receivableId to
    /// the borrower address. This is needed for us to locate the borrower using
    /// the received receivable asset.
    mapping(bytes32 => StreamInfo) internal _streamInfoMapping;

    /// mapping from the keccak256 hash of the Super token address and flowId to
    /// the keccak256 hash of the receivableAddress and receivableId
    mapping(bytes32 => bytes32) internal _flowMapping;

    uint256[100] private __gap;
}
