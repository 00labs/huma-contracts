//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import "./interfaces/ILiquidityProvider.sol";
import "./interfaces/IPool.sol";
import "./interfaces/IFeeManager.sol";
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

    // the min amount each loan/credit.
    uint256 internal minBorrowAmount;

    // The maximum credit line in terms of the amount of poolTokens
    uint256 internal maxCreditLine;

    // The interest rate this pool charges for loans
    uint256 internal poolAprInBps;

    // The collateral basis percentage required from lenders
    uint256 internal collateralRequiredInBps;

    PoolStatus public status = PoolStatus.Off;

    // List of evaluation agents who can approve credit requests.
    mapping(address => bool) public evaluationAgents;

    // How long after the last deposit that a lender needs to wait
    // before they can withdraw their capital
    uint256 public withdrawalLockoutPeriodInSeconds = SECONDS_IN_180_DAYS;

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

        poolDefaultGracePeriodInSeconds = HumaConfig(humaConfig)
            .protocolDefaultGracePeriod();

        emit PoolDeployed(address(this));
    }

    //********************************************/
    //               LP Functions                //
    //********************************************/

    /**
     * @notice LP deposits to the pool to earn interest, and share losses
     * @param amount the number of `poolToken` to be deposited
     */
    function makeInitialDeposit(uint256 amount) external virtual override {
        return _deposit(msg.sender, amount);
    }

    function deposit(uint256 amount) external virtual override {
        protocolAndPoolOn();
        // todo (by RL) Need to check if the pool is open to msg.sender to deposit
        // todo (by RL) Need to add maximal pool size support and check if it has reached the size
        return _deposit(msg.sender, amount);
    }

    function _deposit(address lender, uint256 amount) internal {
        // Update weighted deposit date:
        // prevDate + (now - prevDate) * (amount / (balance + amount))
        // NOTE: prevDate = 0 implies balance = 0, and equation reduces to now
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
     * @notice Withdraw principal that was deposited into the pool before in the unit of `poolTokens`
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
                uint256(li.mostRecentCreditTimestamp) +
                    withdrawalLockoutPeriodInSeconds,
            "WITHDRAW_TOO_SOON"
        );
        uint256 withdrawableAmount = withdrawableFundsOf(msg.sender);
        require(amount <= withdrawableAmount, "WITHDRAW_AMT_TOO_GREAT");

        // Calcuate the corresponding principal amount to reduce
        uint256 principalToReduce = (balanceOf(msg.sender) * amount) /
            withdrawableAmount;

        li.principalAmount = uint96(
            uint256(li.principalAmount) - principalToReduce
        );

        lenderInfo[msg.sender] = li;

        _burn(msg.sender, principalToReduce);

        poolToken.transfer(msg.sender, amount);

        emit LiquidityWithdrawn(msg.sender, amount, principalToReduce);
    }

    /**
     * @notice Withdraw all balance from the pool.
     */
    function withdrawAll() external virtual override {
        return withdraw(lenderInfo[msg.sender].principalAmount);
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
    }

    /**
     * @notice Adds an evaluation agent to the list who can approve loans.
     * @param agent the evaluation agent to be added
     */
    function addEvaluationAgent(address agent) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        denyZeroAddress(agent);
        evaluationAgents[agent] = true;
    }

    function setAPR(uint256 _aprInBps) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        require(_aprInBps <= 10000, "INVALID_APR");
        poolAprInBps = _aprInBps;
    }

    function setCollateralRequiredInBps(uint256 _collateralInBps)
        external
        virtual
        override
    {
        onlyOwnerOrHumaMasterAdmin();
        require(_collateralInBps <= 10000, "INVALID_COLLATERAL_IN_BPS");
        collateralRequiredInBps = _collateralInBps;
    }

    /**
     * @notice Sets the min and max of each loan/credit allowed by the pool.
     */
    function setMinMaxBorrowAmount(
        uint256 _minBorrowAmount,
        uint256 _maxCreditLine
    ) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        require(_minBorrowAmount > 0, "MINAMT_IS_ZERO");
        require(_maxCreditLine >= _minBorrowAmount, "MAX_LESS_THAN_MIN");
        minBorrowAmount = _minBorrowAmount;
        maxCreditLine = _maxCreditLine;
    }

    // Reject all future borrow applications and loans. Note that existing
    // loans will still be processed as expected.
    function disablePool() external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        status = PoolStatus.Off;
    }

    // Allow borrow applications and loans to be processed by this pool.
    function enablePool() external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        status = PoolStatus.On;
    }

    /**
     * Sets the default grace period for this pool.
     * @param _gracePeriodInDays the desired grace period in days.
     */
    function setPoolDefaultGracePeriod(uint256 _gracePeriodInDays)
        external
        virtual
        override
    {
        onlyOwnerOrHumaMasterAdmin();
        poolDefaultGracePeriodInSeconds = _gracePeriodInDays * SECONDS_IN_A_DAY;
    }

    function setWithdrawalLockoutPeriod(uint256 _lockoutPeriodInDays)
        external
        virtual
        override
    {
        onlyOwnerOrHumaMasterAdmin();
        withdrawalLockoutPeriodInSeconds =
            _lockoutPeriodInDays *
            SECONDS_IN_A_DAY;
    }

    /**
     * @notice Sets the cap of the pool liquidity.
     */
    function setPoolLiquidityCap(uint256 _liquidityCap)
        external
        virtual
        override
    {
        onlyOwnerOrHumaMasterAdmin();
        liquidityCap = _liquidityCap;
    }

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
            (msg.sender == owner() ||
                msg.sender == HumaConfig(humaConfig).owner()),
            "PERMISSION_DENIED_NOT_ADMIN"
        );
    }

    // In order for a pool to issue new loans, it must be turned on by an admin
    // and its custom loan helper must be approved by the Huma team
    function protocolAndPoolOn() internal view {
        require(
            HumaConfig(humaConfig).isProtocolPaused() == false,
            "PROTOCOL_PAUSED"
        );
        require(status == PoolStatus.On, "POOL_NOT_ON");
    }

    function denyZeroAddress(address addr) internal pure {
        require(addr != address(0), "ADDRESS_0_PROVIDED");
    }
}
