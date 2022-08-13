//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

import "./interfaces/ILiquidityProvider.sol";
import "./interfaces/IPoolLocker.sol";
import "./interfaces/IPool.sol";
import "./PoolLocker.sol";
import "./HDT/HDT.sol";
import "./HumaConfig.sol";
import "./PoolLocker.sol";
import "./PoolLockerFactory.sol";

abstract contract BasePool is HDT, ILiquidityProvider, IPool, Ownable {
    using SafeERC20 for IERC20;
    using ERC165Checker for address;

    // HumaConfig. Removed immutable since Solidity disallow reference it in the constructor,
    // but we need to retrieve the poolDefaultGracePeriod in the constructor.
    address public humaConfig;

    // Liquidity holder proxy contract for this pool
    address public poolLockerAddr;

    // Address for the fee manager contract
    address public feeManagerAddr;

    // Tracks the amount of liquidity in poolTokens provided to this pool by an address
    mapping(address => LenderInfo) public lenderInfo;

    // The ERC20 token this pool manages
    IERC20 internal immutable poolToken;

    // The max liquidity allowed for the pool.
    uint256 internal liquidityCap;

    // the min amount each loan/credit.
    uint256 internal minBorrowAmt;

    // The maximum amount of poolTokens that this pool allows in a single loan
    uint256 internal maxBorrowAmt;

    // The interest rate this pool charges for loans
    uint256 internal poolAprInBps;

    // The collateral basis percentage required from lenders
    uint256 internal collateralRequiredInBps;

    // Platform fee, charged when a loan is originated
    uint256 front_loading_fee_flat;
    uint256 front_loading_fee_bps;
    // Late fee, charged when the borrow is late for a pyament.
    uint256 late_fee_flat;
    uint256 late_fee_bps;
    // Early payoff fee, charged when the borrow pays off prematurely
    uint256 back_loading_fee_flat;
    uint256 back_loading_fee_bps;

    PoolStatus public status = PoolStatus.Off;

    // List of credit approvers who can approve credit requests.
    mapping(address => bool) public creditApprovers;

    // How long after the last deposit that a lender needs to wait
    // before they can withdraw their capital
    uint256 public withdrawalLockoutPeriod = 2630000;

    uint256 public poolDefaultGracePeriod;

    // todo (by RL) Need to use uint32 and uint48 for diff fields to take advantage of packing
    struct LenderInfo {
        uint256 amount;
        uint256 weightedDepositDate; // weighted average deposit date
        uint256 mostRecentLoanTimestamp;
    }

    enum PoolStatus {
        Off,
        On
    }

    event LiquidityDeposited(address by, uint256 principal);
    event LiquidityWithdrawn(address by, uint256 principal, uint256 netAmt);
    event PoolDeployed(address _poolAddress);

    constructor(
        address _poolToken,
        address _humaConfig,
        address _poolLockerFactory,
        address _feeManager
    ) HDT("Huma", "Huma", _poolToken) {
        poolToken = IERC20(_poolToken);
        humaConfig = _humaConfig;
        feeManagerAddr = _feeManager;

        poolDefaultGracePeriod = HumaConfig(humaConfig)
            .protocolDefaultGracePeriod();

        poolLockerAddr = PoolLockerFactory(_poolLockerFactory).deployNewLocker(
            address(this),
            _poolToken
        );

        emit PoolDeployed(address(this));
    }

    modifier onlyHumaMasterAdmin() {
        require(
            msg.sender == HumaConfig(humaConfig).owner(),
            "BasePool:PERMISSION_DENIED_NOT_MASTER_ADMIN"
        );
        _;
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
        poolOn();
        // todo (by RL) Need to check if the pool is open to msg.sender to deposit
        // todo (by RL) Need to add maximal pool size support and check if it has reached the size
        return _deposit(msg.sender, amount);
    }

    function _deposit(address lender, uint256 amount) internal {
        // Update weighted deposit date:
        // prevDate + (now - prevDate) * (amount / (balance + amount))
        // NOTE: prevDate = 0 implies balance = 0, and equation reduces to now
        uint256 prevDate = lenderInfo[lender].weightedDepositDate;
        uint256 balance = lenderInfo[lender].amount;

        uint256 newDate = (balance + amount) > 0
            ? prevDate +
                (((block.timestamp - prevDate) * amount) / (balance + amount))
            : prevDate;

        lenderInfo[lender].weightedDepositDate = newDate;
        lenderInfo[lender].amount += amount;
        lenderInfo[lender].mostRecentLoanTimestamp = block.timestamp;

        poolToken.safeTransferFrom(lender, poolLockerAddr, amount);

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
        poolOn();
        require(
            block.timestamp >=
                lenderInfo[msg.sender].mostRecentLoanTimestamp +
                    withdrawalLockoutPeriod,
            "BasePool:WITHDRAW_TOO_SOON"
        );
        require(
            amount <= lenderInfo[msg.sender].amount,
            "BasePool:WITHDRAW_AMT_TOO_GREAT"
        );

        lenderInfo[msg.sender].amount -= amount;

        // Calculate the amount that msg.sender can actually withdraw.
        // withdrawableFundsOf(...) returns everything that msg.sender can claim in terms of
        // number of poolToken, incl. principal,income and losses.
        // then get the portion that msg.sender wants to withdraw (amount / total principal)
        uint256 amountToWithdraw = (withdrawableFundsOf(msg.sender) * amount) /
            balanceOf(msg.sender);

        _burn(msg.sender, amount);

        PoolLocker(poolLockerAddr).transfer(msg.sender, amountToWithdraw);

        emit LiquidityWithdrawn(msg.sender, amount, amountToWithdraw);
    }

    /**
     * @notice Withdraw all balance from the pool.
     */
    function withdrawAll() external virtual override {
        return withdraw(lenderInfo[msg.sender].amount);
    }

    /********************************************/
    //                Settings                  //
    /********************************************/

    /**
     * @notice Adds an approver to the list who can approve loans.
     * @param approver the approver to be added
     */
    function addCreditApprover(address approver) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        creditApprovers[approver] = true;
    }

    function setAPR(uint256 _aprInBps) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        require(_aprInBps >= 0 && _aprInBps <= 10000, "BasePool:INVALID_APR");
        poolAprInBps = _aprInBps;
    }

    function setCollateralRequiredInBps(uint256 _collateralInBps)
        external
        virtual
        override
    {
        onlyOwnerOrHumaMasterAdmin();
        require(_collateralInBps >= 0);
        collateralRequiredInBps = _collateralInBps;
    }

    /**
     * @notice Sets the min and max of each loan/credit allowed by the pool.
     */
    function setMinMaxBorrowAmt(uint256 _minBorrowAmt, uint256 _maxBorrowAmt)
        external
        virtual
        override
    {
        onlyOwnerOrHumaMasterAdmin();
        require(_minBorrowAmt > 0, "BasePool:MINAMT_IS_ZERO");
        require(_maxBorrowAmt >= _minBorrowAmt, "BasePool:MAX_LESS_THAN_MIN");
        minBorrowAmt = _minBorrowAmt;
        maxBorrowAmt = _maxBorrowAmt;
    }

    function setPoolLocker(address _poolLockerAddr)
        external
        virtual
        override
        returns (bool)
    {
        onlyOwnerOrHumaMasterAdmin();
        poolLockerAddr = _poolLockerAddr;

        return true;
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
        poolDefaultGracePeriod = _gracePeriodInDays;
    }

    function setWithdrawalLockoutPeriod(uint256 _withdrawalLockoutPeriod)
        external
        virtual
        override
    {
        onlyOwnerOrHumaMasterAdmin();
        withdrawalLockoutPeriod = _withdrawalLockoutPeriod;
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

    function setFees(
        uint256 _front_loading_fee_flat,
        uint256 _front_loading_fee_bps,
        uint256 _late_fee_flat,
        uint256 _late_fee_bps,
        uint256 _back_platform_fee_flat,
        uint256 _back_platform_fee_bps
    ) public virtual override {
        onlyOwnerOrHumaMasterAdmin();
        require(
            _front_loading_fee_bps > HumaConfig(humaConfig).treasuryFee(),
            "BasePool:PLATFORM_FEE_LESS_THAN_PROTOCOL_FEE"
        );
        front_loading_fee_flat = _front_loading_fee_flat;
        front_loading_fee_bps = _front_loading_fee_bps;
        late_fee_flat = _late_fee_flat;
        late_fee_bps = _late_fee_bps;
        back_loading_fee_flat = _back_platform_fee_flat;
        back_loading_fee_bps = _back_platform_fee_bps;
    }

    function getLenderInfo(address _lender)
        public
        view
        returns (LenderInfo memory)
    {
        return lenderInfo[_lender];
    }

    function getPoolLiquidity() public view returns (uint256) {
        return poolToken.balanceOf(poolLockerAddr);
    }

    // Function to receive Ether. msg.data must be empty
    receive() external payable {}

    // Fallback function is called when msg.data is not empty
    fallback() external payable {}

    function getBalance() public view returns (uint256) {
        return address(this).balance;
    }

    function getPoolSummary()
        public
        view
        virtual
        override
        returns (
            address token,
            uint256 apr,
            uint256 minCreditAmt,
            uint256 maxCreditAmt,
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
            minBorrowAmt,
            maxBorrowAmt,
            liquidityCap,
            erc20Contract.name(),
            erc20Contract.symbol(),
            erc20Contract.decimals()
        );
    }

    /// returns (maxLoanAmt, interest, and the 6 fee fields)
    function getPoolFees()
        public
        view
        virtual
        override
        returns (
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        return (
            poolAprInBps,
            front_loading_fee_flat,
            front_loading_fee_bps,
            late_fee_flat,
            late_fee_bps,
            back_loading_fee_flat,
            back_loading_fee_bps
        );
    }

    // Allow for sensitive pool functions only to be called by
    // the pool owner and the huma master admin
    function onlyOwnerOrHumaMasterAdmin() internal view {
        require(
            (msg.sender == owner() ||
                msg.sender == HumaConfig(humaConfig).owner()),
            "BasePool:PERMISSION_DENIED_NOT_ADMIN"
        );
    }

    // In order for a pool to issue new loans, it must be turned on by an admin
    // and its custom loan helper must be approved by the Huma team
    function poolOn() internal view {
        require(
            HumaConfig(humaConfig).isProtocolPaused() == false,
            "BasePool:PROTOCOL_PAUSED"
        );
        require(status == PoolStatus.On, "BasePool:POOL_NOT_ON");
    }
}
