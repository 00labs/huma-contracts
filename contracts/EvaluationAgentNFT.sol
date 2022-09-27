// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

contract EvaluationAgentNFT is ERC721URIStorage, Ownable {
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    event Mint(address recipient, string tokenURI);
    event NFTGenerated(uint256 tokenId);
    event SetURI(uint256 tokenId, string tokenURI);

    constructor() ERC721("EvaluationAgentNFT", "EANFT") {}

    function mintNFT(address recipient, string memory tokenURI) external returns (uint256) {
        emit Mint(recipient, tokenURI);
        _tokenIds.increment();

        uint256 newItemId = _tokenIds.current();
        _mint(recipient, newItemId);
        _setTokenURI(newItemId, tokenURI);

        emit NFTGenerated(newItemId);
        return newItemId;
    }

    function burn(uint256 tokenId) external returns (uint256) {
        _burn(tokenId);
        return tokenId;
    }

    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public virtual override {
        // Internally disable transfer by doing nothing.
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public virtual override {
        // Internally disable transfer by doing nothing.
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) public virtual override {
        // Internally disable transfer by doing nothing.
    }

    function setTokenURI(uint256 tokenId, string memory uri) external onlyOwner {
        emit SetURI(tokenId, uri);
        _setTokenURI(tokenId, uri);
    }
}
