// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;
import {BaseStructs as BS} from "../../libraries/BaseStructs.sol";

contract StreamFactoringPoolStorage {
    /// mapping from wallet address to the receivable supplied by this wallet
    mapping(address => BS.ReceivableInfo) internal _receivableInfoMapping;

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
}
