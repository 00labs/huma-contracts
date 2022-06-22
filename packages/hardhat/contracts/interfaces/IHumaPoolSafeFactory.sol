//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface IHumaPoolSafeFactory {
  function deployNewPoolSafe(address _pool, address _poolToken)
    external
    returns (address humaPoolSafe);
}
