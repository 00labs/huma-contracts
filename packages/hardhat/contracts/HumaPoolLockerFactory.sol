//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./HumaPoolLocker.sol";

contract HumaPoolLockerFactory {
    constructor() {}

    function deployNewLocker(address _pool, address _poolTokenAddress)
        external
        returns (address)
    {
        return address(new HumaPoolLocker(_pool, _poolTokenAddress));
    }
}
