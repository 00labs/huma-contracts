//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import "./BasePoolStorage.sol";

import "./interfaces/ILiquidityProvider.sol";
import "./interfaces/IPool.sol";

import "./HumaConfig.sol";
import "./EvaluationAgentNFT.sol";

import "hardhat/console.sol";

abstract contract BasePool is BasePoolStorage, OwnableUpgradeable, ILiquidityProvider, IPool {
    using SafeERC20 for IERC20;

    error notEvaluationAgentOwnerProvided();

    event LiquidityDeposited(address indexed account, uint256 assetAmount, uint256 shareAmount);
    event LiquidityWithdrawn(address indexed account, uint256 assetAmount, uint256 shareAmount);
    event PoolInitialized(address _poolAddress);

    event EvaluationAgentChanged(address oldEA, address newEA, address by);
    event AddApprovedLender(address lender, address by);
    event RemoveApprovedLender(address lender, address by);
    event PoolNameChanged(string newName, address by);
    event PoolDisabled(address by);
    event PoolEnabled(address by);
    event PoolDefaultGracePeriodChanged(uint256 _gracePeriodInDays, address by);
    event WithdrawalLockoutPeriodUpdated(uint256 _lockoutPeriodInDays, address by);
    event PoolLiquidityCapChanged(uint256 _liquidityCap, address by);
    event APRUpdated(uint256 _aprInBps);
    event PoolPayPeriodChanged(uint256 periodInDays, address by);
    event CreditApprovalExpirationChanged(uint256 durationInSeconds, address by);
    event EvaluationAgentRewardsWithdrawn(uint256 amount, address receiver, address by);

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

        _poolConfig._withdrawalLockoutPeriodInSeconds = SECONDS_IN_180_DAYS; // todo need to make this configurable
        _poolConfig._poolDefaultGracePeriodInSeconds = HumaConfig(humaConfig)
            .protocolDefaultGracePeriodInSeconds();
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
        onlyOwnerOrEA();
        return _deposit(msg.sender, amount);
    }

    function _deposit(address lender, uint256 amount) internal {
        require(amount > 0, "AMOUNT_IS_ZERO");
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
        require(amount > 0, "AMOUNT_IS_ZERO");

        require(
            block.timestamp >=
                _lastDepositTime[msg.sender] + _poolConfig._withdrawalLockoutPeriodInSeconds,
            "WITHDRAW_TOO_SOON"
        );
        uint256 withdrawableAmount = _poolToken.withdrawableFundsOf(msg.sender);
        require(amount <= withdrawableAmount, "WITHDRAW_AMT_TOO_GREAT");

        // Todo If msg.sender is pool owner or EA, make sure they have enough reserve in the pool

        uint256 shares = _poolToken.burnAmount(msg.sender, amount);
        _totalPoolValue -= amount;
        _underlyingToken.safeTransfer(msg.sender, amount);

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
        uint256 protocolFee = (uint256(HumaConfig(_humaConfig).protocolFee()) * value) / 10000;
        _accuredIncome._protocolIncome += protocolFee;

        uint256 valueForPool = value - protocolFee;

        uint256 ownerIncome = (valueForPool * _poolConfig._rewardRateInBpsForPoolOwner) /
            BPS_DIVIDER;
        _accuredIncome._poolOwnerIncome += ownerIncome;

        uint256 eaIncome = (valueForPool * _poolConfig._rewardRateInBpsForEA) / BPS_DIVIDER;
        _accuredIncome._eaIncome += eaIncome;

        _totalPoolValue += (valueForPool - ownerIncome - eaIncome);
    }

    /**
     * @notice Distributes losses associated with the token
     * @dev Technically, we can combine distributeIncome() and distributeLossees() by making
     * the parameter to int256, however, we decided to use separate APIs to improve readability
     * and reduce errors.
     * @param value the amount of losses to be distributed
     */
    function distributeLosses(uint256 value) internal virtual {
        // todo in extreme cases
        if (_totalPoolValue > value) _totalPoolValue -= value;
        else _totalPoolValue = 0;
    }

    function withdrawProtocolFee(uint256 amount) external virtual {
        require(msg.sender == HumaConfig(_humaConfig).owner(), "NOT_PROTOCOL_OWNER");
        require(amount <= _accuredIncome._protocolIncome, "WITHDRAWAL_AMOUNT_TOO_HIGH");
        address treasuryAddress = HumaConfig(_humaConfig).humaTreasury();
        _underlyingToken.safeTransfer(treasuryAddress, amount);
    }

    function withdrawPoolOwnerFee(uint256 amount) external virtual {
        require(msg.sender == this.owner(), "NOT_POOL_OWNER");
        require(amount <= _accuredIncome._poolOwnerIncome, "WITHDRAWAL_AMOUNT_TOO_HIGH");
        _underlyingToken.safeTransfer(this.owner(), amount);
    }

    function withdrawEAFee(uint256 amount) external virtual {
        require(msg.sender == _evaluationAgent, "NOT_POOL_OWNER");
        require(amount <= _accuredIncome._eaIncome, "WITHDRAWAL_AMOUNT_TOO_HIGH");
        _underlyingToken.safeTransfer(_evaluationAgent, amount);
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

    function addApprovedLender(address lender) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        approvedLenders[lender] = true;
        emit AddApprovedLender(lender, msg.sender);
    }

    function removeApprovedLender(address lender) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        approvedLenders[lender] = false;
        emit RemoveApprovedLender(lender, msg.sender);
    }

    /**
     * @notice change the default APR for the pool
     * @param aprInBps APR in basis points, use 500 for 5%
     */
    function setAPR(uint256 aprInBps) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        require(aprInBps <= 10000, "INVALID_APR");
        _poolConfig._poolAprInBps = aprInBps;
        emit APRUpdated(aprInBps);
    }

    /**
     * @notice Set the receivable rate in terms of basis points.
     * @param receivableInBps the percentage. A percentage over 10000 means overreceivableization.
     */
    function setReceivableRequiredInBps(uint256 receivableInBps) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        require(receivableInBps <= 10000, "INVALID_COLLATERAL_IN_BPS");
        _poolConfig._receivableRequiredInBps = receivableInBps;
    }

    /**
     * @notice Sets the min and max of each loan/credit allowed by the pool.
     * @param maxCreditLine the max amount of a credit line
     */
    function setMaxCreditLine(uint256 maxCreditLine) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        require(maxCreditLine > 0, "MAX_IS_ZERO");
        _poolConfig._maxCreditLine = maxCreditLine;
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

        require(
            IERC20(address(_poolToken)).balanceOf(owner()) >=
                (_poolConfig._liquidityCap * _poolConfig._liquidityRateInBpsByPoolOwner) /
                    BPS_DIVIDER,
            "POOL_OWNER_NOT_ENOUGH_LIQUIDITY"
        );
        require(
            IERC20(address(_poolToken)).balanceOf(_evaluationAgent) >=
                (_poolConfig._liquidityCap * _poolConfig._liquidityRateInBpsByEA) / BPS_DIVIDER,
            "POOL_OWNER_NOT_ENOUGH_LIQUIDITY"
        );

        // Todo make sure pool owner has contributed the required liquidity to the pool.
        _status = PoolStatus.On;
        emit PoolEnabled(msg.sender);
    }

    /**
     * Sets the default grace period for this pool.
     * @param gracePeriodInDays the desired grace period in days.
     */
    function setPoolDefaultGracePeriod(uint256 gracePeriodInDays) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig._poolDefaultGracePeriodInSeconds = gracePeriodInDays * SECONDS_IN_A_DAY;
        emit PoolDefaultGracePeriodChanged(gracePeriodInDays, msg.sender);
    }

    function setPoolPayPeriod(uint256 periodInDays) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig._payPeriodInDays = periodInDays;
        emit PoolPayPeriodChanged(periodInDays, msg.sender);
    }

    /**
     * Sets withdrawal lockout period after the lender makes the last deposit
     * @param lockoutPeriodInDays the lockout period in terms of days
     */
    function setWithdrawalLockoutPeriod(uint256 lockoutPeriodInDays) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig._withdrawalLockoutPeriodInSeconds = lockoutPeriodInDays * SECONDS_IN_A_DAY;
        emit WithdrawalLockoutPeriodUpdated(lockoutPeriodInDays, msg.sender);
    }

    /**
     * @notice Sets the cap of the pool liquidity.
     * @param liquidityCap the upper bound that the pool accepts liquidity from the depositers
     */
    function setPoolLiquidityCap(uint256 liquidityCap) external virtual override {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig._liquidityCap = liquidityCap;
        emit PoolLiquidityCapChanged(liquidityCap, msg.sender);
    }

    function setPoolOwnerRewardsAndLiquidity(uint256 rewardsRate, uint256 liquidityRate)
        external
        virtual
        override
    {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig._rewardRateInBpsForPoolOwner = rewardsRate;
        _poolConfig._liquidityRateInBpsByPoolOwner = liquidityRate;
        emit PoolOwnerCommisionAndLiquidityChanged(rewardsRate, liquidityRate, msg.sender);
    }

    function setEARewardsAndLiquidity(uint256 rewardsRate, uint256 liquidityRate)
        external
        virtual
        override
    {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig._rewardRateInBpsForEA = rewardsRate;
        _poolConfig._liquidityRateInBpsByEA = liquidityRate;
        emit EACommisionAndLiquidityChanged(rewardsRate, liquidityRate, msg.sender);
    }

    function setCreditApprovalExpiration(uint256 durationInDays) external virtual {
        onlyOwnerOrHumaMasterAdmin();
        _poolConfig._creditApprovalExpirationInSeconds = durationInDays * SECONDS_IN_A_DAY;
        emit CreditApprovalExpirationChanged(durationInDays * SECONDS_IN_A_DAY, msg.sender);
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
        virtual
        override
        returns (
            address token,
            uint256 apr,
            uint256 payPeriod,
            uint256 maxCreditAmount,
            uint256 liquiditycap,
            string memory name,
            string memory symbol,
            uint8 decimals,
            uint256 evaluationAgentId
        )
    {
        IERC20Metadata erc20Contract = IERC20Metadata(address(_poolToken));
        return (
            address(_underlyingToken),
            _poolConfig._poolAprInBps,
            _poolConfig._payPeriodInDays,
            _poolConfig._maxCreditLine,
            _poolConfig._liquidityCap,
            erc20Contract.name(),
            erc20Contract.symbol(),
            erc20Contract.decimals(),
            _evaluationAgentId
        );
    }

    function totalPoolValue() external view override returns (uint256) {
        return _totalPoolValue;
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

    function rewardsAndLiquidityRateForEA() external view returns (uint256, uint256) {
        return (_poolConfig._rewardRateInBpsForEA, _poolConfig._liquidityRateInBpsByEA);
    }

    function rewardsAndLiquidityRateForPoolOwner() external view returns (uint256, uint256) {
        return (
            _poolConfig._rewardRateInBpsForPoolOwner,
            _poolConfig._liquidityRateInBpsByPoolOwner
        );
    }

    function getFeeManager() external view returns (address) {
        return _feeManagerAddress;
    }

    function creditApprovalExpiration() external view returns (uint256) {
        return _poolConfig._creditApprovalExpirationInSeconds;
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

    function payPeriodInDays() external view returns (uint256) {
        return _poolConfig._payPeriodInDays;
    }

    // Allow for sensitive pool functions only to be called by
    // the pool owner and the huma master admin
    function onlyOwnerOrHumaMasterAdmin() internal view {
        require(
            (msg.sender == owner() || msg.sender == HumaConfig(_humaConfig).owner()),
            "PERMISSION_DENIED_NOT_ADMIN"
        );
    }

    function onlyOwnerOrEA() internal view {
        require(
            (msg.sender == owner() || msg.sender == _evaluationAgent),
            "PERMISSION_DENIED_NOT_ADMIN"
        );
    }

    function onlyApprovedLender(address lender) internal view {
        require((approvedLenders[lender] == true), "PERMISSION_DENIED_NOT_LENDER");
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
