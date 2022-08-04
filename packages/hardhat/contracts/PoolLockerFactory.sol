//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./PoolLocker.sol";

contract PoolLockerFactory {
    constructor() {}

    function deployNewLocker(address _pool, address _poolTokenAddress)
        external
        returns (address)
    {
        return address(new PoolLocker(_pool, _poolTokenAddress));
    }
}
