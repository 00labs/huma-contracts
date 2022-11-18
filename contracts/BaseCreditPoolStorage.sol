// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {BaseStructs as BS} from "./libraries/BaseStructs.sol";

contract BaseCreditPoolStorage {
    /// mapping from wallet address to the credit record
    mapping(address => BS.CreditRecord) internal _creditRecordMapping;
    mapping(address => BS.CreditRecordStatic) internal _creditRecordStaticMapping;

    /// A multiplier over the credit limit, which is up to 80% of the invoice amount,
    /// that determines whether a payment amount should be flagged for review.
    /// It is possible for the actual invoice payment is higher than the invoice amount,
    /// however, it is too high, the chance for a fraud is high and thus requires review.
    uint256 internal constant REVIEW_MULTIPLIER = 5;

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[99] private __gap;
}
