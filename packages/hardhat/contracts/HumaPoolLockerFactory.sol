//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./interfaces/IHumaPoolLockerFactory.sol";
import "./HumaPoolLocker.sol";

contract HumaPoolLockerFactory is IHumaPoolLockerFactory {
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
