// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/utils/CountersUpgradeable.sol";

contract RealWorldReceivableStorage {
    using CountersUpgradeable for CountersUpgradeable.Counter;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    CountersUpgradeable.Counter internal _tokenIdCounter;

    struct RealWorldReceivableInfo {
        // The address of the pool that's expected to be paid out for this receivable
        address poolAddress;
        // The ERC20 token used to settle the receivable
        address paymentToken;
        // The total expected payment amount of the receivable
        uint96 receivableAmount;
        // The amount of the receivable that has been paid so far
        uint96 paidAmount;
        // The date at which the receivable is expected to be fully paid
        uint64 maturityDate;
        // The date at which the receivable is created
        uint64 creationDate;
        // The ISO 4217 currency code of the receivable, if paid in fiat
        uint16 currencyCode;
    }

    // Map tokenId to receivable information
    mapping(uint256 => RealWorldReceivableInfo) public receivableInfoMapping;

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[100] private __gap;
}
