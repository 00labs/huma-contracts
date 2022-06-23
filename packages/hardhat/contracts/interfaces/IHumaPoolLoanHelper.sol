//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface IHumaPoolLoanHelper {
  function evaluateBorrowRequest(address _to, uint256 _amount)
    external
    returns (bool);

  function postBorrowRequest(address _to, uint256 _amount)
    external
    returns (bool);
}
