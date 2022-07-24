//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IHumaCredit.sol";
import "./interfaces/IHumaPoolAdmins.sol";
import "./interfaces/IHumaPoolLockerFactory.sol";

import "./HumaPool.sol";
import "./HumaConfig.sol";

// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/access/Ownable.sol

contract HumaPoolFactory {
    using SafeERC20 for IERC20;

    // HumaPoolAdmins
    address public immutable humaPoolAdmins;

    // HumaLoanFactory
    address public immutable humaLoanFactory;

    // HumaPoolLockerFactory
    address public immutable humaPoolLockerFactory;

    // HumaAPIClient
    // TODO: Do we need to build an upgrade path for this?
    address public humaAPIClient;

    // HumaConfig
    address public immutable humaConfig;

    // Array of all Huma Pools created from this factory
    address[] public pools;

    // Minimum liquidity deposit needed to create a Huma Pool
    uint256 public minimumLiquidityNeeded = 100;

    event PoolDeployed(address _poolAddress);

    constructor(
        address _humaPoolAdmins,
        address _humaConfig,
        address _humaLoanFactory,
        address _humaPoolLockerFactory,
        address _humaAPIClient
    ) {
        humaPoolAdmins = _humaPoolAdmins;
        humaConfig = _humaConfig;
        humaLoanFactory = _humaLoanFactory;
        humaPoolLockerFactory = _humaPoolLockerFactory;
        humaAPIClient = _humaAPIClient;
    }

    function setMinimumLiquidityNeeded(uint256 _minimumLiquidityNeeded)
        external
    {
        require(
            IHumaPoolAdmins(humaPoolAdmins).isMasterAdmin(msg.sender),
            "HumaPoolFactory:NOT_MASTER_ADMIN"
        );
        minimumLiquidityNeeded = _minimumLiquidityNeeded;
    }

    function deployNewPool(
        address _poolTokenAddress,
        uint256 _initialLiquidity,
        CreditType _type
    ) external returns (address payable humaPool) {
        require(
            _initialLiquidity >= minimumLiquidityNeeded,
            "HumaPoolFactory:ERR_LIQUIDITY_REQUIREMENT"
        );
        require(
            IHumaPoolAdmins(humaPoolAdmins).isApprovedAdmin(msg.sender),
            "HumaPoolFactory:CALLER_NOT_APPROVED"
        );

        humaPool = payable(
            new HumaPool(
                _poolTokenAddress,
                humaPoolAdmins,
                humaConfig,
                humaLoanFactory,
                humaAPIClient,
                _type
            )
        );

        HumaPool(humaPool).setPoolLocker(
            IHumaPoolLockerFactory(humaPoolLockerFactory).deployNewLocker(
                humaPool,
                _poolTokenAddress
            )
        );

        HumaPool(humaPool).transferOwnership(msg.sender);

        pools.push(humaPool);

        IERC20 poolToken = IERC20(_poolTokenAddress);
        // TODO, check that this contract has allowance from msg.sender for _initialLiquidity
        poolToken.safeTransferFrom(msg.sender, humaPool, _initialLiquidity);

        emit PoolDeployed(humaPool);

        return humaPool;
    }
}
