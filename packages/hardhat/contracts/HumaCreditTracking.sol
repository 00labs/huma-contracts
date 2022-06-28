//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/ICreditTracking.sol";
import "./HumaCreditTrackingToken.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "./libraries/Base64.sol";
import "hardhat/console.sol";

/**
 * @notice Huma Credit Tracking is a credit reporting service that uses HumaCreditTrackingToken,
 * a non-transferrable NFT to track wallet's new borrowings, payoffs, and defaults.
 *
 */
contract HumaCreditTracking is ICreditTracking {
    address owner;

    struct CreditTrackingRecord {
        uint256 tokenId;
        uint256 numOfPayoffs;
        uint256 numOfDefaults;
        uint256 numOfOutstandingLoans;
    }

    // Mapping owner address to credit tracking record.
    mapping(address => CreditTrackingRecord) private _records;

    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    HumaCreditTrackingToken private ctt;

    constructor(address _owner) {
        owner = _owner;
        ctt = new HumaCreditTrackingToken(
            "Huma Credit Tracking Token",
            "HumaCTT"
        );
    }

    /**
     * @notice Tracks a borrowing initiated for the wallet owner
     */
    function reportBorrowing(address borrower) external virtual override {
        require(
            owner == msg.sender,
            "Only the contract owner can request a credit tracking."
        );

        if (0 == ctt.balanceOf(borrower)) {
            // Brand-new user, mint the NFT to the user, and set initial values to the counters
            uint256 newItemId = _tokenIds.current();
            ctt.safeMint(borrower, newItemId);
            _tokenIds.increment();
            _records[borrower] = CreditTrackingRecord(newItemId, 0, 0, 1);
        } else {
            _records[borrower].numOfOutstandingLoans += 1;
        }

        // update URI.
        string memory newTokenUri = _getURI(borrower, _records[borrower]);
        ctt.setTokenURI(_records[borrower].tokenId, newTokenUri);

        emit NewCreditTracking(borrower, owner, newTokenUri);
    }

    /**
     * @notice Tracks a pay off made by the borrower
     */
    function reportPayoff(address borrower) external virtual override {
        require(
            owner == msg.sender,
            "Only the contract owner can report a payoff."
        );

        require(
            _records[msg.sender].numOfOutstandingLoans > 0,
            "There is no outstanding loan record for the borrower."
        );

        _records[borrower].numOfPayoffs += 1;
        _records[borrower].numOfOutstandingLoans -= 1;

        // update URI
        string memory newTokenUri = _getURI(borrower, _records[borrower]);
        ctt.setTokenURI(_records[borrower].tokenId, newTokenUri);

        emit CreditPaidoff(borrower, owner, newTokenUri);
    }

    /**
     * @notice Tracks a default of a loan for the borrower
     */
    function reportDefault(address borrower) external virtual override {
        require(
            owner == msg.sender,
            "Only the contract owner can report a payoff."
        );

        // Question: Shall we go ahead to record default even if something
        // is wrong with the outstandingLoans counter in our system.
        require(
            _records[msg.sender].numOfOutstandingLoans > 0,
            "There is no tracking record for the borrower."
        );

        _records[msg.sender].numOfDefaults += 1;
        _records[msg.sender].numOfOutstandingLoans -= 1;

        // update URI
        string memory newTokenUri = _getURI(borrower, _records[borrower]);
        ctt.setTokenURI(_records[borrower].tokenId, newTokenUri);

        emit CreditDefault(borrower, owner, newTokenUri);
    }

    /**
     * @notice Allows the contract to remove the tracking of a borrower.
     * This will highly likely by the borrower's request, and we will leave that
     * to the application to manage it.
     */
    function revokeTracking(address borrower) external virtual override {
        require(
            owner == msg.sender,
            "Only the contract owner can revoke a non-transferrable tracking NFT."
        );

        ctt.burn(_records[borrower].tokenId);

        emit CreditTrackingRevoked(msg.sender, owner);
    }

    function _getURI(address borrower, CreditTrackingRecord storage ctr)
        private
        view
        returns (string memory)
    {
        string
            memory ipfs_loc = "https://ipfs.io/ipfs/Qmf23jkGtxXwi4u4MiMmnKLA98rkGXnF19nWfLD1S7GXJt";

        string memory json = Base64.encode(
            bytes(
                string(
                    abi.encodePacked(
                        "{",
                        '"name": "HumaCTT-',
                        Strings.toHexString(uint160(borrower), 20),
                        '", ',
                        '"description": "Huma Credit Tracking Token.", ',
                        '"image": "',
                        ipfs_loc,
                        '", ',
                        '"attributes": [ ',
                        '{"trait_type": "# of payoffs", "value": "',
                        ctr.numOfPayoffs,
                        '"}, ',
                        '{"trait_type": "# of defaults", "value": "',
                        ctr.numOfDefaults,
                        '"},',
                        '{"trait_type": "# of outstanding loans", "value": "',
                        ctr.numOfOutstandingLoans,
                        '"}',
                        "]}"
                    )
                )
            )
        );

        string memory finalTokenUri = string(
            abi.encodePacked("data:application/json;base64,", json)
        );

        return finalTokenUri;
    }
}
