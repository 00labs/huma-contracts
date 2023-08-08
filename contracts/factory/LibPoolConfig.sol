// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "../BasePoolConfig.sol";
// import "hardhat/console.sol";

library LibPoolConfig {
    function addPoolConfig() public returns (address) {
        BasePoolConfig poolConfig = new BasePoolConfig();
        return address(poolConfig);
    }

    function initializePoolBasicConfig(
        address _poolConfigAddress,
        string memory _poolName,
        address _poolAddress,
        address _hdtAddress,
        address _humaConfigAddress,
        address _feeManagerAddress,
        address _poolOwnerTreasury,
        uint256 _poolPayPeriod,
        uint256 withdrawalLockoutPeriod
    ) public {
        BasePoolConfig poolConfig = BasePoolConfig(_poolConfigAddress);
        poolConfig.initialize(_poolName, _hdtAddress, _humaConfigAddress, _feeManagerAddress);
        poolConfig.setPool(_poolAddress);
        poolConfig.setPoolToken(_hdtAddress);
        poolConfig.setPoolOwnerTreasury(_poolOwnerTreasury);
        poolConfig.setPoolPayPeriod(_poolPayPeriod);
        poolConfig.setWithdrawalLockoutPeriod(withdrawalLockoutPeriod);
    }

    function initializePoolLiquidityConfig(
        address _poolConfigAddress,
        uint256 liquidityCap,
        uint256 poolOwnerRewards,
        uint256 poolOwnerLiquidity,
        uint256 EARewards,
        uint256 EALiquidity,
        uint256 maxCreditLine,
        uint256 _apr,
        uint256 receivableRequiredInBps
    ) public {
        BasePoolConfig poolConfig = BasePoolConfig(_poolConfigAddress);

        poolConfig.setPoolLiquidityCap(liquidityCap);
        poolConfig.setPoolOwnerRewardsAndLiquidity(poolOwnerRewards, poolOwnerLiquidity);
        poolConfig.setEARewardsAndLiquidity(EARewards, EALiquidity);
        poolConfig.setMaxCreditLine(maxCreditLine);
        poolConfig.setAPR(_apr);
        poolConfig.setReceivableRequiredInBps(receivableRequiredInBps);
    }

    function transferOwnership(address _poolConfigAddress, address newOwner) public {
        BasePoolConfig poolConfig = BasePoolConfig(_poolConfigAddress);
        poolConfig.transferOwnership(newOwner);
    }

    function owner(address _poolConfigAddress) public view returns (address) {
        BasePoolConfig poolConfig = BasePoolConfig(_poolConfigAddress);
        return poolConfig.owner();
    }
}
