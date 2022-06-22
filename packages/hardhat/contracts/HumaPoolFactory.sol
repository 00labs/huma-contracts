//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "./HumaPool.sol";
import "./interfaces/IHumaPoolAdmins.sol";

// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/access/Ownable.sol

contract HumaPoolFactory {
  using SafeERC20 for IERC20;

  // HumaPoolAdmins
  address public immutable humaPoolAdmins;

  // HumaPoolSafeFactory
  address public immutable humaPoolSafeFactory;

  // Array of all Huma Pools created from this factory
  address[] public pools;

  // Minimum liquidity deposit needed to create a Huma Pool
  uint256 public minimumLiquidityNeeded = 100;

  constructor(address _humaPoolAdmins, address _humaPoolSafeFactory) {
    humaPoolAdmins = _humaPoolAdmins;
    humaPoolSafeFactory = _humaPoolSafeFactory;
  }

  function setMinimumLiquidityNeeded(uint256 _minimumLiquidityNeeded) external {
    require(
      IHumaPoolAdmins(humaPoolAdmins).isMasterAdmin(),
      "HumaPoolFactory:NOT_MASTER_ADMIN"
    );
    minimumLiquidityNeeded = _minimumLiquidityNeeded;
  }

  function deployNewPool(address _poolTokenAddress, uint256 _initialLiquidity)
    external
    returns (address humaPool)
  {
    require(
      _initialLiquidity >= minimumLiquidityNeeded,
      "HumaPoolFactory:ERR_LIQUIDITY_REQUIREMENT"
    );
    require(
      IHumaPoolAdmins(humaPoolAdmins).isApprovedAdmin(),
      "HumaPoolFactory:CALLER_NOT_APPROVED"
    );

    humaPool = address(new HumaPool(_poolTokenAddress, humaPoolSafeFactory));
    pools.push(humaPool);

    IERC20 poolToken = IERC20(_poolTokenAddress);
    poolToken.safeTransfer(humaPool, _initialLiquidity);
  }
}
