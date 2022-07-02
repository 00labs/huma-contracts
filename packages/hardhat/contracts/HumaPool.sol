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

contract HumaPool is Ownable {
  using SafeERC20 for IERC20;

  // HumaPoolAdmins
  address private immutable humaPoolAdmins;

  // Liquidity holder proxy contract for this pool
  address private poolLocker;

  struct LenderInfo {
    uint256 amount;
    uint256 mostRecentLoanTimestamp;
  }
  // Tracks the amount of liquidity in poolTokens provided to this pool by an address
  mapping(address => LenderInfo) private lenderInfo;

  // Tracks currently issued loans from this pool
  // Maps from wallet to Loan
  mapping(address => address) public creditMapping;

  /********************************************/
  //                Settings                  //
  /********************************************/

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

  enum PoolStatus {
    On,
    Off
  }
  PoolStatus public status = PoolStatus.Off;

  // How long after the last deposit that a lender needs to wait
  // before they can withdraw their capital
  uint256 loanWithdrawalLockoutPeriod = 2630000;

  constructor(address _poolToken, address _humaPoolAdmins) {
    poolToken = IERC20(_poolToken);
    poolTokenDecimals = ERC20(_poolToken).decimals();
    poolLocker = address(new HumaPoolLocker(address(this), _poolToken));
    humaPoolAdmins = _humaPoolAdmins;
  }

  // Allow for sensitive pool functions only to be called by
  // the pool owner and the huma master admin
  modifier onlyOwnerOrHumaMasterAdmin() {
    require(
      (msg.sender == owner() ||
        IHumaPoolAdmins(humaPoolAdmins).isMasterAdmin(msg.sender) == true),
      "HumaPool:PERMISSION_DENIED_NOT_ADMIN"
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

  // TODO: Add function to approve pool loan helper (only callable by huma)

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

  // Deposit liquidityAmount of poolTokens to the pool to lend and earn interest on
  function deposit(uint256 liquidityAmount) external poolOn returns (bool) {
    lenderInfo[msg.sender].amount += liquidityAmount;
    lenderInfo[msg.sender].mostRecentLoanTimestamp = block.timestamp;
    poolToken.safeTransferFrom(msg.sender, poolLocker, liquidityAmount);

    return true;
  }

  // Withdraw amount of poolTokens to the pool that was previously deposited
  // Note that withdrawals are limited based on a lockout period of when the
  // last deposit was made.
  function withdraw(uint256 amount) external returns (bool) {
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
    // TODO allow withdrawal of past loans that passed lockout period

    lenderInfo[msg.sender].amount -= amount;
    IHumaPoolLocker(poolLocker).transfer(msg.sender, amount);

    return true;
  }

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

  // Function to receive Ether. msg.data must be empty
  receive() external payable {}

  // Fallback function is called when msg.data is not empty
  fallback() external payable {}

  function getBalance() public view returns (uint256) {
    return address(this).balance;
  }
}
