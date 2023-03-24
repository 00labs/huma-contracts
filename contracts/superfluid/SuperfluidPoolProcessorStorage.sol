// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

contract SuperfluidPoolProcessorStorage {
    struct StreamInfo {
        address borrower;
        uint256 lastStartTime;
        uint256 endTime;
        uint256 flowrate;
        uint256 receivedAmount;
    }

    /// mapping from the keccak256 hash of the receivableAddress and receivableParam to
    /// the borrower address. This is needed for us to locate the borrower using
    /// the received receivable asset.
    mapping(bytes32 => StreamInfo) internal _streamInfoMapping;

    /// mapping from the keccak256 hash of the Super token address and flowId to
    /// the keccak256 hash of the receivableAddress and receivableParam(tokenId)
    mapping(bytes32 => bytes32) internal _flowMapping;

    uint256[100] private __gap;
}
