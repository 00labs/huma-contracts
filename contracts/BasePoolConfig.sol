//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IPoolConfig.sol";
import "./HumaConfig.sol";

contract BasePoolConfig is Ownable, IPoolConfig {
    using SafeERC20 for IERC20;

    struct AccruedIncome {
        uint256 _protocolIncome;
        uint256 _poolOwnerIncome;
        uint256 _eaIncome;
    }

    address internal _humaConfig;

    // The ERC20 token this pool manages
    IERC20 internal _underlyingToken;

    string internal _poolName;

    // Evaluation Agents (EA) are the risk underwriting agents that associated with the pool.
    address internal _evaluationAgent;

    uint256 internal _evaluationAgentId;

    AccruedIncome internal _accuredIncome;

    event PoolNameChanged(string newName, address by);
    event EvaluationAgentChanged(address oldEA, address newEA, address by);
    event EvaluationAgentRewardsWithdrawn(uint256 amount, address receiver, address by);

    constructor(string memory poolName, address underlyingToken) {
        _poolName = poolName;
        _underlyingToken = IERC20(underlyingToken);
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
        onlyOwnerOrHumaMasterAdmin();
        denyZeroAddress(agent);

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

    function getEvaluationAgent() external view returns (address) {
        return _evaluationAgent;
    }

    function onlyOwnerOrHumaMasterAdmin() internal view {
        require(
            (msg.sender == owner() || msg.sender == HumaConfig(_humaConfig).owner()),
            "PERMISSION_DENIED_NOT_ADMIN"
        );
    }

    function denyZeroAddress(address addr) internal pure {
        require(addr != address(0), "ADDRESS_0_PROVIDED");
    }
}
