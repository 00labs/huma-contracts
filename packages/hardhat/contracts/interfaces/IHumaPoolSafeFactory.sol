pragma solidity >=0.8.0 <0.9.0;

//SPDX-License-Identifier: MIT

interface IHumaPoolSafeFactory {
  function deployNewPoolSafe(address _pool, address _poolToken)
    external
    returns (address humaPoolSafe);
}
