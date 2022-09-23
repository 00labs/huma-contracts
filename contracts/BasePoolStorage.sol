//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./HDT/interfaces/IHDT.sol";
import "./BasePoolConfig.sol";
import "./BaseFeeManager.sol";

contract BasePoolStorage {
    // Divider to convert BPS to percentage
    uint256 public constant BPS_DIVIDER = 10000;
    uint256 internal constant SECONDS_IN_A_DAY = 86400;
    uint256 internal constant SECONDS_IN_180_DAYS = 15552000;

    enum PoolStatus {
        Off,
        On
    }

    // The ERC20 token this pool manages
    IERC20 internal _underlyingToken;

    // The HDT token for this pool
    IHDT internal _poolToken;

    BasePoolConfig internal _poolConfig;

    // HumaConfig. Removed immutable since Solidity disallow reference it in the constructor,
    // but we need to retrieve the poolDefaultGracePeriod in the constructor.
    HumaConfig internal _humaConfig;

    // Address for the fee manager contract
    BaseFeeManager internal _feeManager;

    // The amount of underlying token belongs to lenders
    uint256 internal _totalPoolValue;

    // Tracks the amount of liquidity in poolTokens provided to this pool by an address
    mapping(address => uint256) internal _lastDepositTime;

    // whether the pool is ON or OFF
    PoolStatus internal _status;

    // The addresses that are allowed to lend to this pool. Configurable only by the pool owner
    mapping(address => bool) internal _approvedLenders;

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[100] private __gap;
}
