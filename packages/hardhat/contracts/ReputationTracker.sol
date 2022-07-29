//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/IReputationTracker.sol";
import "./ReputationTrackingToken.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "./libraries/Base64.sol";
import "hardhat/console.sol";

/**
 * @notice Reputation Tracking is a reputation reporting service that uses ReputationTrackingToken,
 * a non-transferrable NFT to report and track wallet's borrowings, payoffs, and defaults.
 * @dev Each pool owns a ReputationTracker contract, which owns a ReputationTrackingToken contract
 * todo the implementation uses a struct to track status and then update URI, need to explore
 * if there are more efficient ways.
 */
contract ReputationTracker is IReputationTracker, Ownable {
    using Counters for Counters.Counter;
    Counters.Counter private _tokenCounter;

    // todo this needs to be a param passed from the owner
    string constant IMAGE_LOC =
        "https://ipfs.io/ipfs/Qmf23jkGtxXwi4u4MiMmnKLA98rkGXnF19nWfLD1S7GXJt";

    // Structure for the key items to be tracked
    struct ReputationTrackingRecord {
        uint256 tokenId;
        bool exists;
        uint16 numOfPayoffs;
        uint16 numOfDefaults;
        uint16 numOfOutstandingLoans;
    }

    // Mapping from the borrower's address to its reputation tracking record
    mapping(address => ReputationTrackingRecord) private _records;

    // Reputation-tracking-token contract for this tracking service
    ReputationTrackingToken tokenContract;

    constructor(string memory _name, string memory _symbol) {
        tokenContract = new ReputationTrackingToken(_name, _symbol);
    }

    /**
     * @notice Gets the reputation tracking token id for the given address.
     * If there is no tracking token yet, mint one to the address and return the token id.
     */
    function getReputationTrackingTokenId(address borrower)
        public
        onlyOwner
        returns (uint256 tokenId)
    {
        if (_records[borrower].exists) tokenId = _records[borrower].tokenId;

        if (tokenId == 0) {
            _tokenCounter.increment();
            tokenId = _tokenCounter.current();
            _records[borrower] = ReputationTrackingRecord(
                tokenId,
                true,
                0,
                0,
                0
            );
            tokenContract.safeMint(borrower, tokenId);
        }
    }

    /**
     * @notice Tracks a reputation reporting
     * @param borrower the wallet address of the borrower
     * @param trackingType indicates whether it is a Borrowing, Payoff, or Default.
     */
    function report(
        address borrower,
        IReputationTracker.TrackingType trackingType
    ) external virtual override {
        require(
            trackingType >= IReputationTracker.TrackingType.Borrowing &&
                trackingType <= IReputationTracker.TrackingType.Default,
            "ReputationTracker:INCORRECT_TRACKING_MODE"
        );

        if (
            trackingType == IReputationTracker.TrackingType.Payoff ||
            trackingType == IReputationTracker.TrackingType.Default
        ) {
            require(
                _records[borrower].numOfOutstandingLoans > 0,
                "ReputationTracker:NO_OUTSTANDING_BORROWING"
            );
        }

        uint256 tokenId = getReputationTrackingTokenId(borrower);

        if (trackingType == IReputationTracker.TrackingType.Borrowing) {
            _records[borrower].numOfOutstandingLoans += 1;
        } else if (trackingType == IReputationTracker.TrackingType.Payoff) {
            _records[borrower].numOfPayoffs += 1;
            _records[borrower].numOfOutstandingLoans -= 1;
        } else if (trackingType == IReputationTracker.TrackingType.Default) {
            _records[borrower].numOfDefaults += 1;
            _records[borrower].numOfOutstandingLoans -= 1;
        }

        string memory newTokenUri = _getURI(borrower, _records[borrower]);

        tokenContract.setTokenURI(tokenId, newTokenUri);
        emit ReputationReported(address(this), borrower, trackingType);
    }

    /**
     * @notice Allows the contract to remove the tracking of a borrower
     * at the request of the borrower.
     */
    function revokeTracking(address borrower)
        external
        virtual
        override
        onlyOwner
    {
        uint256 tokenId = getReputationTrackingTokenId(borrower);

        tokenContract.burn(tokenId);

        emit ReputationTrackingRevoked(address(this), borrower);
    }

    function _getURI(address borrower, ReputationTrackingRecord storage ctr)
        private
        view
        returns (string memory)
    {
        string memory ipfs_loc = IMAGE_LOC;

        string memory json = Base64.encode(
            bytes(
                string(
                    abi.encodePacked(
                        "{",
                        '"name": "HumaCTT-',
                        Strings.toHexString(uint160(borrower), 20),
                        '", ',
                        '"description": "Reputation Tracking Token.", ',
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
