//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {BaseStructs as BS} from "./libraries/BaseStructs.sol";
import "hardhat/console.sol";

contract BaseCreditPoolStorage {
    // Divider to get monthly interest rate from APR BPS. 10000 * 12
    uint256 private constant BPS_DIVIDER = 120000;
    uint256 private constant HUNDRED_PERCENT_IN_BPS = 10000;
    uint256 private constant SECONDS_IN_A_YEAR = 31536000;

    // mapping from wallet address to the credit record
    mapping(address => BS.CreditRecord) internal _creditRecordMapping;
    // mapping from wallet address to the receivable supplied by this wallet
    mapping(address => BS.ReceivableInfo) internal _receivableInfoMapping;

    // mapping from wallet address to its index in _creditLines for lookup and removal
    mapping(address => uint32) internal _creditLinesIndex;
    // array of all wallets with issued credit lines
    address[] internal _creditLines;
    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[100] private __gap;

    // Adds the wallet to _creditLines and returns its index.
    function addCreditLine(address newCreditLine) internal returns (uint32) {
        if (_creditLinesIndex[newCreditLine] != 0) return _creditLinesIndex[newCreditLine];

        _creditLines.push(newCreditLine);
        _creditLinesIndex[newCreditLine] = uint32(_creditLines.length);

        return _creditLinesIndex[newCreditLine];
    }

    // In-place replacement of an element without needing to shift all elements.
    // Note that this assumes _creditLines is kept unordered
    function removeCreditLine(address toRemove) internal returns (bool) {
        uint32 index = _creditLinesIndex[toRemove];

        if (index == 0 || index > _creditLines.length) return false;
        // Index is intentionally not zero-indexed to handle the case where address
        // is not in _creditLinesIndex
        index = index - 1;

        // Clear the removed index in _creditLinesIndex
        _creditLinesIndex[toRemove] = 0;

        // Check if the array needs shifting
        if (index != _creditLines.length - 1) {
            // Replace the removed value with the last element in the array
            _creditLines[index] = _creditLines[_creditLines.length - 1];
            // Re-assign the shifted value's index in _creditLinesIndex if the array needs shifting.
            // Note that indexes aren't zero indexed hence the + 1
            _creditLinesIndex[_creditLines[index]] = index + 1;
        }

        _creditLines.pop();

        return true;
    }
}
