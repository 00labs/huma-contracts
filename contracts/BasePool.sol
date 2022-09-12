//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./BasePoolStorage.sol";

import "./interfaces/ILiquidityProvider.sol";
import "./interfaces/IPool.sol";

import "./HumaConfig.sol";

import "hardhat/console.sol";

abstract contract BasePool is BasePoolStorage, OwnableUpgradeable, ILiquidityProvider, IPool {
    using SafeERC20 for IERC20;

    event LiquidityDeposited(address indexed account, uint256 assetAmount, uint256 shareAmount);
    event LiquidityWithdrawn(address indexed account, uint256 assetAmount, uint256 shareAmount);
    event PoolInitialized(address _poolAddress);

    event EvaluationAgentAdded(address agent, address by);
    event PoolNameChanged(string newName, address by);
    event PoolDisabled(address by);
    event PoolEnabled(address by);
    event PoolDefaultGracePeriodChanged(uint256 _gracePeriodInDays, address by);
    event WithdrawalLockoutPeriodUpdated(uint256 _lockoutPeriodInDays, address by);
    event PoolLiquidityCapChanged(uint256 _liquidityCap, address by);
    event APRUpdated(uint256 _aprInBps);

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

    /**
     * @param poolToken the token supported by the pool.
     * @param humaConfig the configurator for the protocol
     * @param feeManager support key calculations for each pool
     * @param poolName the name for the pool
     */
    function initialize(
        address poolToken,
        address humaConfig,
        address feeManager,
        string memory poolName
    ) external initializer {
        _poolName = poolName;
        _poolToken = IHDT(poolToken);
        _underlyingToken = IERC20(_poolToken.assetToken());
        _humaConfig = humaConfig;
        _feeManagerAddress = feeManager;

        _poolConfig._withdrawalLockoutPeriodInSeconds = uint64(SECONDS_IN_180_DAYS);
        _poolConfig._poolDefaultGracePeriodInSeconds = HumaConfig(humaConfig)
            .protocolDefaultGracePeriod();
        _status = PoolStatus.Off;

        __Ownable_init();

        emit PoolInitialized(address(this));
    }

    function setPoolToken(address poolToken) external {
        onlyOwnerOrHumaMasterAdmin();
        _poolToken = IHDT(poolToken);
        _underlyingToken = IERC20(_poolToken.assetToken());
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
        onlyOwnerOrHumaMasterAdmin();
        return _deposit(msg.sender, amount);
    }

    function _deposit(address lender, uint256 amount) internal {
        require(amount > 0, "AMOUNT_IS_ZERO");

        _underlyingToken.safeTransferFrom(lender, address(this), amount);
        uint256 shares = _poolToken.mintAmount(lender, amount);
        _lastDepositTime[lender] = block.timestamp;
        _totalLiquidity += amount;

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
    function withdraw(uint256 amount) external virtual override {
        protocolAndPoolOn();
        require(amount > 0, "AMOUNT_IS_ZERO");

        require(
            block.timestamp >=
                _lastDepositTime[msg.sender] + _poolConfig._withdrawalLockoutPeriodInSeconds,
            "WITHDRAW_TOO_SOON"
        );
        uint256 withdrawableAmount = _poolToken.withdrawableFundsOf(msg.sender);
        require(amount <= withdrawableAmount, "WITHDRAW_AMT_TOO_GREAT");

        uint256 shares = _poolToken.burnAmount(msg.sender, amount);
        _totalLiquidity -= amount;
        _underlyingToken.safeTransfer(msg.sender, amount);

        emit LiquidityWithdrawn(msg.sender, amount, shares);
    }

    /**
     * @notice Withdraw all balance from the pool.
     */
    function withdrawAll() external virtual override {
        protocolAndPoolOn();

        require(
            block.timestamp >=
                _lastDepositTime[msg.sender] + _poolConfig._withdrawalLockoutPeriodInSeconds,
            "WITHDRAW_TOO_SOON"
        );

        uint256 shares = IERC20(address(_poolToken)).balanceOf(msg.sender);
        require(shares > 0, "SHARES_IS_ZERO");
        uint256 amount = _poolToken.burn(msg.sender, shares);
        _totalLiquidity -= amount;
        _underlyingToken.safeTransfer(msg.sender, amount);

        emit LiquidityWithdrawn(msg.sender, amount, shares);
    }

    /**
     * @notice Distributes income to token holders.
     * @dev It reverts if the total supply of tokens is 0.
     * It emits the `IncomeDistributed` event if the amount of received is greater than 0.
     * About undistributed income:
     *   In each distribution, there is a small amount of funds which does not get distributed,
     *     which is `(msg.value * POINTS_MULTIPLIER) % totalSupply()`.
     *   With a well-chosen `POINTS_MULTIPLIER`, the amount funds that are not getting distributed
     *     in a distribution can be less than 1 (base unit).
     *   We can actually keep track of the undistributed in a distribution
     *     and try to distribute it in the next distribution ....... todo implement
     */
    function distributeIncome(uint256 value) internal virtual {
        _totalLiquidity += value;
    }

    /**
     * @notice Distributes losses associated with the token
     * @dev Technically, we can combine distributeIncome() and distributeLossees() by making
     * the parameter to int256, however, we decided to use separate APIs to improve readability
     * and reduce errors.
     * @param value the amount of losses to be distributed
     */
    function distributeLosses(uint256 value) internal virtual {
        _totalLiquidity -= value;
    }

    /********************************************/
    //                Settings                  //
    /********************************************/

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
    function addEvaluationAgent(address agent) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        denyZeroAddress(agent);
        _evaluationAgents[agent] = true;
        emit EvaluationAgentAdded(agent, msg.sender);
    }

    /**
     * @notice change the default APR for the pool
     * @param aprInBps APR in basis points, use 500 for 5%
     */
    function setAPR(uint256 aprInBps) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        require(aprInBps <= 10000, "INVALID_APR");
        _poolAprInBps = aprInBps;
        emit APRUpdated(aprInBps);
    }

    /**
     * @notice Set the receivable rate in terms of basis points.
     * @param receivableInBps the percentage. A percentage over 10000 means overreceivableization.
     */
    function setReceivableRequiredInBps(uint256 receivableInBps) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        require(receivableInBps <= 10000, "INVALID_COLLATERAL_IN_BPS");
        _poolConfig._receivableRequiredInBps = uint16(receivableInBps);
    }

    /**
     * @notice Sets the min and max of each loan/credit allowed by the pool.
     * @param maxCreditLine the max amount of a credit line
     */
    function setMaxCreditLine(uint256 maxCreditLine) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        require(maxCreditLine > 0, "MAX_IS_ZERO");
        _poolConfig._maxCreditLine = uint96(maxCreditLine);
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
        _status = PoolStatus.On;
        emit PoolEnabled(msg.sender);
    }

    /**
     * Sets the default grace period for this pool.
     * @param gracePeriodInDays the desired grace period in days.
     */
    function setPoolDefaultGracePeriod(uint256 gracePeriodInDays) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig._poolDefaultGracePeriodInSeconds = uint64(
            gracePeriodInDays * SECONDS_IN_A_DAY
        );
        emit PoolDefaultGracePeriodChanged(gracePeriodInDays, msg.sender);
    }

    /**
     * Sets withdrawal lockout period after the lender makes the last deposit
     * @param lockoutPeriodInDays the lockout period in terms of days
     */
    function setWithdrawalLockoutPeriod(uint256 lockoutPeriodInDays) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig._withdrawalLockoutPeriodInSeconds = uint64(
            lockoutPeriodInDays * SECONDS_IN_A_DAY
        );
        emit WithdrawalLockoutPeriodUpdated(lockoutPeriodInDays, msg.sender);
    }

    /**
     * @notice Sets the cap of the pool liquidity.
     * @param liquidityCap the upper bound that the pool accepts liquidity from the depositers
     */
    function setPoolLiquidityCap(uint256 liquidityCap) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig._liquidityCap = uint96(liquidityCap);
        emit PoolLiquidityCapChanged(liquidityCap, msg.sender);
    }

    /**
     * Returns a summary information of the pool.
     * @return token the address of the pool token
     * @return apr the default APR of the pool
     * @return minCreditAmount the min amount that one can borrow in a transaction
     * @return maxCreditAmount the max amount for the credit line
     */
    function getPoolSummary()
        external
        view
        virtual
        override
        returns (
            address token,
            uint256 apr,
            uint256 minCreditAmount,
            uint256 maxCreditAmount,
            uint256 liquiditycap,
            string memory name,
            string memory symbol,
            uint8 decimals
        )
    {
        IERC20Metadata erc20Contract = IERC20Metadata(address(_poolToken));
        return (
            address(_underlyingToken),
            _poolAprInBps,
            0,
            _poolConfig._maxCreditLine,
            _poolConfig._liquidityCap,
            erc20Contract.name(),
            erc20Contract.symbol(),
            erc20Contract.decimals()
        );
    }

    function totalLiquidity() external view override returns (uint256) {
        return _totalLiquidity;
    }

    function lastDepositTime(address account) external view returns (uint256) {
        return _lastDepositTime[account];
    }

    function poolDefaultGracePeriodInSeconds() external view returns (uint256) {
        return _poolConfig._poolDefaultGracePeriodInSeconds;
    }

    function withdrawalLockoutPeriodInSeconds() external view returns (uint256) {
        return _poolConfig._withdrawalLockoutPeriodInSeconds;
    }

    // Allow for sensitive pool functions only to be called by
    // the pool owner and the huma master admin
    function onlyOwnerOrHumaMasterAdmin() internal view {
        require(
            (msg.sender == owner() || msg.sender == HumaConfig(_humaConfig).owner()),
            "PERMISSION_DENIED_NOT_ADMIN"
        );
    }

    // In order for a pool to issue new loans, it must be turned on by an admin
    // and its custom loan helper must be approved by the Huma team
    function protocolAndPoolOn() internal view {
        require(HumaConfig(_humaConfig).isProtocolPaused() == false, "PROTOCOL_PAUSED");
        require(_status == PoolStatus.On, "POOL_NOT_ON");
    }

    function denyZeroAddress(address addr) internal pure {
        require(addr != address(0), "ADDRESS_0_PROVIDED");
    }
}
