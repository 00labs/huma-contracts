//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

// This interface defines functions that can be used to extend
// a HumaPool's functionality. PoolOwners may deploy this contract
// and set it in their HumaPool using 'setHumaPoolLoanHelper'
// (note that all contracts must be reviewed and approved by Huma
// before a HumaPool may use it and calling setHumaPoolLoanHelper
// will automatically disable a HumaPool until review is complete).
interface IHumaPoolLoanHelper {
  // Called in the HumaPool 'borrow' function after all initial checks
  // are completed (maximum borrow amount not exceeded, no existing loans,
  // etc.). Can be used to do additional evaluation on whether to approve
  // an address' borrow request
  // Returning true will approve a request, while returning false will reject
  function evaluateBorrowRequest(address _to, uint256 _amount)
    external
    returns (bool);

  // Called in the HumaPool 'borrow' function after poolTokens have been
  // transferred to a wallet (but in the same function so failures in this
  // function will invalidate the whole borrow request).
  function postBorrowRequest(address _to, uint256 _amount)
    external
    returns (bool);
}
