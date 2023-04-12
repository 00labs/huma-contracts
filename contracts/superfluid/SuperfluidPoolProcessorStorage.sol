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

    /// The mapping from the keccak256 hash of the receivableAddress and receivableId to
    /// the borrower address. This is needed for us to locate the borrower using
    /// the received receivable asset.
    mapping(uint256 => StreamInfo) internal _streamInfoMapping;

    /// The mapping from the keccak256 hash of the Super token address and flowId to
    /// the keccak256 hash of the receivableAddress and receivableId.
    /// It is used to find StreamInfo when flow is updated. But there is a limitation,
    /// it only can support one StreamInfo now. For example, there are 2 TradableStream,
    /// payer -> payee1, payer -> payee2, both payee1 and payee2 called mintAndDrawdown,
    /// the above 2 flows combined one new flow payer -> processor. If the payer -> processor flow
    /// was updated, current solution can't recognzie the impact for each credit. It needs more consideration
    /// of product and code work to solve this kind of problems.
    mapping(bytes32 => uint256) internal _flowMapping;

    uint256[100] private __gap;
}
