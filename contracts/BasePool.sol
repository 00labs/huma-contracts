//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import "./BasePoolStorage.sol";

import "./interfaces/ILiquidityProvider.sol";
import "./interfaces/IPool.sol";

import "./Errors.sol";
import "./HDT/HDT.sol";
import "./HumaConfig.sol";
import "./EvaluationAgentNFT.sol";

import "hardhat/console.sol";

abstract contract BasePool is Initializable, BasePoolStorage, ILiquidityProvider, IPool {
    using SafeERC20 for IERC20;

    error notEvaluationAgentOwnerProvided();

    event LiquidityDeposited(address indexed account, uint256 assetAmount, uint256 shareAmount);
    event LiquidityWithdrawn(address indexed account, uint256 assetAmount, uint256 shareAmount);
    event PoolInitialized(address _poolAddress);
    event PoolCoreDataChanged(
        address indexed sender,
        address underlyingToken,
        address poolToken,
        address humaConfig,
        address feeManager
    );
    event PoolConfigChanged(address indexed sender, address newPoolConfig);

    event PoolDisabled(address by);
    event PoolEnabled(address by);

    event AddApprovedLender(address lender, address by);
    event RemoveApprovedLender(address lender, address by);

    /**
     * @dev This event emits when new funds are distributed
     * @param by the address of the sender who distributed funds
     * @param fundsDistributed the amount of funds received for distribution
     */
    event IncomeDistributed(address indexed by, uint256 fundsDistributed);

    /**
     * @dev This event emits when new losses are distributed
     * @param by the address of the sender who distributed the loss
     * @param lossesDistributed the amount of losses received for distribution
     */
    event LossesDistributed(address indexed by, uint256 lossesDistributed);

    constructor() {
        _disableInitializers();
    }

    function initialize(address poolConfigAddr) external initializer {
        _poolConfig = BasePoolConfig(poolConfigAddr);
        _updateCoreData();
        safeApproveMax(poolConfigAddr, false);

        _status = PoolStatus.Off;

        emit PoolInitialized(address(this));
    }

    function updateCoreData() external {
        onlyOwnerOrHumaMasterAdmin();
        _updateCoreData();
    }

    function setPoolConfig(address poolConfigAddr) external {
        onlyOwnerOrHumaMasterAdmin();
        address oldConfig = address(_poolConfig);
        if (poolConfigAddr == oldConfig) revert Errors.sameValue();

        BasePoolConfig newPoolConfig = BasePoolConfig(poolConfigAddr);
        newPoolConfig.onlyOwnerOrHumaMasterAdmin(msg.sender);

        safeApproveMax(oldConfig, true);
        _poolConfig = newPoolConfig;
        safeApproveMax(poolConfigAddr, false);

        emit PoolConfigChanged(msg.sender, poolConfigAddr);
    }

    function _updateCoreData() private {
        (
            address underlyingTokenAddr,
            address poolTokenAddr,
            address humaConfigAddr,
            address feeManagerAddr
        ) = _poolConfig.getCoreData();
        // note Can underlyingToken be changed?
        _underlyingToken = IERC20(underlyingTokenAddr);
        _poolToken = IHDT(poolTokenAddr);
        _humaConfig = HumaConfig(humaConfigAddr);
        _feeManager = BaseFeeManager(feeManagerAddr);

        emit PoolCoreDataChanged(
            msg.sender,
            underlyingTokenAddr,
            poolTokenAddr,
            humaConfigAddr,
            feeManagerAddr
        );
    }

    function safeApproveMax(address account, bool cancel) internal {
        uint256 amount = 0;
        if (!cancel) {
            amount = type(uint256).max;
        }

        if (amount == 0 || _underlyingToken.allowance(address(this), account) == 0) {
            _underlyingToken.safeApprove(account, amount);
        }
    }

    //********************************************/
    //               LP Functions                //
    //********************************************/

    /**
     * @notice LP deposits to the pool to earn interest, and share losses
     * @param amount the number of `poolToken` to be deposited
     */
    function deposit(uint256 amount) external virtual override {
        protocolAndPoolOn();
        // todo (by RL) Need to add maximal pool size support and check if it has reached the size
        return _deposit(msg.sender, amount);
    }

    /**
     * @notice Allows the pool owner to make initial deposit before the pool goes live
     * @param amount the number of `poolToken` to be deposited
     */
    function makeInitialDeposit(uint256 amount) external virtual override {
        _poolConfig.onlyOwnerOrEA(msg.sender);
        return _deposit(msg.sender, amount);
    }

    function _deposit(address lender, uint256 amount) internal {
        if (amount == 0) revert Errors.zeroAmountProvided();
        onlyApprovedLender(lender);

        _underlyingToken.safeTransferFrom(lender, address(this), amount);
        uint256 shares = _poolToken.mintAmount(lender, amount);
        _lastDepositTime[lender] = block.timestamp;
        _totalPoolValue += amount;

        emit LiquidityDeposited(lender, amount, shares);
    }

    /**
     * @notice Withdraw capital from the pool in the unit of `poolTokens`
     * @dev Withdrawals are not allowed when 1) the pool withdraw is paused or
     *      2) the LP has not reached lockout period since their last depisit
     *      3) the requested amount is higher than the LP's remaining principal
     * @dev the `amount` is total amount to withdraw. It will deivided by pointsPerShare to get
     *      the number of HDTs to reduct from msg.sender's account.
     * @dev Error checking sequence: 1) is the pool on 2) is the amount right 3)
     */
    function withdraw(uint256 amount) public virtual override {
        protocolAndPoolOn();
        if (amount == 0) revert Errors.zeroAmountProvided();
        if (
            block.timestamp <
            _lastDepositTime[msg.sender] + _poolConfig.withdrawalLockoutPeriodInSeconds()
        ) revert Errors.withdrawTooSoon();

        uint256 withdrawableAmount = _poolToken.withdrawableFundsOf(msg.sender);
        if (amount > withdrawableAmount) revert Errors.withdrawnAmountHigherThanBalance();

        uint256 shares = _poolToken.burnAmount(msg.sender, amount);
        _totalPoolValue -= amount;
        _underlyingToken.safeTransfer(msg.sender, amount);

        if (msg.sender == _poolConfig.evaluationAgent())
            _poolConfig.checkLiquidityRequirementForEA(withdrawableAmount - amount);
        else if (msg.sender == _poolConfig.owner())
            _poolConfig.checkLiquidityRequirementForPoolOwner(withdrawableAmount - amount);

        emit LiquidityWithdrawn(msg.sender, amount, shares);
    }

    /**
     * @notice Withdraw all balance from the pool.
     */
    function withdrawAll() external virtual override {
        withdraw(_poolToken.withdrawableFundsOf(msg.sender));
    }

    /**
     * @notice Distributes income to token holders.
     */
    function distributeIncome(uint256 value) internal virtual {
        uint256 poolIncome = _poolConfig.distributeIncome(value);
        _totalPoolValue += poolIncome;
    }

    /**
     * @notice Reverse income to token holders.
     * @param value the amount of income to be reverted
     * @dev this is needed when the user pays off early. We collect and distribute interest
     * at the beginning of the pay period. When the user pays off early, the interest
     * for the remainder of the period will be automatically subtraced from the payoff amount.
     * The portion of the income will be reversed. We can change the parameter of distributeIncome
     * to int256 to do the job. Choose to use a separate function for better readability
     */
    function reverseIncome(uint256 value) internal virtual {
        uint256 poolIncome = _poolConfig.reverseIncome(value);
        _totalPoolValue -= poolIncome;
    }

    /**
     * @notice Distributes losses associated with the token.
     * Note: The pool (i.e. LPs) is responsible for the losses in a default. The protocol does not
     * participate in loss distribution. PoolOwner and EA only participate in their LP capacity.
     * @param value the amount of losses to be distributed
     * @dev We chose not to change distributeIncome to accepted int256 to cover losses for
     * readability consideration.
     * @dev reserveIncome() and distributeLosses() cannot be combined since protocol, poolOwner
     * and evaluationAgent do not participate in losses, but they participate in income reverse.
     */
    function distributeLosses(uint256 value) internal virtual {
        if (_totalPoolValue > value) _totalPoolValue -= value;
        else _totalPoolValue = 0;
    }

    /**
     * @notice turns off the pool
     * Note that existing loans will still be processed as expected.
     */
    function disablePool() external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        _status = PoolStatus.Off;
        emit PoolDisabled(msg.sender);
    }

    /**
     * @notice turns on the pool
     */
    function enablePool() external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig.checkLiquidityRequirement();

        _status = PoolStatus.On;
        emit PoolEnabled(msg.sender);
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

    function totalPoolValue() external view override returns (uint256) {
        return _totalPoolValue;
    }

    function lastDepositTime(address account) external view returns (uint256) {
        return _lastDepositTime[account];
    }

    function poolConfig() external view returns (address) {
        return address(_poolConfig);
    }

    function isPoolOn() external view returns (bool status) {
        if (_status == PoolStatus.On) return true;
        else return false;
    }

    // In order for a pool to issue new loans, it must be turned on by an admin
    // and its custom loan helper must be approved by the Huma team
    function protocolAndPoolOn() internal view {
        if (_humaConfig.isProtocolPaused()) revert Errors.protocolIsPaused();
        if (_status != PoolStatus.On) revert Errors.poolIsNotOn();
    }

    function onlyApprovedLender(address lender) internal view {
        if (!_approvedLenders[lender]) revert Errors.permissionDeniedNotLender();
    }

    function onlyOwnerOrHumaMasterAdmin() internal view {
        _poolConfig.onlyOwnerOrHumaMasterAdmin(msg.sender);
    }
}
