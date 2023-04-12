// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "hardhat/console.sol";

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "../BaseCreditPool.sol";

contract BaseCreditPoolReceivable is ERC721, ERC721Enumerable, ERC721URIStorage, AccessControl {
    using Counters for Counters.Counter;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    Counters.Counter private _tokenIdCounter;

    mapping(uint256 => ReceivableInfo) public receivableInfoMapping;

    struct ReceivableInfo {
        BaseCreditPool baseCreditPool;
        address receivableAsset;
        uint96 receivableAmount;
        uint96 balance;
        uint64 maturityDate;
    }

    constructor() ERC721("BaseCreditPoolReceivable", "pREC") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    function safeMint(
        address recipient,
        address baseCreditPool,
        address receivableAsset,
        uint96 receivableAmount,
        uint64 maturityDate,
        string memory uri
    ) public onlyRole(MINTER_ROLE) {
        uint256 tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();
        _safeMint(recipient, tokenId);

        ReceivableInfo memory receivableInfo = ReceivableInfo(
            BaseCreditPool(baseCreditPool),
            receivableAsset,
            receivableAmount,
            0, // Balance
            maturityDate
        );
        receivableInfoMapping[tokenId] = receivableInfo;

        _setTokenURI(tokenId, uri);
    }

    function makePayment(
        uint256 tokenId,
        address receivableAsset,
        uint96 receivableAmount
    ) public {
        ReceivableInfo storage receivableInfo = receivableInfoMapping[tokenId];
        require(receivableInfo.receivableAsset == receivableAsset, "Invalid receivable asset");
        require(
            receivableInfo.balance < receivableInfo.receivableAmount,
            "Receivable already paid"
        );

        receivableInfo.balance += receivableAmount;

        (uint256 amountPaid, ) = receivableInfo.baseCreditPool.makePayment(
            ownerOf(tokenId),
            uint256(receivableAmount)
        );

        require(amountPaid > 0, "makePayment failed");
    }

    // The following functions are overrides required by Solidity.
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId
    ) internal override(ERC721, ERC721Enumerable) {
        super._beforeTokenTransfer(from, to, tokenId);
    }

    function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
