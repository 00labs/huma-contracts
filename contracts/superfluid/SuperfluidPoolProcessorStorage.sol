// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

contract SuperfluidPoolProcessorStorage {
    address public host;

    address public cfa;

    address public tradableStream;

    struct StreamInfo {
        address borrower;
        uint96 flowrate;
        uint64 lastStartTime;
        uint64 endTime;
        uint256 receivedFlowAmount;
    }

    /// mapping from the keccak256 hash of the receivableAddress and receivableId to
    /// the borrower address. This is needed for us to locate the borrower using
    /// the received receivable asset.
    mapping(uint256 => StreamInfo) internal _streamInfoMapping;

    /// mapping from the keccak256 hash of the Super token address and flowId to
    /// the keccak256 hash of the receivableAddress and receivableId
    mapping(bytes32 => uint256) internal _flowMapping;

    uint256[100] private __gap;
}
