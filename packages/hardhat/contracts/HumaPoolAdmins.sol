//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./HumaPool.sol";
import "./interfaces/IHumaPoolAdmins.sol";

contract HumaPoolAdmins is Ownable, IHumaPoolAdmins {
  // A map of addresses which are allowed to create new Huma Pools.
  mapping(address => bool) public approvedAdmins;

  constructor() {
    // Initialize approvedAdmins with the creator
    approvedAdmins[msg.sender] = true;
  }

  function isApprovedAdmin() external view returns (bool) {
    return approvedAdmins[msg.sender] == true;
  }

  function isMasterAdmin() external view returns (bool) {
    return msg.sender == owner();
  }

  // Add a new admin to the approved admins list.
  function addApprovedPoolAdmin(address _admin) external onlyOwner {
    approvedAdmins[_admin] = true;
    assert(approvedAdmins[_admin] == true);
  }

  // Disable an admin from being able to create new huma pools
  function removeApprovedPoolAdmin(address _admin) external onlyOwner {
    delete approvedAdmins[_admin];
    assert(approvedAdmins[_admin] == false);
  }
}
