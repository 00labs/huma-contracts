//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./HDT/interfaces/IHDT.sol";

contract BasePoolStorage {
    uint256 internal constant SECONDS_IN_A_DAY = 86400;
    uint256 internal constant SECONDS_IN_180_DAYS = 15552000;

    string internal _poolName;

    // The ERC20 token this pool manages
    IERC20 internal _underlyingToken;

    // The HDT token for this pool
    IHDT internal _poolToken;

    // The amount of underlying token belongs to lenders
    uint256 internal _totalLiquidity;

    // HumaConfig. Removed immutable since Solidity disallow reference it in the constructor,
    // but we need to retrieve the poolDefaultGracePeriod in the constructor.
    address internal _humaConfig;

    // Address for the fee manager contract
    address internal _feeManagerAddress;

    // Tracks the amount of liquidity in poolTokens provided to this pool by an address
    mapping(address => uint256) internal _lastDepositTime;

    // The max liquidity allowed for the pool.
    uint256 internal _liquidityCap;

    // the min amount that the borrower can borrow in one transaction
    uint256 internal _minBorrowAmount;

    // the maximum credit line for an address in terms of the amount of poolTokens
    uint256 internal _maxCreditLine;

    // the default APR for the pool in terms of basis points.
    uint256 internal _poolAprInBps;

    // Percentage of receivable required for credits in this pool in terms of bais points
    // For over receivableization, use more than 100%, for no receivable, use 0.
    uint256 internal _receivableRequiredInBps;

    // whether the pool is ON or OFF
    PoolStatus internal _status;

    // Evaluation Agents (EA) are the risk underwriting agents that associated with the pool.
    // Expect one pool to have one EA, but the protocol support moultiple.
    mapping(address => bool) internal _evaluationAgents;

    // How long a lender has to wait after the last deposit before they can withdraw
    uint256 internal _withdrawalLockoutPeriodInSeconds;

    // the grace period at the pool level before a Default can be triggered
    uint256 internal _poolDefaultGracePeriodInSeconds;

    enum PoolStatus {
        Off,
        On
    }
}
