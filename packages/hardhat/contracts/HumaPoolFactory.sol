pragma solidity >=0.8.0 <0.9.0;
//SPDX-License-Identifier: MIT

import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "./HumaPool.sol";

// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/access/Ownable.sol

contract HumaPoolFactory is Ownable {
  // A map of addresses which are allowed to create new Huma Pools.
  // Key: address
  // Value: Whether this address is currently allowed to create a pool
  mapping(address => bool) public approvedAdmins;

  // Array of all Huma Pools created from this factory
  address[] public pools;

  // Minimum liquidity deposit needed to create a Huma Pool
  uint256 public minimumLiquidityNeededUSD = 100000;

  event HumaPoolCreated(address indexed owner, address humaPool);

  constructor() {
    // what should we do on deploy?
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

  function setMinimumLiquidityNeededUSD(uint256 _minimumLiquidityNeededUSD)
    external
    onlyOwner
  {
    minimumLiquidityNeededUSD = _minimumLiquidityNeededUSD;
  }

  function deployNewPool() external payable returns (address humaPool) {
    require(msg.value >= minimumLiquidityNeededUSD);
    require(approvedAdmins[msg.sender] == true);
    humaPool = address(new HumaPool());
    pools.push(humaPool);

    // TODO fund huma pool. Should we use ERC20 tokens? WETH? USDC?

    emit HumaPoolCreated(msg.sender, humaPool);
  }
}
