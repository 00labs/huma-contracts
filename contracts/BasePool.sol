//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IFeeManager.sol";
import "./interfaces/ILiquidityProvider.sol";
import "./interfaces/IPool.sol";

import "./libraries/BaseStructs.sol";

import "./HumaConfig.sol";
import "./HDT/HDT.sol";

import "hardhat/console.sol";

abstract contract BasePool is HDT, ILiquidityProvider, IPool, Ownable {
    uint256 public constant SECONDS_IN_A_DAY = 86400;
    uint256 public constant SECONDS_IN_180_DAYS = 15552000;

    using SafeERC20 for IERC20;

    string public poolName;

    // HumaConfig. Removed immutable since Solidity disallow reference it in the constructor,
    // but we need to retrieve the poolDefaultGracePeriod in the constructor.
    address public humaConfig;

    // Address for the fee manager contract
    address public feeManagerAddress;

    // Tracks the amount of liquidity in poolTokens provided to this pool by an address
    mapping(address => LenderInfo) public lenderInfo;

    // The ERC20 token this pool manages
    IERC20 public immutable poolToken;

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

    struct LenderInfo {
        // this field may not be needed. it should equal to hdt.balanceOf(user). todo check later & remove struct
        uint96 principalAmount;
        uint64 mostRecentCreditTimestamp;
    }

    enum PoolStatus {
        Off,
        On
    }

    event LiquidityDeposited(address by, uint256 principal);
    event LiquidityWithdrawn(address by, uint256 principal, uint256 netAmount);
    event PoolDeployed(address _poolAddress);
    event EvaluationAgentAdded(address agent, address by);
    event PoolNameChanged(string newName, address by);
    event PoolDisabled(address by);
    event PoolEnabled(address by);
    event PoolDefaultGracePeriodChanged(uint256 _gracePeriodInDays, address by);
    event WithdrawalLockoutPeriodUpdated(uint256 _lockoutPeriodInDays, address by);
    event PoolLiquidityCapChanged(uint256 _liquidityCap, address by);

    /**
     * @param _poolToken the token supported by the pool. In v1, only stablecoin is supported.
     * @param _humaConfig the configurator for the protocol
     * @param _feeManager support key calculations for each pool
     * @param _poolName the name for the pool
     * @param _hdtName the name of the HDT token
     * @param _hdtSymbol the symbol for the HDT token
     */
    constructor(
        address _poolToken,
        address _humaConfig,
        address _feeManager,
        string memory _poolName,
        string memory _hdtName,
        string memory _hdtSymbol
    ) HDT(_hdtName, _hdtSymbol, _poolToken) {
        poolName = _poolName;
        poolToken = IERC20(_poolToken);
        humaConfig = _humaConfig;
        feeManagerAddress = _feeManager;

        poolDefaultGracePeriodInSeconds = HumaConfig(humaConfig).protocolDefaultGracePeriod();

        emit PoolDeployed(address(this));
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
        LenderInfo memory li = lenderInfo[lender];

        li.principalAmount += uint96(amount);
        li.mostRecentCreditTimestamp = uint64(block.timestamp);

        lenderInfo[lender] = li;

        poolToken.safeTransferFrom(lender, address(this), amount);

        // Mint HDT for the LP to claim future income and losses
        _mint(lender, amount);

        emit LiquidityDeposited(lender, amount);
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
        LenderInfo memory li = lenderInfo[msg.sender];
        require(
            block.timestamp >=
                uint256(li.mostRecentCreditTimestamp) + withdrawalLockoutPeriodInSeconds,
            "WITHDRAW_TOO_SOON"
        );
        uint256 withdrawableAmount = withdrawableFundsOf(msg.sender);
        require(amount <= withdrawableAmount, "WITHDRAW_AMT_TOO_GREAT");

        // Calcuate the corresponding principal amount to reduce
        uint256 principalToReduce = (balanceOf(msg.sender) * amount) / withdrawableAmount;

        li.principalAmount = uint96(uint256(li.principalAmount) - principalToReduce);

        lenderInfo[msg.sender] = li;

        _burn(msg.sender, principalToReduce);

        poolToken.transfer(msg.sender, amount);

        emit LiquidityWithdrawn(msg.sender, amount, principalToReduce);
    }

    /**
     * @notice Withdraw all balance from the pool.
     */
    function withdrawAll() external virtual override {
        return withdraw(withdrawableFundsOf(msg.sender));
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
        ERC20 erc20Contract = ERC20(address(poolToken));
        return (
            address(poolToken),
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
