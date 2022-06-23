//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface IHumaPoolLockerFactory {
  function deployNewPoolLocker(address _pool, address _poolToken)
    external
    returns (address humaPoolLocker);
}
