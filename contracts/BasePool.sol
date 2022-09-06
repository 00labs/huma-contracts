//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/ILiquidityProvider.sol";
import "./interfaces/IPool.sol";
import "./HDT/interfaces/IHDT.sol";

import "./libraries/BaseStructs.sol";
import "./HumaConfig.sol";

import "hardhat/console.sol";

abstract contract BasePool is ILiquidityProvider, IPool, Ownable {
    uint256 public constant SECONDS_IN_A_DAY = 86400;
    uint256 public constant SECONDS_IN_180_DAYS = 15552000;

    using SafeERC20 for IERC20;

    string public poolName;

    // The ERC20 token this pool manages
    IERC20 public immutable override underlyingToken;

    // The HDT token for this pool
    IHDT public poolToken;

    // The amount of underlying token belongs to lenders
    uint256 public override totalLiquidity;

    // HumaConfig. Removed immutable since Solidity disallow reference it in the constructor,
    // but we need to retrieve the poolDefaultGracePeriod in the constructor.
    address public humaConfig;

    // Address for the fee manager contract
    address public feeManagerAddress;

    // Tracks the amount of liquidity in poolTokens provided to this pool by an address
    mapping(address => uint256) public lastDepositTime;

    // The max liquidity allowed for the pool.
    uint256 internal liquidityCap;

    // the min amount that the borrower can borrow in one transaction
    uint256 internal minBorrowAmount;

    // the maximum credit line for an address in terms of the amount of poolTokens
    uint256 internal maxCreditLine;

    // the default APR for the pool in terms of basis points.
    uint256 internal poolAprInBps;

    // Percentage of receivable required for credits in this pool in terms of bais points
    // For over receivableization, use more than 100%, for no receivable, use 0.
    uint256 internal receivableRequiredInBps;

    // whether the pool is ON or OFF
    PoolStatus public status = PoolStatus.Off;

    // Evaluation Agents (EA) are the risk underwriting agents that associated with the pool.
    // Expect one pool to have one EA, but the protocol support moultiple.
    mapping(address => bool) public evaluationAgents;

    // How long a lender has to wait after the last deposit before they can withdraw
    uint256 public withdrawalLockoutPeriodInSeconds = SECONDS_IN_180_DAYS;

    // the grace period at the pool level before a Default can be triggered
    uint256 public poolDefaultGracePeriodInSeconds;

    enum PoolStatus {
        Off,
        On
    }

    event LiquidityDeposited(address indexed account, uint256 assetAmount, uint256 shareAmount);
    event LiquidityWithdrawn(address indexed account, uint256 assetAmount, uint256 shareAmount);

    event PoolDeployed(address _poolAddress);
    event EvaluationAgentAdded(address agent, address by);
    event PoolNameChanged(string newName, address by);
    event PoolDisabled(address by);
    event PoolEnabled(address by);
    event PoolDefaultGracePeriodChanged(uint256 _gracePeriodInDays, address by);
    event WithdrawalLockoutPeriodUpdated(uint256 _lockoutPeriodInDays, address by);
    event PoolLiquidityCapChanged(uint256 _liquidityCap, address by);

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

    /**
     * @param _underlyingToken the token supported by the pool. In v1, only stablecoin is supported.
     * @param _humaConfig the configurator for the protocol
     * @param _feeManager support key calculations for each pool
     * @param _poolName the name for the pool
     */
    constructor(
        address _underlyingToken,
        address _humaConfig,
        address _feeManager,
        string memory _poolName
    ) {
        poolName = _poolName;
        underlyingToken = IERC20(_underlyingToken);
        humaConfig = _humaConfig;
        feeManagerAddress = _feeManager;

        poolDefaultGracePeriodInSeconds = HumaConfig(humaConfig).protocolDefaultGracePeriod();

        emit PoolDeployed(address(this));
    }

    function setPoolToken(address _poolToken) external onlyOwner {
        poolToken = IHDT(_poolToken);
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

        underlyingToken.safeTransferFrom(lender, address(this), amount);
        uint256 shares = poolToken.mintAmount(lender, amount);
        lastDepositTime[lender] = block.timestamp;
        totalLiquidity += amount;

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
            block.timestamp >= lastDepositTime[msg.sender] + withdrawalLockoutPeriodInSeconds,
            "WITHDRAW_TOO_SOON"
        );
        uint256 withdrawableAmount = poolToken.withdrawableFundsOf(msg.sender);
        require(amount <= withdrawableAmount, "WITHDRAW_AMT_TOO_GREAT");

        uint256 shares = poolToken.burnAmount(msg.sender, amount);
        totalLiquidity -= amount;
        underlyingToken.safeTransfer(msg.sender, amount);

        emit LiquidityWithdrawn(msg.sender, amount, shares);
    }

    /**
     * @notice Withdraw all balance from the pool.
     */
    function withdrawAll() external virtual override {
        protocolAndPoolOn();

        require(
            block.timestamp >= lastDepositTime[msg.sender] + withdrawalLockoutPeriodInSeconds,
            "WITHDRAW_TOO_SOON"
        );

        uint256 shares = IERC20(address(poolToken)).balanceOf(msg.sender);
        require(shares > 0, "SHARES_IS_ZERO");
        uint256 amount = poolToken.burn(msg.sender, shares);
        totalLiquidity -= amount;
        underlyingToken.safeTransfer(msg.sender, amount);

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
        totalLiquidity += value;
    }

    /**
     * @notice Distributes losses associated with the token
     * @dev Technically, we can combine distributeIncome() and distributeLossees() by making
     * the parameter to int256, however, we decided to use separate APIs to improve readability
     * and reduce errors.
     * @param value the amount of losses to be distributed
     */
    function distributeLosses(uint256 value) internal virtual {
        totalLiquidity -= value;
    }

    /********************************************/
    //                Settings                  //
    /********************************************/

    /**
     * @notice Change pool name
     */
    function setPoolName(string memory newName) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        poolName = newName;
        emit PoolNameChanged(newName, msg.sender);
    }

    /**
     * @notice Adds an evaluation agent to the list who can approve loans.
     * @param agent the evaluation agent to be added
     */
    function addEvaluationAgent(address agent) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        denyZeroAddress(agent);
        evaluationAgents[agent] = true;
        emit EvaluationAgentAdded(agent, msg.sender);
    }

    /**
     * @notice change the default APR for the pool
     * @param _aprInBps APR in basis points, use 500 for 5%
     */
    function setAPR(uint256 _aprInBps) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        require(_aprInBps <= 10000, "INVALID_APR");
        poolAprInBps = _aprInBps;
    }

    /**
     * @notice Set the receivable rate in terms of basis points. 
     @ param _receivableInBps the percentage. A percentage over 10000 means overreceivableization.
     */
    function setReceivableRequiredInBps(uint256 _receivableInBps) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        require(_receivableInBps <= 10000, "INVALID_COLLATERAL_IN_BPS");
        receivableRequiredInBps = _receivableInBps;
    }

    /**
     * @notice Sets the min and max of each loan/credit allowed by the pool.
     * @param _minBorrowAmount the min amount allowed to borrow in a transaction
     * @param _maxCreditLine the max amount of a credit line
     */
    function setMinMaxBorrowAmount(uint256 _minBorrowAmount, uint256 _maxCreditLine)
        external
        virtual
        override
    {
        onlyOwnerOrHumaMasterAdmin();
        require(_minBorrowAmount > 0, "MINAMT_IS_ZERO");
        require(_maxCreditLine >= _minBorrowAmount, "MAX_LESS_THAN_MIN");
        minBorrowAmount = _minBorrowAmount;
        maxCreditLine = _maxCreditLine;
    }

    /**
     * @notice turns off the pool
     * Note that existing loans will still be processed as expected.
     */
    function disablePool() external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        status = PoolStatus.Off;
        emit PoolDisabled(msg.sender);
    }

    /**
     * @notice turns on the pool
     */
    function enablePool() external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        status = PoolStatus.On;
        emit PoolEnabled(msg.sender);
    }

    /**
     * Sets the default grace period for this pool.
     * @param _gracePeriodInDays the desired grace period in days.
     */
    function setPoolDefaultGracePeriod(uint256 _gracePeriodInDays) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        poolDefaultGracePeriodInSeconds = _gracePeriodInDays * SECONDS_IN_A_DAY;
        emit PoolDefaultGracePeriodChanged(_gracePeriodInDays, msg.sender);
    }

    /**
     * Sets withdrawal lockout period after the lender makes the last deposit
     * @param _lockoutPeriodInDays the lockout period in terms of days
     */
    function setWithdrawalLockoutPeriod(uint256 _lockoutPeriodInDays) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        withdrawalLockoutPeriodInSeconds = _lockoutPeriodInDays * SECONDS_IN_A_DAY;
        emit WithdrawalLockoutPeriodUpdated(_lockoutPeriodInDays, msg.sender);
    }

    /**
     * @notice Sets the cap of the pool liquidity.
     * @param _liquidityCap the upper bound that the pool accepts liquidity from the depositers
     */
    function setPoolLiquidityCap(uint256 _liquidityCap) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        liquidityCap = _liquidityCap;
        emit PoolLiquidityCapChanged(_liquidityCap, msg.sender);
    }

    /**
     * Returns a summary information of the pool.
     * @return token the address of the pool token
     * @return apr the default APR of the pool
     * @return minCreditAmount the min amount that one can borrow in a transaction
     * @return maxCreditAmount the max amount for the credit line
     */
    function getPoolSummary()
        public
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
        IERC20Metadata erc20Contract = IERC20Metadata(address(poolToken));
        return (
            address(underlyingToken),
            poolAprInBps,
            minBorrowAmount,
            maxCreditLine,
            liquidityCap,
            erc20Contract.name(),
            erc20Contract.symbol(),
            erc20Contract.decimals()
        );
    }

    // Allow for sensitive pool functions only to be called by
    // the pool owner and the huma master admin
    function onlyOwnerOrHumaMasterAdmin() internal view {
        require(
            (msg.sender == owner() || msg.sender == HumaConfig(humaConfig).owner()),
            "PERMISSION_DENIED_NOT_ADMIN"
        );
    }

    // In order for a pool to issue new loans, it must be turned on by an admin
    // and its custom loan helper must be approved by the Huma team
    function protocolAndPoolOn() internal view {
        require(HumaConfig(humaConfig).isProtocolPaused() == false, "PROTOCOL_PAUSED");
        require(status == PoolStatus.On, "POOL_NOT_ON");
    }

    function denyZeroAddress(address addr) internal pure {
        require(addr != address(0), "ADDRESS_0_PROVIDED");
    }
}
