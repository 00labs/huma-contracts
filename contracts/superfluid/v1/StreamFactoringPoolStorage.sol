// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;
import {BaseStructs as BS} from "../../libraries/BaseStructs.sol";

contract StreamFactoringPoolStorageV1 {
    /// mapping from wallet address to the receivable supplied by this wallet
    mapping(address => BS.ReceivableInfo) internal _receivableInfoMapping;

    /// mapping from the keccak256 hash of the receivableAddress and receivableParam to
    /// the borrower address. This is needed for us to locate the borrower using
    /// the received receivable asset.
    mapping(bytes32 => address) internal _receivableOwnershipMapping;
}
