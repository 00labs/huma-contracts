//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./interfaces/IHumaPoolAdmins.sol";
import "./interfaces/IHumaPoolLoanHelper.sol";
import "./interfaces/IHumaPoolLockerFactory.sol";
import "./interfaces/IHumaPoolLocker.sol";

contract HumaPool is Ownable {
  using SafeERC20 for IERC20;

  // HumaPoolAdmins
  address private immutable humaPoolAdmins;

  IERC20 public immutable poolToken;
  uint256 private immutable poolTokenDecimals;

  // IHumaPoolLoanHelper, for adding additional logic on top of the pool's borrow functionality
  address private humaPoolLoanHelper;
  bool private isHumaPoolLoanHelperApproved = false;

  // Liquidity holder proxy contract for this pool
  address private poolLocker;

  struct LenderInfo {
    uint256 amount;
    uint256 mostRecentLoanTimestamp;
  }
  // Tracks the amount of liquidity in poolTokens provided to this pool by an address
  mapping(address => LenderInfo) private lenderInfo;

  struct Loan {
    uint256 amount;
    uint256 issuedTimestamp;
    uint256 paybackAmount;
    uint256 paybackInterval;
    uint256 interestRate;
  }
  // Tracks currently issued loans from this pool
  mapping(address => Loan) private creditMapping;

  struct PoolTranche {
    uint256 maxLoanAmount;
    uint256 humaScoreLowerBound;
    uint256 interestRate;
    uint256 collateralRequired;
  }
  PoolTranche[] private tranches;

  enum PoolStatus {
    On,
    Off
  }
  PoolStatus public status = PoolStatus.Off;

  // How long after the last deposit that a lender needs to wait
  // before they can withdraw their capital
  uint256 loanWithdrawalLockoutPeriod = 2630000;

  constructor(
    address _poolToken,
    address _poolLockerFactory,
    address _humaPoolAdmins
  ) {
    poolToken = IERC20(_poolToken);
    poolTokenDecimals = ERC20(_poolToken).decimals();
    poolLocker = IHumaPoolLockerFactory(_poolLockerFactory).deployNewPoolLocker(
        address(this),
        _poolToken
      );
    humaPoolAdmins = _humaPoolAdmins;
  }

  // Allow for sensitive pool functions only to be called by
  // the pool owner and the huma master admin
  modifier onlyOwnerOrHumaMasterAdmin() {
    require(
      (msg.sender == owner() ||
        IHumaPoolAdmins(humaPoolAdmins).isMasterAdmin() == true),
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

  function getPoolTranches() public view returns (PoolTranche[] memory) {
    return tranches;
  }

  // Pass in an array of tranches to define this pools risk-loan tolerance.
  // The tranches must be passed in descending order and define the loan
  // strategy for the risk tranche from humaScoreLowerBound <-> next tranche bound (or MAX_INT) inclusive
  // A higher Huma score = less risky loan
  function setPoolTranches(PoolTranche[] memory _tranches)
    external
    onlyOwnerOrHumaMasterAdmin
  {
    uint256 lastHumaScore = 2**256 - 1; // MAX_INT
    delete tranches;
    for (uint256 i = 0; i < _tranches.length; i++) {
      require(
        _tranches[i].humaScoreLowerBound <= lastHumaScore,
        "HumaPool:TRANCHES_NOT_DESCENDING"
      );
      require(_tranches[i].interestRate >= 0, "HumaPool:ZERO_INTEREST_RATE");
      require(
        _tranches[i].collateralRequired >= 0,
        "HumaPool:COLLATERAL_VALUE_REQUIRED"
      );
      require(
        _tranches[i].maxLoanAmount > 0,
        "HumaPool:MAX_LOAN_AMOUNT_REQUIRED"
      );

      lastHumaScore = _tranches[i].humaScoreLowerBound;

      tranches.push(_tranches[i]);
    }
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
    require(tranches.length > 0);
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
  // collateral, and maximum loan requirements as dictated by the
  // tranche a users huma score falls into (higher huma score == lower risk)
  function borrow(
    uint256 _borrowAmount,
    uint256 _paybackInterval,
    uint256 _paybackAmount
  ) external poolOn returns (bool) {
    // Borrowers must not have existing loans from this pool
    require(
      creditMapping[msg.sender].amount == 0,
      "HumaPool:DENY_BORROW_EXISTING_LOAN"
    );
    // TODO: check token allowance for pool collector

    // TODO: make sure paybackAmount reflects proper interest rate of tranche

    // TODO: Check huma score here. Hardcoding for now.
    uint256 humaScore = 88;
    uint256 trancheIndex = getTrancheIndexForHumaScore(humaScore);
    require(
      tranches[trancheIndex].maxLoanAmount >= _borrowAmount,
      "HumaPool:DENY_BORROW_GREATER_THAN_LIMIT"
    );

    // Check custom borrowing logic in the loan helper of this pool
    require(
      IHumaPoolLoanHelper(humaPoolLoanHelper).evaluateBorrowRequest(
        msg.sender,
        _borrowAmount
      ),
      "HumaPool:BORROW_DENIED_POOL_LOAN_HELPER"
    );

    creditMapping[msg.sender] = Loan({
      amount: _borrowAmount,
      issuedTimestamp: block.timestamp,
      paybackAmount: _paybackAmount,
      paybackInterval: _paybackInterval,
      interestRate: tranches[trancheIndex].interestRate
    });
    IHumaPoolLocker(poolLocker).transfer(msg.sender, _borrowAmount);

    // Run custom post-borrowing logic in the loan helper of this pool
    IHumaPoolLoanHelper(humaPoolLoanHelper).postBorrowRequest(
      msg.sender,
      _borrowAmount
    );

    return true;
  }

  // Given a Huma score, finds the appropriate pool tranche that defines loan conditions
  // for that score. If no pool tranche fits the score, return -1.
  function getTrancheIndexForHumaScore(uint256 _humaScore)
    public
    view
    returns (uint256)
  {
    for (uint256 i = 0; i < tranches.length; i++) {
      if (_humaScore > tranches[i].humaScoreLowerBound) {
        return i;
      }
    }

    revert("HumaPool:NO_TRANCHE_FOR_SCORE");
  }

  // Function to receive Ether. msg.data must be empty
  receive() external payable {}

  // Fallback function is called when msg.data is not empty
  fallback() external payable {}

  function getBalance() public view returns (uint256) {
    return address(this).balance;
  }
}
