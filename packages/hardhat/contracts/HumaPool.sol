//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./interfaces/IHumaPoolAdmins.sol";
import "./interfaces/IHumaPoolLoanHelper.sol";
import "./interfaces/IHumaPoolLocker.sol";

import "./HumaLoan.sol";
import "./HumaPoolLocker.sol";
import "./HDT/HDT.sol";

import "hardhat/console.sol";

contract HumaPool is HDT, Ownable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    uint256 constant POWER18 = 10**18;

    // HumaPoolAdmins
    address private immutable humaPoolAdmins;

    // Liquidity holder proxy contract for this pool
    address private poolLocker;

    // todo (by RL) need to check whether it is more efficient to use a struct or 3 mappings.
    struct LenderInfo {
        uint256 amount;
        uint256 weightedDepositDate; // weighted average deposit date
        uint256 mostRecentLoanTimestamp;
    }
    // Tracks the amount of liquidity in poolTokens provided to this pool by an address
    mapping(address => LenderInfo) private lenderInfo;

    // Tracks currently issued loans from this pool
    // Maps from wallet to Loan
    mapping(address => address) public creditMapping;

    // The ERC20 token this pool manages
    IERC20 public immutable poolToken;
    uint256 private immutable poolTokenDecimals;

    // An optional utility contract that implements IHumaPoolLoanHelper,
    // for additional logic on top of the pool's borrow functionality
    address private humaPoolLoanHelper;
    bool private isHumaPoolLoanHelperApproved = false;

    // The maximum amount of poolTokens that this pool allows in a single loan
    uint256 maxLoanAmount;

    // The interest rate this pool charges for loans
    uint256 interestRateBasis;

    // The collateral basis percentage required from lenders
    uint256 collateralRequired;

    // Helper counter used to ensure every loan has a unique ID
    uint256 humaLoanUniqueIdCounter;

    enum PoolStatus {
        On,
        Off
    }
    PoolStatus public status = PoolStatus.Off;

    // How long after the last deposit that a lender needs to wait
    // before they can withdraw their capital
    uint256 loanWithdrawalLockoutPeriod = 2630000;

    event LiquidityDeposited(address by, uint256 principal);
    event LiquidityWithdrawn(address by, uint256 principal, uint256 netAmount);

    constructor(address _poolToken, address _humaPoolAdmins)
        HDT("Huma", "Huma", _poolToken)
    {
        poolToken = IERC20(_poolToken);
        poolTokenDecimals = ERC20(_poolToken).decimals();
        poolLocker = address(new HumaPoolLocker(address(this), _poolToken));
        humaPoolAdmins = _humaPoolAdmins;
    }

    // Allow for sensitive pool functions only to be called by
    // the pool owner and the huma master admin
    modifier onlyOwnerOrHumaMasterAdmin() {
        // TODO integrate humaconfig once its ready
        require(
            (msg.sender == owner() ||
                IHumaPoolAdmins(humaPoolAdmins).isMasterAdmin(msg.sender) == true),
            "HumaPool:PERMISSION_DENIED_NOT_ADMIN"
        );
        _;
    }

    modifier onlyHumaMasterAdmin() {
        // TODO integrate humaconfig once its ready
        require(
            IHumaPoolAdmins(humaPoolAdmins).isMasterAdmin(msg.sender) == true,
            "HumaPool:PERMISSION_DENIED_NOT_MASTER_ADMIN"
        );
        _;
    }

    // In order for a pool to issue new loans, it must be turned on by an admin
    // and its custom loan helper must be approved by the Huma team
    modifier poolOn() {
        require(status == PoolStatus.On, "HumaPool:POOL_NOT_ON");
        require(
            humaPoolLoanHelper == address(0) || isHumaPoolLoanHelperApproved == true,
            "HumaPool:POOL_LOAN_HELPER_NOT_APPROVED"
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
    function deposit(uint256 amount) external poolOn returns (bool) {
        // todo (by RL) Need to check if the pool is open to msg.sender to deposit
        // todo (by RL) Need to add maximal pool size support and check if it has reached the size

        uint256 amtInPower18 = _toPower18(amount);

        // Update weighted deposit date:
        // prevDate + (now - prevDate) * (amount / (balance + amount))
        // NOTE: prevDate = 0 implies balance = 0, and equation reduces to now
        uint256 prevDate = lenderInfo[msg.sender].weightedDepositDate;
        uint256 balance = lenderInfo[msg.sender].amount;
        uint256 newDate = (balance + amount) > 0
            ? prevDate.add(
                block.timestamp.sub(prevDate).mul(amount).div(balance + amount)
            )
            : prevDate;

        lenderInfo[msg.sender].weightedDepositDate = newDate;
        lenderInfo[msg.sender].amount += amount;
        lenderInfo[msg.sender].mostRecentLoanTimestamp = block.timestamp;

        poolToken.safeTransferFrom(msg.sender, poolLocker, amount);

        // Mint HDT for the LP to claim future income and losses
        _mint(msg.sender, amtInPower18);

        emit LiquidityDeposited(msg.sender, amount);

        return true;
    }

    /**
     * @notice Withdraw principal that was deposited into the pool before in the unit of `poolTokens`
     * @dev Withdrawals are not allowed when 1) the pool withdraw is paused or
     *      2) the LP has not reached lockout period since their last depisit
     *      3) the requested amount is higher than the LP's remaining principal
     * @dev the `amount` is principal amount. It does not include interest or losses accrued. The amount
     *      withdrawn will be the `amount` plus associated interest and losses.
     */
    function withdraw(uint256 amount) public returns (bool) {
        // todo(by RL) require the pool has not paused withdraw
        require(
            amount <= lenderInfo[msg.sender].amount,
            "HumaPool:WITHDRAW_AMT_TOO_GREAT"
        );
        require(
            block.timestamp >=
                lenderInfo[msg.sender].mostRecentLoanTimestamp +
                    loanWithdrawalLockoutPeriod,
            "HumaPool:WITHDRAW_TOO_SOON"
        );

        uint256 amtInPower18 = _toPower18(amount);

        lenderInfo[msg.sender].amount -= amount;

        // Calculate the amount that msg.sender can actually withdraw.
        // withdrawableFundsOf(...) returns everything that msg.sender can claim in terms of
        // number of poolToken, incl. principal,income and losses.
        // then get the portion that msg.sender wants to withdraw (amount / total principal)
        uint256 amountToWithdraw = withdrawableFundsOf(msg.sender).mul(amount).div(
            balanceOf(msg.sender)
        );

        _burn(msg.sender, amtInPower18);

        IHumaPoolLocker(poolLocker).transfer(msg.sender, amountToWithdraw);

        emit LiquidityWithdrawn(msg.sender, amount, amountToWithdraw);

        return true;
    }

    /**
     * @notice Withdraw all balance from the pool.
     */
    function withdrawAll() external returns (bool) {
        return withdraw(lenderInfo[msg.sender].amount);
    }

    //********************************************/
    //         Borrower Functions                //
    //********************************************/
    // Apply to borrow from the pool. Borrowing is subject to interest,
    // collateral, and maximum loan requirements as dictated by the pool
    function borrow(
        uint256 _borrowAmount,
        uint256 _paybackInterval,
        uint256 _paybackPerInterval
    ) external poolOn returns (bool) {
        // Borrowers must not have existing loans from this pool
        require(
            creditMapping[msg.sender] == address(0),
            "HumaPool:DENY_BORROW_EXISTING_LOAN"
        );
        // TODO: check token allowance for pool collector

        // TODO: set a threshold of minimum liquidity we want the pool to maintain for withdrawals

        // TODO: Check huma API here
        require(
            maxLoanAmount >= _borrowAmount,
            "HumaPool:DENY_BORROW_GREATER_THAN_LIMIT"
        );

        // Check custom borrowing logic in the loan helper of this pool
        // TODO add test for this
        if (humaPoolLoanHelper != address(0)) {
            require(
                IHumaPoolLoanHelper(humaPoolLoanHelper).evaluateBorrowRequest(
                    msg.sender,
                    _borrowAmount
                ),
                "HumaPool:BORROW_DENIED_POOL_LOAN_HELPER"
            );
        }

        creditMapping[msg.sender] = address(
            new HumaLoan(
                HumaLoan.InitialValues({
                    amount: _borrowAmount,
                    paybackPerInterval: _paybackPerInterval,
                    paybackInterval: _paybackInterval,
                    interestRateBasis: interestRateBasis,
                    pool: address(this)
                })
            )
        );

        IHumaPoolLocker(poolLocker).transfer(msg.sender, _borrowAmount);

        // Run custom post-borrowing logic in the loan helper of this pool
        if (humaPoolLoanHelper != address(0)) {
            IHumaPoolLoanHelper(humaPoolLoanHelper).postBorrowRequest(
                msg.sender,
                _borrowAmount
            );
        }

        return true;
    }

    // Attempt to make a partial payback on a loan if its conditions are met:
    // - amountPaidBack must be less than amount
    // - Time passed since lastPaymentTimestamp must equal or exceed paybackInterval
    // TODO: Add manual payback function
    function makeIntervalPayback(address _borrower)
        external
        returns (bool _success)
    {
        (
            uint256 _amount,
            uint256 _amountPaidBack,
            uint256 _issuedTimestamp,
            uint256 _lastPaymentTimestamp,
            uint256 _paybackPerInterval,
            uint256 _paybackInterval,
            uint256 _interestRateBasis
        ) = HumaLoan(creditMapping[_borrower]).getLoanInformation();

        require(
            _amountPaidBack < (_amount + (_amount * _interestRateBasis) / 100),
            "HumaPool:MAKE_INTERVAL_PAYBACK_AMT_EXCEEDED"
        );
        require(
            (block.timestamp - _lastPaymentTimestamp >= _paybackInterval) &&
                (block.timestamp - _issuedTimestamp >= _paybackInterval),
            "HumaPool:MAKE_INTERVAL_PAYBACK_TOO_EARLY"
        );

        // TODO @richard calculate interest rate distribution among lenders here?
        poolToken.safeTransferFrom(msg.sender, poolLocker, _paybackPerInterval);

        HumaLoan(creditMapping[_borrower]).markPayment(_paybackPerInterval);

        return true;
    }

    /********************************************/
    //                Settings                  //
    /********************************************/

    function setMaxLoanAmount(uint256 _maxLoanAmount)
        external
        onlyOwnerOrHumaMasterAdmin
        returns (bool)
    {
        require(_maxLoanAmount > 0);
        maxLoanAmount = _maxLoanAmount;

        return true;
    }

    function setInterestRateBasis(uint256 _interestRateBasis)
        external
        onlyOwnerOrHumaMasterAdmin
        returns (bool)
    {
        require(_interestRateBasis >= 0);
        interestRateBasis = _interestRateBasis;

        return true;
    }

    function setCollateralRequired(uint256 _collateralRequired)
        external
        onlyOwnerOrHumaMasterAdmin
        returns (bool)
    {
        require(_collateralRequired >= 0);
        collateralRequired = _collateralRequired;

        return true;
    }

    function setHumaPoolLoanHelper(address _humaPoolLoanHelper)
        external
        onlyOwnerOrHumaMasterAdmin
    {
        humaPoolLoanHelper = _humaPoolLoanHelper;
        // New loan helpers must be reviewed and approved by the Huma team.
        isHumaPoolLoanHelperApproved = false;
    }

    function setHumaPoolLoanHelperApprovalStatus(bool _approvalStatus)
        external
        onlyHumaMasterAdmin
    {
        isHumaPoolLoanHelperApproved = _approvalStatus;
    }

    // Allow borrow applications and loans to be processed by this pool.
    function enablePool() external onlyOwnerOrHumaMasterAdmin {
        status = PoolStatus.On;
    }

    // Reject all future borrow applications and loans. Note that existing
    // loans will still be processed as expected.
    function disablePool() external onlyOwnerOrHumaMasterAdmin {
        status = PoolStatus.Off;
    }

    function getLoanWithdrawalLockoutPeriod() public view returns (uint256) {
        return loanWithdrawalLockoutPeriod;
    }

    function setLoanWithdrawalLockoutPeriod(uint256 _loanWithdrawalLockoutPeriod)
        external
        onlyOwnerOrHumaMasterAdmin
    {
        loanWithdrawalLockoutPeriod = _loanWithdrawalLockoutPeriod;
    }

    function getLenderInfo(address _lender)
        public
        view
        returns (LenderInfo memory)
    {
        return lenderInfo[_lender];
    }

    function getPoolLiquidity() public view returns (uint256) {
        return poolToken.balanceOf(poolLocker);
    }

    function _toPower18(uint256 amt) internal view returns (uint256) {
        return amt.mul(POWER18).div(10**poolTokenDecimals);
    }

    // Function to receive Ether. msg.data must be empty
    receive() external payable {}

    // Fallback function is called when msg.data is not empty
    fallback() external payable {}

    function getBalance() public view returns (uint256) {
        return address(this).balance;
    }
}
