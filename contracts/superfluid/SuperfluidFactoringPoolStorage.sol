// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

contract SuperfluidFactoringPoolStorage {
    /// mapping from the keccak256 hash of the Super token address and flowId to
    /// the keccak256 hash of the receivableAddress and receivableParam(tokenId)
    mapping(bytes32 => bytes32) internal _flowMapping;

    uint256[100] private __gap;
}
