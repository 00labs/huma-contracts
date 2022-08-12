//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface IPoolLockerFactory {
    function deployNewLocker(address _pool, address _poolTokenAddress)
        external
        returns (address);
}
