//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IHumaCredit.sol";
import "./interfaces/IHumaPoolLockerFactory.sol";

import "./HumaPool.sol";
import "./HumaConfig.sol";

contract HumaPoolFactory {
    using SafeERC20 for IERC20;

    // HumaLoanFactory
    address internal immutable humaLoanFactory;

    // HumaPoolLockerFactory
    address internal immutable humaPoolLockerFactory;

    address internal reputationTrackerFactory;

    // HumaConfig
    address internal immutable humaConfig;

    // Array of all Huma Pools created from this factory
    address[] public pools;

    event PoolDeployed(address _poolAddress);

    constructor(
        address _humaConfig,
        address _humaLoanFactory,
        address _humaPoolLockerFactory,
        address _reputationTrackerFactory
    ) {
        humaConfig = _humaConfig;
        humaLoanFactory = _humaLoanFactory;
        humaPoolLockerFactory = _humaPoolLockerFactory;
        reputationTrackerFactory = _reputationTrackerFactory;
    }

    function deployNewPool(address _poolTokenAddress, CreditType _type)
        external
        returns (address payable humaPool)
    {
        require(
            HumaConfig(humaConfig).isPoolAdmin(msg.sender),
            "HumaPoolFactory:CALLER_NOT_APPROVED"
        );
        humaPool = payable(
            new HumaPool(
                _poolTokenAddress,
                humaConfig,
                humaLoanFactory,
                reputationTrackerFactory,
                _type
            )
        );

        pools.push(humaPool);

        HumaPool pool = HumaPool(humaPool);

        pool.setPoolLocker(
            IHumaPoolLockerFactory(humaPoolLockerFactory).deployNewLocker(
                humaPool,
                _poolTokenAddress
            )
        );

        pool.transferOwnership(msg.sender);

        emit PoolDeployed(humaPool);

        return humaPool;
    }
}
