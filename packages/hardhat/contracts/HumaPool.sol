pragma solidity >=0.8.0 <0.9.0;
//SPDX-License-Identifier: MIT

import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable.sol";

// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/access/Ownable.sol

contract HumaPool is Ownable {
  enum PoolStatus {
    on,
    off
  }

  PoolStatus public status = PoolStatus.off;

  constructor() payable {}

  // Allow borrow applications and loans to be processed by this pool.
  function enablePool() external onlyOwner {
    status = PoolStatus.on;
  }

  // Reject all future borrow applications and loans. Note that existing
  // loans will still be processed as expected.
  function disablePool() external onlyOwner {
    status = PoolStatus.off;
  }

  // Function to receive Ether. msg.data must be empty
  receive() external payable {}

  // Fallback function is called when msg.data is not empty
  fallback() external payable {}

  function getBalance() public view returns (uint256) {
    return address(this).balance;
  }
}
