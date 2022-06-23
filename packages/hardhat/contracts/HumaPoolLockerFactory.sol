//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./HumaPoolLocker.sol";

contract HumaPoolLockerFactory {
  // Array of all Huma Pool Lockers created from this factory
  address[] public poolLockers;

  function deployNewPoolLocker(address _pool, address _poolToken)
    external
    returns (address humaPoolLocker)
  {
    humaPoolLocker = address(new HumaPoolLocker(_pool, _poolToken));
    poolLockers.push(humaPoolLocker);
    return humaPoolLocker;
  }
}
