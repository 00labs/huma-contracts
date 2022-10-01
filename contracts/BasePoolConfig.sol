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
        uint256 _protocolIncomeWithdrawn;
        uint256 _poolOwnerIncome;
        uint256 _poolOwnerIncomeWithdrawn;
        uint256 _eaIncome;
        uint256 _eaIncomeWithdrawn;
    }

    uint256 private constant HUNDRED_PERCENT_IN_BPS = 10000;
    uint256 private constant SECONDS_IN_A_DAY = 86400;
    uint256 private constant SECONDS_IN_180_DAYS = 15552000;

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

    event PoolNameChanged(string name, address by);
    event PoolChanged(address pool, address by);
    event HumaConfigChanged(address humaConfig, address by);
    event FeeManagerChanged(address feeManager, address by);
    event HDTChanged(address hdt, address udnerlyingToken, address by);
    event EvaluationAgentChanged(address oldEA, address newEA, uint256 newEAId, address by);
    event APRChanged(uint256 aprInBps, address by);
    event ReceivableRequiredInBpsChanged(uint256 receivableInBps, address by);
    event MaxCreditLineChanged(uint256 maxCreditLine, address by);
    event PoolDefaultGracePeriodChanged(uint256 gracePeriodInDays, address by);
    event PoolPayPeriodChanged(uint256 periodInDays, address by);
    event WithdrawalLockoutPeriodChanged(uint256 lockoutPeriodInDays, address by);
    event PoolLiquidityCapChanged(uint256 liquidityCap, address by);
    event PoolOwnerRewardsAndLiquidityChanged(
        uint256 rewardsRate,
        uint256 liquidityRate,
        address indexed by
    );
    event EARewardsAndLiquidityChanged(
        uint256 rewardsRate,
        uint256 liquidityRate,
        address indexed by
    );
    event CreditApprovalExpirationChanged(uint256 durationInSeconds, address by);

    event EvaluationAgentRewardsWithdrawn(address receiver, uint256 amount, address by);
    event ProtocolRewardsWithdrawn(address receiver, uint256 amount, address by);
    event PoolRewardsWithdrawn(address receiver, uint256 amount, address by);

    event IncomeDistributed(
        uint256 protocolFee,
        uint256 ownerIncome,
        uint256 eaIncome,
        uint256 poolIncome
    );

    event IncomeReversed(
        uint256 protocolFee,
        uint256 ownerIncome,
        uint256 eaIncome,
        uint256 poolIncome
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
        _onlyOwnerOrHumaMasterAdmin();
        poolName = newName;
        emit PoolNameChanged(newName, msg.sender);
    }

    function setPool(address _pool) external {
        _onlyOwnerOrHumaMasterAdmin();
        pool = _pool;
        emit PoolChanged(_pool, msg.sender);
    }

    function setHumaConfig(address _humaConfig) external {
        _onlyOwnerOrHumaMasterAdmin();
        humaConfig = HumaConfig(_humaConfig);
        emit HumaConfigChanged(_humaConfig, msg.sender);
    }

    function setFeeManager(address _feeManager) external {
        _onlyOwnerOrHumaMasterAdmin();
        feeManager = _feeManager;
        emit FeeManagerChanged(_feeManager, msg.sender);
    }

    function setPoolToken(address _poolToken) external {
        _onlyOwnerOrHumaMasterAdmin();
        poolToken = HDT(_poolToken);
        address assetToken = poolToken.assetToken();
        underlyingToken = IERC20(poolToken.assetToken());
        emit HDTChanged(_poolToken, assetToken, msg.sender);
    }

    /**
     * @notice Adds an evaluation agent to the list who can approve loans.
     * @param agent the evaluation agent to be added
     */
    function setEvaluationAgent(uint256 eaId, address agent) external override {
        if (agent == address(0)) revert Errors.zeroAddressProvided();
        _onlyOwnerOrHumaMasterAdmin();

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
            uint256 rewardsToPayout = _accuredIncome._eaIncome - _accuredIncome._eaIncomeWithdrawn;
            if (rewardsToPayout > 0) {
                _withdrawEAFee(msg.sender, oldEA, rewardsToPayout);
            }
        }

        evaluationAgent = agent;
        evaluationAgentId = eaId;
        emit EvaluationAgentChanged(oldEA, agent, eaId, msg.sender);
    }

    /**
     * @notice change the default APR for the pool
     * @param aprInBps APR in basis points, use 500 for 5%
     */
    function setAPR(uint256 aprInBps) external {
        _onlyOwnerOrHumaMasterAdmin();
        if (aprInBps > HUNDRED_PERCENT_IN_BPS) revert Errors.invalidBasisPointHigherThan10000();
        _poolConfig._poolAprInBps = aprInBps;
        emit APRChanged(aprInBps, msg.sender);
    }

    /**
     * @notice Set the receivable rate in terms of basis points.
     * When the rate is higher than 10000, it means the backing is higher than the borrow amount,
     * similar to an over-collateral situation.
     * @param receivableInBps the percentage. A percentage over 10000 means overreceivableization.
     */
    function setReceivableRequiredInBps(uint256 receivableInBps) external {
        _onlyOwnerOrHumaMasterAdmin();
        // note: this rate can be over 10000 when it requires more backing than the credit limit
        _poolConfig._receivableRequiredInBps = receivableInBps;
        emit ReceivableRequiredInBpsChanged(receivableInBps, msg.sender);
    }

    /**
     * @notice Sets the min and max of each loan/credit allowed by the pool.
     * @param creditLine the max amount of a credit line
     */
    function setMaxCreditLine(uint256 creditLine) external {
        _onlyOwnerOrHumaMasterAdmin();
        if (creditLine == 0) revert Errors.zeroAmountProvided();
        _poolConfig._maxCreditLine = creditLine;
        emit MaxCreditLineChanged(creditLine, msg.sender);
    }

    /**
     * Sets the default grace period for this pool.
     * @param gracePeriodInDays the desired grace period in days.
     */
    function setPoolDefaultGracePeriod(uint256 gracePeriodInDays) external {
        _onlyOwnerOrHumaMasterAdmin();
        _poolConfig._poolDefaultGracePeriodInSeconds = gracePeriodInDays * SECONDS_IN_A_DAY;
        emit PoolDefaultGracePeriodChanged(gracePeriodInDays, msg.sender);
    }

    function setPoolPayPeriod(uint256 periodInDays) external {
        _onlyOwnerOrHumaMasterAdmin();
        _poolConfig._payPeriodInDays = periodInDays;
        emit PoolPayPeriodChanged(periodInDays, msg.sender);
    }

    /**
     * Sets withdrawal lockout period after the lender makes the last deposit
     * @param lockoutPeriodInDays the lockout period in terms of days
     */
    function setWithdrawalLockoutPeriod(uint256 lockoutPeriodInDays) external {
        _onlyOwnerOrHumaMasterAdmin();
        _poolConfig._withdrawalLockoutPeriodInSeconds = lockoutPeriodInDays * SECONDS_IN_A_DAY;
        emit WithdrawalLockoutPeriodChanged(lockoutPeriodInDays, msg.sender);
    }

    /**
     * @notice Sets the cap of the pool liquidity.
     * @param liquidityCap the upper bound that the pool accepts liquidity from the depositers
     */
    function setPoolLiquidityCap(uint256 liquidityCap) external {
        _onlyOwnerOrHumaMasterAdmin();
        _poolConfig._liquidityCap = liquidityCap;
        emit PoolLiquidityCapChanged(liquidityCap, msg.sender);
    }

    function setPoolOwnerRewardsAndLiquidity(uint256 rewardsRate, uint256 liquidityRate) external {
        _onlyOwnerOrHumaMasterAdmin();
        _poolConfig._rewardRateInBpsForPoolOwner = rewardsRate;
        _poolConfig._liquidityRateInBpsByPoolOwner = liquidityRate;
        emit PoolOwnerRewardsAndLiquidityChanged(rewardsRate, liquidityRate, msg.sender);
    }

    function setEARewardsAndLiquidity(uint256 rewardsRate, uint256 liquidityRate) external {
        _onlyOwnerOrHumaMasterAdmin();
        _poolConfig._rewardRateInBpsForEA = rewardsRate;
        _poolConfig._liquidityRateInBpsByEA = liquidityRate;
        emit EARewardsAndLiquidityChanged(rewardsRate, liquidityRate, msg.sender);
    }

    function setCreditApprovalExpiration(uint256 durationInDays) external {
        _onlyOwnerOrHumaMasterAdmin();
        _poolConfig._creditApprovalExpirationInSeconds = durationInDays * SECONDS_IN_A_DAY;
        emit CreditApprovalExpirationChanged(durationInDays * SECONDS_IN_A_DAY, msg.sender);
    }

    function distributeIncome(uint256 value) external returns (uint256 poolIncome) {
        if (msg.sender != pool) {
            revert Errors.callNotFromPool();
        }

        uint256 protocolFee = (uint256(humaConfig.protocolFee()) * value) / HUNDRED_PERCENT_IN_BPS;
        _accuredIncome._protocolIncome += protocolFee;

        uint256 valueForPool = value - protocolFee;

        uint256 ownerIncome = (valueForPool * _poolConfig._rewardRateInBpsForPoolOwner) /
            HUNDRED_PERCENT_IN_BPS;
        _accuredIncome._poolOwnerIncome += ownerIncome;

        uint256 eaIncome = (valueForPool * _poolConfig._rewardRateInBpsForEA) /
            HUNDRED_PERCENT_IN_BPS;
        _accuredIncome._eaIncome += eaIncome;

        poolIncome = (valueForPool - ownerIncome - eaIncome);

        emit IncomeDistributed(protocolFee, ownerIncome, eaIncome, poolIncome);
    }

    function reverseIncome(uint256 value) external returns (uint256 poolIncome) {
        if (msg.sender != pool) {
            revert Errors.callNotFromPool();
        }

        uint256 protocolFee = (uint256(humaConfig.protocolFee()) * value) / HUNDRED_PERCENT_IN_BPS;
        _accuredIncome._protocolIncome -= protocolFee;

        uint256 valueForPool = value - protocolFee;

        uint256 ownerIncome = (valueForPool * _poolConfig._rewardRateInBpsForPoolOwner) /
            HUNDRED_PERCENT_IN_BPS;
        _accuredIncome._poolOwnerIncome -= ownerIncome;

        uint256 eaIncome = (valueForPool * _poolConfig._rewardRateInBpsForEA) /
            HUNDRED_PERCENT_IN_BPS;
        _accuredIncome._eaIncome -= eaIncome;

        poolIncome = (valueForPool - ownerIncome - eaIncome);

        emit IncomeReversed(protocolFee, ownerIncome, eaIncome, poolIncome);
    }

    function withdrawEAFee(uint256 amount) external {
        address ea = evaluationAgent;
        if (msg.sender != ea) revert Errors.notEvaluationAgent();
        if (amount + _accuredIncome._eaIncomeWithdrawn > _accuredIncome._eaIncome)
            revert Errors.withdrawnAmountHigherThanBalance();
        _withdrawEAFee(ea, ea, amount);
    }

    function _withdrawEAFee(
        address caller,
        address receiver,
        uint256 amount
    ) internal {
        _accuredIncome._eaIncomeWithdrawn += amount;
        underlyingToken.safeTransferFrom(pool, receiver, amount);

        emit EvaluationAgentRewardsWithdrawn(receiver, amount, caller);
    }

    function withdrawProtocolFee(uint256 amount) external {
        if (msg.sender != humaConfig.owner()) revert Errors.notProtocolOwner();
        if (amount + _accuredIncome._protocolIncomeWithdrawn > _accuredIncome._protocolIncome)
            revert Errors.withdrawnAmountHigherThanBalance();
        _accuredIncome._protocolIncomeWithdrawn += amount;
        address treasuryAddress = humaConfig.humaTreasury();
        if (treasuryAddress != address(0)) {
            underlyingToken.safeTransferFrom(pool, treasuryAddress, amount);
            emit ProtocolRewardsWithdrawn(treasuryAddress, amount, msg.sender);
        }
    }

    function withdrawPoolOwnerFee(uint256 amount) external {
        address poolOwner = owner();
        if (msg.sender != poolOwner) revert Errors.notPoolOwner();
        if (amount + _accuredIncome._poolOwnerIncomeWithdrawn > _accuredIncome._poolOwnerIncome)
            revert Errors.withdrawnAmountHigherThanBalance();
        _accuredIncome._poolOwnerIncomeWithdrawn += amount;
        underlyingToken.safeTransferFrom(pool, poolOwner, amount);
        emit PoolRewardsWithdrawn(poolOwner, amount, msg.sender);
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
            uint256 eaIncome,
            uint256 protocolIncomeWithdrawn,
            uint256 poolOwnerIncomeWithdrawn,
            uint256 eaIncomeWithdrawn
        )
    {
        return (
            _accuredIncome._protocolIncome,
            _accuredIncome._poolOwnerIncome,
            _accuredIncome._eaIncome,
            _accuredIncome._protocolIncomeWithdrawn,
            _accuredIncome._poolOwnerIncomeWithdrawn,
            _accuredIncome._eaIncomeWithdrawn
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
            (_poolConfig._liquidityCap * _poolConfig._liquidityRateInBpsByPoolOwner) /
                HUNDRED_PERCENT_IN_BPS
        ) revert Errors.poolOwnerNotEnoughLiquidity();
    }

    function checkLiquidityRequirementForEA(uint256 balance) public view {
        if (
            balance <
            (_poolConfig._liquidityCap * _poolConfig._liquidityRateInBpsByEA) /
                HUNDRED_PERCENT_IN_BPS
        ) revert Errors.evaluationAgentNotEnoughLiquidity();
    }

    function checkLiquidityRequirement() public view {
        checkLiquidityRequirementForPoolOwner(poolToken.withdrawableFundsOf(owner()));
        checkLiquidityRequirementForEA(poolToken.withdrawableFundsOf(evaluationAgent));
    }

    function isOwnerOrEA(address account) public view returns (bool) {
        return (account == owner() || account == evaluationAgent);
    }

    function _onlyOwnerOrHumaMasterAdmin() internal view {
        onlyOwnerOrHumaMasterAdmin(msg.sender);
    }
}
