//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import "hardhat/console.sol";

contract PoolLocker is IERC721Receiver {
    using SafeERC20 for IERC20;

    address internal immutable pool;
    IERC20 internal immutable poolToken;

    constructor(address _pool, address _poolToken) {
        poolToken = IERC20(_poolToken);
        pool = _pool;
    }

    modifier isPool() {
        require(msg.sender == pool, "HumaPoolLocker:NOT_POOL");
        _;
    }

    function transfer(address to, uint256 amount) external isPool {
        require(to != address(0), "HumaPoolLocker:NULL_ADDR");
        poolToken.safeTransfer(to, amount);
    }

    function onERC721Received(
        address, /*operator*/
        address, /*from*/
        uint256, /*tokenId*/
        bytes calldata /*data*/
    ) external virtual override returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
