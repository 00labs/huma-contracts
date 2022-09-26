//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {BaseStructs as BS} from "./libraries/BaseStructs.sol";

contract BaseCreditPoolStorage {

    /// mapping from wallet address to the credit record
    mapping(address => BS.CreditRecord) internal _creditRecordMapping;
    /// mapping from wallet address to the receivable supplied by this wallet
    mapping(address => BS.ReceivableInfo) internal _receivableInfoMapping;
    mapping(address => BS.CreditRecordStatic) internal _creditRecordStaticMapping;

    mapping(uint256 => bool) internal _processedPaymentIds;
    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[100] private __gap;
}
