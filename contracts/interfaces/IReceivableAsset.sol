// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IReceivableAsset is IERC721 {
    function getReceivableData(uint256 tokenId)
        external
        view
        returns (
            uint256 receivableParam,
            uint256 receivableAmount,
            address token
        );

    function payOwner(uint256 tokenId, uint256 amount) external;

    function burn(uint256 tokenId) external;
}
