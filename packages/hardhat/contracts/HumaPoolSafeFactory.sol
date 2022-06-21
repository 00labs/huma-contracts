pragma solidity >=0.8.0 <0.9.0;
//SPDX-License-Identifier: MIT

import "./HumaPoolSafe.sol";

contract HumaPoolSafeFactory {
  // Array of all Huma Pool Safes created from this factory
  address[] public poolSafes;

  function deployNewPoolSafe(address _pool, address _poolToken)
    external
    returns (address humaPoolSafe)
  {
    humaPoolSafe = address(new HumaPoolSafe(_pool, _poolToken));
    poolSafes.push(humaPoolSafe);
    return humaPoolSafe;
  }
}
