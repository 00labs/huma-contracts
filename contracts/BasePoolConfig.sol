//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IPoolConfig.sol";
import "./HDT/HDT.sol";
import "./HumaConfig.sol";

contract BasePoolConfig is Ownable, IPoolConfig {
    using SafeERC20 for IERC20;

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

    struct AccruedIncome {
        uint256 _protocolIncome;
        uint256 _poolOwnerIncome;
        uint256 _eaIncome;
    }

    address internal _humaConfig;

    // The HDT token for this pool
    HDT internal _poolToken;

    // The ERC20 token this pool manages
    IERC20 internal _underlyingToken;

    string internal _poolName;

    // Evaluation Agents (EA) are the risk underwriting agents that associated with the pool.
    address internal _evaluationAgent;

    uint256 internal _evaluationAgentId;

    PoolConfig internal _poolConfig;

    AccruedIncome internal _accuredIncome;

    // The addresses that are allowed to lend to this pool. Configurable only by the pool owner
    mapping(address => bool) internal _approvedLenders;

    event PoolNameChanged(string newName, address by);
    event EvaluationAgentChanged(address oldEA, address newEA, address by);
    event EvaluationAgentRewardsWithdrawn(uint256 amount, address receiver, address by);
    event AddApprovedLender(address lender, address by);
    event RemoveApprovedLender(address lender, address by);

    constructor(
        string memory poolName,
        address poolToken,
        address humaConfig
    ) {
        _poolName = poolName;
        _poolToken = HDT(poolToken);
        _underlyingToken = IERC20(_poolToken.assetToken());
        _humaConfig = humaConfig;
    }

    /**
     * @notice Change pool name
     */
    function setPoolName(string memory newName) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        _poolName = newName;
        emit PoolNameChanged(newName, msg.sender);
    }

    /**
     * @notice Adds an evaluation agent to the list who can approve loans.
     * @param agent the evaluation agent to be added
     */
    function setEvaluationAgent(uint256 eaId, address agent) external virtual override {
        if (agent == address(0)) revert Errors.zeroAddressProvided();
        onlyOwnerOrHumaMasterAdmin();

        // todo change script to make sure eaNFTContract is deployed, and the eaId is minted.
        // if (IERC721(HumaConfig(_humaConfig).eaNFTContractAddress()).ownerOf(eaId) != agent)
        //     revert notEvaluationAgentOwnerProvided();

        // Transfer the accrued EA income to the old EA's wallet.
        // Decided not to check if there is enough balance in the pool. If there is
        // not enough balance, the transaction will fail. PoolOwner has to find enough
        // liquidity to pay the EA before replacing it.
        address oldEA = _evaluationAgent;
        if (oldEA != address(0)) {
            uint256 rewardsToPayout = _accuredIncome._eaIncome;
            _accuredIncome._eaIncome = 0;
            _underlyingToken.safeTransfer(oldEA, rewardsToPayout);
            emit EvaluationAgentRewardsWithdrawn(rewardsToPayout, oldEA, msg.sender);
        }
        _evaluationAgent = agent;
        _evaluationAgentId = eaId;
        emit EvaluationAgentChanged(oldEA, agent, msg.sender);
    }

    function withdrawEAFee(uint256 amount) external virtual {
        require(msg.sender == _evaluationAgent, "NOT_EA_OWNER");
        require(amount <= _accuredIncome._eaIncome, "WITHDRAWAL_AMOUNT_TOO_HIGH");
        _underlyingToken.safeTransfer(_evaluationAgent, amount);
    }

    function addApprovedLender(address lender) external virtual {
        onlyOwnerOrHumaMasterAdmin();
        _approvedLenders[lender] = true;
        emit AddApprovedLender(lender, msg.sender);
    }

    function removeApprovedLender(address lender) external virtual {
        onlyOwnerOrHumaMasterAdmin();
        _approvedLenders[lender] = false;
        emit RemoveApprovedLender(lender, msg.sender);
    }

    function getEvaluationAgent() external view returns (address) {
        return _evaluationAgent;
    }

    function isOwnerOrEA(address account) internal view returns (bool) {
        return (account == owner() || account == _evaluationAgent);
    }

    function onlyOwnerOrEA(address account) public view {
        if (!isOwnerOrEA(account)) revert Errors.permissionDeniedNotAdmin();
    }

    function onlyApprovedLender(address lender) public view {
        if (!_approvedLenders[lender]) revert Errors.permissionDeniedNotLender();
    }

    function requireMinimumPoolOwnerAndEALiquidity(address account) public view {
        if (isOwnerOrEA(account)) {
            PoolConfig memory config = _poolConfig;
            require(
                _poolToken.convertToAssets(_poolToken.balanceOf(owner())) >=
                    (config._liquidityCap * config._liquidityRateInBpsByPoolOwner) / 10000,
                "POOL_OWNER_NOT_ENOUGH_LIQUIDITY"
            );
            require(
                _poolToken.convertToAssets(_poolToken.balanceOf(_evaluationAgent)) >=
                    (config._liquidityCap * config._liquidityRateInBpsByEA) / 10000,
                "POOL_EA_NOT_ENOUGH_LIQUIDITY"
            );
        }
    }

    function onlyOwnerOrHumaMasterAdmin() internal view {
        require(
            (msg.sender == owner() || msg.sender == HumaConfig(_humaConfig).owner()),
            "PERMISSION_DENIED_NOT_ADMIN"
        );
    }
}
