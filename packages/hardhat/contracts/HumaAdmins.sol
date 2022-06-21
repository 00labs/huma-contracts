pragma solidity >=0.8.0 <0.9.0;
//SPDX-License-Identifier: MIT

import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "./HumaPool.sol";

// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/access/Ownable.sol

contract HumaAdmins is Ownable {
  // A map of addresses which are allowed to create new Huma Pools.
  // Key: address
  // Value: Whether this address is currently allowed to create a pool
  mapping(address => bool) public approvedAdmins;

  constructor() {
    // Initialize approvedAdmins with the creator
    approvedAdmins[msg.sender] = true;
  }

  function isApprovedAdmin() external view {
    require(
      approvedAdmins[msg.sender] == true,
      "HumaAdmins: caller is not approved admin"
    );
  }

  function isMasterAdmin() external view {
    require(msg.sender == owner(), "HumaAdmins: caller is not master admin");
  }

  // Add a new admin to the approved admins list. By default they
  // won't be allowed to create pools right away. The owner must
  // call `enableApprovedPoolAdmin` to give the admin creation privileges
  function addApprovedPoolAdmin(address _admin) external onlyOwner {
    approvedAdmins[_admin] = false;
  }

  // Disable an admin from being able to create new huma pools
  function disableApprovedPoolAdmin(address _admin) external onlyOwner {
    approvedAdmins[_admin] = false;
  }

  // Grant an admin Huma Pool creation privileges
  function enableApprovedPoolAdmin(address _admin) external onlyOwner {
    approvedAdmins[_admin] = true;
  }
}