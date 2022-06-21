pragma solidity >=0.8.0 <0.9.0;

//SPDX-License-Identifier: MIT

interface IHumaAdmins {
  function isApprovedAdmin() external view;

  function isMasterAdmin() external view;

  // Add a new admin to the approved admins list. By default they
  // won't be allowed to create pools right away. The owner must
  // call `enableApprovedPoolAdmin` to give the admin creation privileges
  function addApprovedPoolAdmin(address _admin) external;

  // Disable an admin from being able to create new huma pools
  function disableApprovedPoolAdmin(address _admin) external;

  // Grant an admin Huma Pool creation privileges
  function enableApprovedPoolAdmin(address _admin) external;
}
