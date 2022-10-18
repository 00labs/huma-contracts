// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "../libraries/BaseStructs.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPool {
    /// Stops the pool. This stops all money moving in or out of the pool.
    function disablePool() external;

    /// Enables the pool to operate
    function enablePool() external;

    /// Sets the poolConfig for the pool
    function setPoolConfig(address poolConfigAddr) external;

    /// Returns if the pool is on or not
    function isPoolOn() external view returns (bool status);

    /// Returns the last time when the account has contributed to the pool as an LP
    function lastDepositTime(address account) external view returns (uint256);

    /// Returns the pool config associated the pool
    function poolConfig() external view returns (address);

    /// Gets the total pool value right now
    function totalPoolValue() external view returns (uint256);
}
