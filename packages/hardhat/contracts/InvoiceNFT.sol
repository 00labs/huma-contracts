//Contract based on [https://docs.openzeppelin.com/contracts/3.x/erc721](https://docs.openzeppelin.com/contracts/3.x/erc721)
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "hardhat/console.sol";

contract InvoiceNFT is ERC721URIStorage, Ownable {
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    event Mint(address recipient, string tokenURI);
    event TokenGenerated(uint256 tokenId);
    event SetURI(uint256 tokenId, string tokenURI);

    constructor() ERC721("InvoiceNFT", "RNNFT") {}

    function mintNFT(address recipient, string memory tokenURI)
        public
        returns (uint256)
    {
        emit Mint(recipient, tokenURI);
        _tokenIds.increment();

        uint256 newItemId = _tokenIds.current();
        _mint(recipient, newItemId);
        _setTokenURI(newItemId, tokenURI);

        emit TokenGenerated(newItemId);
        console.log("Before exit, newItemId=", newItemId);
        return newItemId;
    }

    function setTokenURI(uint256 tokenId, string memory uri) public {
        emit SetURI(tokenId, uri);
        _setTokenURI(tokenId, uri);
    }
}
