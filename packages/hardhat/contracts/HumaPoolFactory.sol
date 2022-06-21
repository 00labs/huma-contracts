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
  uint256 public minimumLiquidityNeededUSD = 100000;

  event HumaPoolCreated(address indexed owner, address humaPool);

  constructor() {
    // what should we do on deploy?
  }

  function setMinimumLiquidityNeededUSD(uint256 _minimumLiquidityNeededUSD)
    external
  {
    humaAdmins.isMasterAdmin();
    minimumLiquidityNeededUSD = _minimumLiquidityNeededUSD;
  }

  function deployNewPool() external payable returns (address humaPool) {
    require(msg.value >= minimumLiquidityNeededUSD);
    humaAdmins.isApprovedAdmin();

    humaPool = address(new HumaPool());
    pools.push(humaPool);

    // TODO fund huma pool. Should we use ERC20 tokens? WETH? USDC?

    emit HumaPoolCreated(msg.sender, humaPool);
  }
}
