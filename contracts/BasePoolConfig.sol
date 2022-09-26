//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IPoolConfig.sol";
import "./HDT/HDT.sol";
import "./HumaConfig.sol";
import "./BasePool.sol";
import "./Errors.sol";

import "hardhat/console.sol";

contract BasePoolConfig is Ownable, IPoolConfig {
    using SafeERC20 for IERC20;

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

    struct AccruedIncome {
        uint256 _protocolIncome;
        uint256 _poolOwnerIncome;
        uint256 _eaIncome;
    }

    uint256 internal constant BPS_DIVIDER = 10000;
    uint256 internal constant SECONDS_IN_A_DAY = 86400;
    uint256 internal constant SECONDS_IN_180_DAYS = 15552000;

    string public poolName;

    address public pool;

    HumaConfig public humaConfig;

    address public feeManager;

    // The HDT token for this pool
    HDT public poolToken;

    // The ERC20 token this pool manages
    IERC20 public underlyingToken;

    // Evaluation Agents (EA) are the risk underwriting agents that associated with the pool.
    address public evaluationAgent;

    uint256 public evaluationAgentId;

    PoolConfig internal _poolConfig;

    AccruedIncome internal _accuredIncome;

    event PoolNameChanged(string newName, address by);
    event EvaluationAgentChanged(address oldEA, address newEA, address by);
    event EvaluationAgentRewardsWithdrawn(uint256 amount, address receiver, address by);
    event APRUpdated(uint256 _aprInBps);
    event PoolDefaultGracePeriodChanged(uint256 _gracePeriodInDays, address by);
    event PoolPayPeriodChanged(uint256 periodInDays, address by);
    event WithdrawalLockoutPeriodUpdated(uint256 _lockoutPeriodInDays, address by);
    event PoolLiquidityCapChanged(uint256 _liquidityCap, address by);
    event CreditApprovalExpirationChanged(uint256 durationInSeconds, address by);

    event PoolOwnerCommisionAndLiquidityChanged(
        uint256 rewardsRate,
        uint256 liquidityRate,
        address indexed by
    );

    event EACommisionAndLiquidityChanged(
        uint256 rewardsRate,
        uint256 liquidityRate,
        address indexed by
    );

    constructor(
        string memory _poolName,
        address _poolToken,
        address _humaConfig,
        address _feeManager
    ) {
        poolName = _poolName;
        poolToken = HDT(_poolToken);
        underlyingToken = IERC20(poolToken.assetToken());
        humaConfig = HumaConfig(_humaConfig);
        feeManager = _feeManager;

        _poolConfig._withdrawalLockoutPeriodInSeconds = SECONDS_IN_180_DAYS; // todo need to make this configurable
        _poolConfig._poolDefaultGracePeriodInSeconds = HumaConfig(humaConfig)
            .protocolDefaultGracePeriodInSeconds();
    }

    /********************************************/
    //                Settings                  //
    /********************************************/

    /**
     * @notice Change pool name
     */
    function setPoolName(string memory newName) external override {
        onlyOwnerOrHumaMasterAdmin();
        poolName = newName;
        emit PoolNameChanged(newName, msg.sender);
    }

    function setPool(address _pool) external {
        onlyOwnerOrHumaMasterAdmin();
        pool = _pool;
    }

    function setHumaConfig(address _humaConfig) external {
        onlyOwnerOrHumaMasterAdmin();
        humaConfig = HumaConfig(_humaConfig);
    }

    function setFeeManager(address _feeManager) external {
        onlyOwnerOrHumaMasterAdmin();
        feeManager = _feeManager;
    }

    function setPoolToken(address _poolToken) external {
        onlyOwnerOrHumaMasterAdmin();
        poolToken = HDT(_poolToken);
        underlyingToken = IERC20(poolToken.assetToken());
    }

    /**
     * @notice Adds an evaluation agent to the list who can approve loans.
     * @param agent the evaluation agent to be added
     */
    function setEvaluationAgent(uint256 eaId, address agent) external override {
        if (agent == address(0)) revert Errors.zeroAddressProvided();
        onlyOwnerOrHumaMasterAdmin();

        // todo change script to make sure eaNFTContract is deployed, and the eaId is minted.
        // if (IERC721(HumaConfig(_humaConfig).eaNFTContractAddress()).ownerOf(eaId) != agent)
        //     revert notEvaluationAgentOwnerProvided();

        // Make sure the new EA has met the liquidity requirements
        if (BasePool(pool).isPoolOn()) {
            checkLiquidityRequirementForEA(poolToken.withdrawableFundsOf(agent));
        }

        // Transfer the accrued EA income to the old EA's wallet.
        // Decided not to check if there is enough balance in the pool. If there is
        // not enough balance, the transaction will fail. PoolOwner has to find enough
        // liquidity to pay the EA before replacing it.
        address oldEA = evaluationAgent;
        if (oldEA != address(0)) {
            uint256 rewardsToPayout = _accuredIncome._eaIncome;
            if (rewardsToPayout > 0) {
                _accuredIncome._eaIncome = 0;
                underlyingToken.safeTransfer(oldEA, rewardsToPayout);
                emit EvaluationAgentRewardsWithdrawn(rewardsToPayout, oldEA, msg.sender);
            }
        }

        evaluationAgent = agent;
        evaluationAgentId = eaId;
        emit EvaluationAgentChanged(oldEA, agent, msg.sender);
    }

    /**
     * @notice change the default APR for the pool
     * @param aprInBps APR in basis points, use 500 for 5%
     */
    function setAPR(uint256 aprInBps) external {
        onlyOwnerOrHumaMasterAdmin();
        if (aprInBps > 10000) revert Errors.invalidBasisPointHigherThan10000();
        _poolConfig._poolAprInBps = aprInBps;
        emit APRUpdated(aprInBps);
    }

    /**
     * @notice Set the receivable rate in terms of basis points.
     * When the rate is higher than 10000, it means the backing is higher than the borrow amount,
     * similar to an over-collateral situation.
     * @param receivableInBps the percentage. A percentage over 10000 means overreceivableization.
     */
    function setReceivableRequiredInBps(uint256 receivableInBps) external {
        onlyOwnerOrHumaMasterAdmin();
        // note: this rate can be over 10000 when it requires more backing than the credit limit
        _poolConfig._receivableRequiredInBps = receivableInBps;
    }

    /**
     * @notice Sets the min and max of each loan/credit allowed by the pool.
     * @param creditLine the max amount of a credit line
     */
    function setMaxCreditLine(uint256 creditLine) external {
        onlyOwnerOrHumaMasterAdmin();
        if (creditLine == 0) revert Errors.zeroAmountProvided();
        _poolConfig._maxCreditLine = creditLine;
    }

    /**
     * Sets the default grace period for this pool.
     * @param gracePeriodInDays the desired grace period in days.
     */
    function setPoolDefaultGracePeriod(uint256 gracePeriodInDays) external {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig._poolDefaultGracePeriodInSeconds = gracePeriodInDays * SECONDS_IN_A_DAY;
        emit PoolDefaultGracePeriodChanged(gracePeriodInDays, msg.sender);
    }

    function setPoolPayPeriod(uint256 periodInDays) external {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig._payPeriodInDays = periodInDays;
        emit PoolPayPeriodChanged(periodInDays, msg.sender);
    }

    /**
     * Sets withdrawal lockout period after the lender makes the last deposit
     * @param lockoutPeriodInDays the lockout period in terms of days
     */
    function setWithdrawalLockoutPeriod(uint256 lockoutPeriodInDays) external {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig._withdrawalLockoutPeriodInSeconds = lockoutPeriodInDays * SECONDS_IN_A_DAY;
        emit WithdrawalLockoutPeriodUpdated(lockoutPeriodInDays, msg.sender);
    }

    /**
     * @notice Sets the cap of the pool liquidity.
     * @param liquidityCap the upper bound that the pool accepts liquidity from the depositers
     */
    function setPoolLiquidityCap(uint256 liquidityCap) external {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig._liquidityCap = liquidityCap;
        emit PoolLiquidityCapChanged(liquidityCap, msg.sender);
    }

    function setPoolOwnerRewardsAndLiquidity(uint256 rewardsRate, uint256 liquidityRate) external {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig._rewardRateInBpsForPoolOwner = rewardsRate;
        _poolConfig._liquidityRateInBpsByPoolOwner = liquidityRate;
        emit PoolOwnerCommisionAndLiquidityChanged(rewardsRate, liquidityRate, msg.sender);
    }

    function setEARewardsAndLiquidity(uint256 rewardsRate, uint256 liquidityRate) external {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig._rewardRateInBpsForEA = rewardsRate;
        _poolConfig._liquidityRateInBpsByEA = liquidityRate;
        emit EACommisionAndLiquidityChanged(rewardsRate, liquidityRate, msg.sender);
    }

    function setCreditApprovalExpiration(uint256 durationInDays) external {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig._creditApprovalExpirationInSeconds = durationInDays * SECONDS_IN_A_DAY;
        emit CreditApprovalExpirationChanged(durationInDays * SECONDS_IN_A_DAY, msg.sender);
    }

    function distributeIncome(uint256 value) external returns (uint256 poolIncome) {
        if (msg.sender != pool) {
            revert Errors.callNotFromPool();
        }

        uint256 protocolFee = (uint256(humaConfig.protocolFee()) * value) / BPS_DIVIDER;
        _accuredIncome._protocolIncome += protocolFee;

        uint256 valueForPool = value - protocolFee;

        uint256 ownerIncome = (valueForPool * _poolConfig._rewardRateInBpsForPoolOwner) /
            BPS_DIVIDER;
        _accuredIncome._poolOwnerIncome += ownerIncome;

        uint256 eaIncome = (valueForPool * _poolConfig._rewardRateInBpsForEA) / BPS_DIVIDER;
        _accuredIncome._eaIncome += eaIncome;

        poolIncome = (valueForPool - ownerIncome - eaIncome);
    }

    function reverseIncome(uint256 value) external returns (uint256 poolIncome) {
        if (msg.sender != pool) {
            revert Errors.callNotFromPool();
        }

        uint256 protocolFee = (uint256(humaConfig.protocolFee()) * value) / BPS_DIVIDER;
        _accuredIncome._protocolIncome -= protocolFee;

        uint256 valueForPool = value - protocolFee;

        uint256 ownerIncome = (valueForPool * _poolConfig._rewardRateInBpsForPoolOwner) /
            BPS_DIVIDER;
        _accuredIncome._poolOwnerIncome -= ownerIncome;

        uint256 eaIncome = (valueForPool * _poolConfig._rewardRateInBpsForEA) / BPS_DIVIDER;
        _accuredIncome._eaIncome -= eaIncome;

        poolIncome = (valueForPool - ownerIncome - eaIncome);
    }

    function withdrawEAFee(uint256 amount) external {
        if (msg.sender != evaluationAgent) revert Errors.notEvaluationAgent();
        if (amount > _accuredIncome._eaIncome) revert Errors.withdrawnAmountHigherThanBalance();
        //todo pool needs to approve max amount to poolCOnfig
        underlyingToken.safeTransferFrom(pool, evaluationAgent, amount);
    }

    function withdrawProtocolFee(uint256 amount) external virtual {
        if (msg.sender != humaConfig.owner()) revert Errors.notProtocolOwner();
        if (amount > _accuredIncome._protocolIncome)
            revert Errors.withdrawnAmountHigherThanBalance();
        address treasuryAddress = humaConfig.humaTreasury();
        underlyingToken.safeTransferFrom(pool, treasuryAddress, amount);
    }

    function withdrawPoolOwnerFee(uint256 amount) external virtual {
        // todo need to add a test against non-pool-owner
        if (msg.sender != this.owner()) revert Errors.notPoolOwner();
        if (amount > _accuredIncome._poolOwnerIncome)
            revert Errors.withdrawnAmountHigherThanBalance();
        underlyingToken.safeTransferFrom(pool, this.owner(), amount);
    }

    function poolDefaultGracePeriodInSeconds() external view returns (uint256) {
        return _poolConfig._poolDefaultGracePeriodInSeconds;
    }

    function withdrawalLockoutPeriodInSeconds() external view returns (uint256) {
        return _poolConfig._withdrawalLockoutPeriodInSeconds;
    }

    function rewardsAndLiquidityRateForEA() external view returns (uint256, uint256) {
        return (_poolConfig._rewardRateInBpsForEA, _poolConfig._liquidityRateInBpsByEA);
    }

    function rewardsAndLiquidityRateForPoolOwner() external view returns (uint256, uint256) {
        return (
            _poolConfig._rewardRateInBpsForPoolOwner,
            _poolConfig._liquidityRateInBpsByPoolOwner
        );
    }

    function creditApprovalExpirationInSeconds() external view returns (uint256) {
        return _poolConfig._creditApprovalExpirationInSeconds;
    }

    function payPeriodInDays() external view returns (uint256) {
        return _poolConfig._payPeriodInDays;
    }

    function poolAprInBps() external view returns (uint256) {
        return _poolConfig._poolAprInBps;
    }

    function maxCreditLine() external view returns (uint256) {
        return _poolConfig._maxCreditLine;
    }

    function receivableRequiredInBps() external view returns (uint256) {
        return _poolConfig._receivableRequiredInBps;
    }

    function getCoreData()
        external
        view
        returns (
            address underlyingToken_,
            address poolToken_,
            address humaConfig_,
            address feeManager_
        )
    {
        underlyingToken_ = address(underlyingToken);
        poolToken_ = address(poolToken);
        humaConfig_ = address(humaConfig);
        feeManager_ = feeManager;
    }

    /**
     * Returns a summary information of the pool.
     * @return token the address of the pool token
     * @return apr the default APR of the pool
     * @return payPeriod the standard pay period for the pool
     * @return maxCreditAmount the max amount for the credit line
     */
    function getPoolSummary()
        external
        view
        returns (
            address token,
            uint256 apr,
            uint256 payPeriod,
            uint256 maxCreditAmount,
            uint256 liquiditycap,
            string memory name,
            string memory symbol,
            uint8 decimals,
            uint256 eaId,
            address eaNFTAddress
        )
    {
        IERC20Metadata erc20Contract = IERC20Metadata(address(underlyingToken));
        return (
            address(underlyingToken),
            _poolConfig._poolAprInBps,
            _poolConfig._payPeriodInDays,
            _poolConfig._maxCreditLine,
            _poolConfig._liquidityCap,
            erc20Contract.name(),
            erc20Contract.symbol(),
            erc20Contract.decimals(),
            evaluationAgentId,
            humaConfig.eaNFTContractAddress()
        );
    }

    function accruedIncome()
        external
        view
        returns (
            uint256 protocolIncome,
            uint256 poolOwnerIncome,
            uint256 eaIncome
        )
    {
        return (
            _accuredIncome._protocolIncome,
            _accuredIncome._poolOwnerIncome,
            _accuredIncome._eaIncome
        );
    }

    // Allow for sensitive pool functions only to be called by
    // the pool owner and the huma master admin
    function onlyOwnerOrHumaMasterAdmin(address account) public view {
        if (account != owner() && account != humaConfig.owner()) {
            revert Errors.permissionDeniedNotAdmin();
        }
    }

    function onlyOwnerOrEA(address account) public view {
        if (!isOwnerOrEA(account)) revert Errors.permissionDeniedNotAdmin();
    }

    function checkLiquidityRequirementForPoolOwner(uint256 balance) public view {
        if (
            balance <
            (_poolConfig._liquidityCap * _poolConfig._liquidityRateInBpsByPoolOwner) / BPS_DIVIDER
        ) revert Errors.poolOwnerNotEnoughLiquidity();
    }

    function checkLiquidityRequirementForEA(uint256 balance) public view {
        if (
            balance <
            (_poolConfig._liquidityCap * _poolConfig._liquidityRateInBpsByEA) / BPS_DIVIDER
        ) revert Errors.evaluationAgentNotEnoughLiquidity();
    }

    function checkLiquidityRequirement() public view {
        checkLiquidityRequirementForPoolOwner(poolToken.withdrawableFundsOf(owner()));
        checkLiquidityRequirementForEA(poolToken.withdrawableFundsOf(evaluationAgent));
    }

    function onlyOwnerOrHumaMasterAdmin() internal view {
        onlyOwnerOrHumaMasterAdmin(msg.sender);
    }

    function isOwnerOrEA(address account) public view returns (bool) {
        return (account == owner() || account == evaluationAgent);
    }
}
