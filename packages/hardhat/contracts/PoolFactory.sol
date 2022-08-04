//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IPoolLockerFactory.sol";

import "./HumaConfig.sol";
import "./BasePool.sol";
import "./HumaInvoiceFactoring.sol";

contract PoolFactory {
    using SafeERC20 for IERC20;

    // HumaPoolLockerFactory
    address internal immutable poolLockerFactory;

    address internal reputationTrackerFactory;

    // HumaConfig
    address internal immutable humaConfig;

    // Array of all Huma Pools created from this factory
    address[] public pools;

    event PoolDeployed(address _poolAddress);

    constructor(
        address _humaConfig,
        address _poolLockerFactory,
        address _reputationTrackerFactory
    ) {
        humaConfig = _humaConfig;
        poolLockerFactory = _poolLockerFactory;
        reputationTrackerFactory = _reputationTrackerFactory;
    }

    function deployNewPool(address _poolTokenAddress, CreditType _type)
        external
        returns (address payable poolAddress)
    {
        require(
            HumaConfig(humaConfig).isPoolAdmin(msg.sender),
            "PoolFactory:CALLER_NOT_APPROVED"
        );
        if (_type == CreditType.InvoiceFactoring) {
            poolAddress = payable(
                new HumaInvoiceFactoring(
                    _poolTokenAddress,
                    humaConfig,
                    reputationTrackerFactory
                )
            );
        } else if (_type == CreditType.Loan) {
            poolAddress = payable(
                new BaseCredit(
                    _poolTokenAddress,
                    humaConfig,
                    reputationTrackerFactory
                )
            );
        }

        pools.push(poolAddress);

        IPool poolContract = IPool(poolAddress);

        poolContract.setPoolLocker(
            IPoolLockerFactory(poolLockerFactory).deployNewLocker(
                poolAddress,
                _poolTokenAddress
            )
        );

        //poolContract.transferOwnership(msg.sender);

        emit PoolDeployed(poolAddress);

        return poolAddress;
    }
}
