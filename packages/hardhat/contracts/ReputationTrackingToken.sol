//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "hardhat/console.sol";

/**
 * @notice Reputation Tracking Token is a non-transferrable token issued to the
 * borrower to capture their borrowing and payback record and help them to build
 * their reputation in the decentralized borrowing network.
 * It is a SBT. The user cannot transfer away the token. If they do not want the
 * token, they can only request the contract to revoke it if there is no outstanding balance.
 *
 * The RTT is impelmented as an NFT that can be viewed on Opensea.
 * In the metadata, it is currently tracking # of successful payoffs, # of defaults,
 * # of outstanding loans. The list of attributes to be tracked can grow over time.
 *
 */
contract ReputationTrackingToken is ERC721URIStorage, Ownable {
    constructor(string memory _name, string memory _symbol)
        ERC721(_name, _symbol)
    {}

    /**
     * @notice Overrides the default behavior. The token is NOT transferred away
     * from the "from" address to achieve "non-transferrable" effect.
     */
    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public override {
        /// @dev Intentionally do nothing to make the token non-transferrable
    }

    /**
     * @notice Overrides the default behavior. The token is NOT transferred away
     * from the "from" address to achieve "non-transferrable" effect.
     */
    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) public override {
        /// @dev Intentionally do nothing to make the token non-transferrable
    }

    /**
     * @notice Overrides the default behavior. The token is NOT transferred away
     * from the "from" address to achieve "non-transferrable" effect.
     */
    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public override {
        /// @dev Intentionally do nothing to make the token non-transferrable
    }

    /**
     * @notice Overrides the default behavior. The token is NOT transferred away
     * from the "from" address to achieve "non-transferrable" effect.
     */
    function _safeTransfer(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) internal override {
        /// @dev Intentionally do nothing w/ the request to make the token non-transferrable
    }

    /**
     * @notice Overrides the default behavior. The token is NOT transferred away
     * from the "from" address to achieve "non-transferrable" effect.
     */
    function _transfer(
        address from,
        address to,
        uint256 tokenId
    ) internal override {
        /// @dev Intentionally do nothing w/ the request to make the token non-transferrable
    }

    /**
     * @dev Safely mints `tokenId` and transfers it to `to`.
     *
     * Requirements:
     *
     * - `tokenId` must not exist.
     * - If `to` refers to a smart contract, it must implement {IERC721Receiver-onERC721Received}, which is called upon a safe transfer.
     *
     * Emits a {Transfer} event.
     */
    function safeMint(address to, uint256 tokenId) external onlyOwner {
        _safeMint(to, tokenId, "");
    }

    /**
     * @dev Sets `_tokenURI` as the tokenURI of `tokenId`.
     *
     * Requirements:
     *
     * - `tokenId` must exist.
     */
    function setTokenURI(uint256 tokenId, string memory _tokenURI) external {
        _setTokenURI(tokenId, _tokenURI);
    }

    /**
     * @dev See {ERC721-_burn}. This override additionally checks to see if a
     * token-specific URI was set for the token, and if so, it deletes the token URI from
     * the storage mapping.
     */
    function burn(uint256 tokenId) external {
        _burn(tokenId);
    }
}
