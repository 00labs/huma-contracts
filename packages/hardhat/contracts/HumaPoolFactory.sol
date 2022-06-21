pragma solidity >=0.8.0 <0.9.0;
//SPDX-License-Identifier: MIT

import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "./HumaPool.sol";
import "./HumaAdmins.sol";

// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/access/Ownable.sol

contract HumaPoolFactory {
  HumaAdmins humaAdmins;

  // Array of all Huma Pools created from this factory
  address[] public pools;

  // Minimum liquidity deposit needed to create a Huma Pool
  uint256 public minimumLiquidityNeeded = 100000;

  event HumaPoolCreated(address indexed owner, address humaPool);

  function setMinimumLiquidityNeeded(uint256 _minimumLiquidityNeeded) external {
    humaAdmins.isMasterAdmin();
    minimumLiquidityNeeded = _minimumLiquidityNeeded;
  }

  function deployNewPool(uint256 _initialLiquidity)
    external
    returns (address humaPool)
  {
    require(_initialLiquidity >= minimumLiquidityNeeded);
    humaAdmins.isApprovedAdmin();

    humaPool = address(new HumaPool());
    pools.push(humaPool);

    // TODO fund huma pool. Should we use ERC20 tokens? WETH? USDC?

    emit HumaPoolCreated(msg.sender, humaPool);
  }
}
