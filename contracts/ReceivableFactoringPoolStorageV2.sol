// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {BaseStructs as BS} from "./libraries/BaseStructs.sol";

contract ReceivableFactoringPoolStorageV2 {
    address public processor;

    /// mapping from wallet address to the receivable supplied by this wallet
    mapping(address => BS.ReceivableInfo) public receivableInfoMapping;

    uint256[100] private __gap;
}
