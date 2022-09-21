//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./HDT/interfaces/IHDT.sol";

contract BasePoolStorage {
    // Divider to convert BPS to percentage
    uint256 public constant BPS_DIVIDER = 10000;
    uint256 internal constant SECONDS_IN_A_DAY = 86400;
    uint256 internal constant SECONDS_IN_180_DAYS = 15552000;

    string internal _poolName;

    // The ERC20 token this pool manages
    IERC20 internal _underlyingToken;

    // The HDT token for this pool
    IHDT internal _poolToken;

    // The amount of underlying token belongs to lenders
    uint256 internal _totalPoolValue;

    // HumaConfig. Removed immutable since Solidity disallow reference it in the constructor,
    // but we need to retrieve the poolDefaultGracePeriod in the constructor.
    address internal _humaConfig;

    // Address for the fee manager contract
    address internal _feeManagerAddress;

    // Tracks the amount of liquidity in poolTokens provided to this pool by an address
    mapping(address => uint256) internal _lastDepositTime;

    // whether the pool is ON or OFF
    PoolStatus internal _status;

    // Evaluation Agents (EA) are the risk underwriting agents that associated with the pool.
    address internal _evaluationAgent;

    PoolConfig internal _poolConfig;

    AccruedIncome internal _accuredIncome;

    uint256 internal _evaluationAgentId;

    struct AccruedIncome {
        uint256 _protocolIncome;
        uint256 _poolOwnerIncome;
        uint256 _eaIncome;
    }

    /**
     * @notice Stores required liquidity rate and rewards rate for Pool Owner and EA
     */
    struct PoolConfig {
        // The first 6 fields are IP-related, optimized for one storage slot.
        // The max liquidity allowed for the pool.
        uint256 _liquidityCap;
        // How long a lender has to wait after the last deposit before they can withdraw
        uint256 _withdrawalLockoutPeriodInSeconds;
        // Percentage of pool income allocated to EA
        uint256 _rewardRateInBpsForEA;
        // Percentage of pool income allocated to Pool Owner
        uint256 _rewardRateInBpsForPoolOwner;
        // Percentage of the _liquidityCap to be contributed by EA
        uint256 _liquidityRateInBpsByEA;
        // Percentage of the _liquidityCap to be contributed by Pool Owner
        uint256 _liquidityRateInBpsByPoolOwner;
        // Below fields are borrowing related. Optimized for one storage slot.
        // the maximum credit line for an address in terms of the amount of poolTokens
        uint256 _maxCreditLine;
        // the grace period at the pool level before a Default can be triggered
        uint256 _poolDefaultGracePeriodInSeconds;
        // pay period for the pool, measured in number of days
        uint256 _payPeriodInDays;
        // Percentage of receivable required for credits in this pool in terms of bais points
        // For over receivableization, use more than 100%, for no receivable, use 0.
        uint256 _receivableRequiredInBps;
        // the default APR for the pool in terms of basis points.
        uint256 _poolAprInBps;
        // the duration of a credit line without an initial drawdown
        uint256 _creditApprovalExpirationInSeconds;
    }

    enum PoolStatus {
        Off,
        On
    }

    // The addresses that are allowed to lend to this pool. Configurable only by the pool owner
    mapping(address => bool) approvedLenders;

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[100] private __gap;
}
