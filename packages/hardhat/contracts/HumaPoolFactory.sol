pragma solidity >=0.8.0 <0.9.0;
//SPDX-License-Identifier: MIT

import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "./HumaPool.sol";
import "./interfaces/IHumaAdmins.sol";

// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/access/Ownable.sol

contract HumaPoolFactory {
  using SafeERC20 for IERC20;

  // HumaAdmins
  address public immutable humaAdmins;

  // HumaPoolSafeFactory
  address public immutable humaPoolSafeFactory;

  // Array of all Huma Pools created from this factory
  address[] public pools;

  // Minimum liquidity deposit needed to create a Huma Pool
  uint256 public minimumLiquidityNeeded = 100;

  constructor(address _humaAdmins, address _humaPoolSafeFactory) {
    humaAdmins = _humaAdmins;
    humaPoolSafeFactory = _humaPoolSafeFactory;
  }

  function setMinimumLiquidityNeeded(uint256 _minimumLiquidityNeeded) external {
    IHumaAdmins(humaAdmins).isMasterAdmin();
    minimumLiquidityNeeded = _minimumLiquidityNeeded;
  }

  function deployNewPool(address _poolTokenAddress, uint256 _initialLiquidity)
    external
    returns (address humaPool)
  {
    require(_initialLiquidity >= minimumLiquidityNeeded);
    IHumaAdmins(humaAdmins).isApprovedAdmin();

    humaPool = address(new HumaPool(_poolTokenAddress, humaPoolSafeFactory));
    pools.push(humaPool);

    IERC20 poolToken = IERC20(_poolTokenAddress);
    poolToken.safeTransfer(humaPool, _initialLiquidity);
  }
}
