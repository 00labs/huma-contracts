//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./interfaces/IHumaPoolSafeFactory.sol";
import "./interfaces/IHumaPoolSafe.sol";

contract HumaPool is Ownable {
  using SafeERC20 for IERC20;

  IERC20 public immutable poolToken;
  uint256 private immutable poolTokenDecimals;

  address private poolSafe;

  struct LenderInfo {
    uint256 amount;
    uint256 mostRecentLoanTimestamp;
  }
  // Tracks the amount of liquidity in poolTokens provided to this pool by an address
  mapping(address => LenderInfo) private lenderInfo;

  struct Loan {
    uint256 amount;
    uint256 issuedTimestamp;
    uint256 paybackTimestamp;
    uint256 payInterval;
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
  PoolTranche[] public tranches;

  enum PoolStatus {
    On,
    Off
  }
  PoolStatus public status = PoolStatus.Off;

  // How long after the last deposit that a lender needs to wait
  // before they can withdraw their capital
  uint256 loanWithdrawalLockoutPeriod = 2630000;

  constructor(address _poolToken, address _poolSafeFactory) {
    poolToken = IERC20(_poolToken);
    poolTokenDecimals = ERC20(_poolToken).decimals();
    poolSafe = IHumaPoolSafeFactory(_poolSafeFactory).deployNewPoolSafe(
      address(this),
      _poolToken
    );
  }

  modifier poolOn() {
    require(status == PoolStatus.On, "HumaPool:POOL_NOT_ON");
    _;
  }

  function getPoolTranches() public view returns (PoolTranche[] memory) {
    return tranches;
  }

  // Pass in an array of tranches to define this pools risk-loan tolerance.
  // The tranches must be passed in descending order and define the loan
  // strategy for the risk tranche from humaScoreLowerBound <-> next tranche bound (or MAX_INT) inclusive
  // A higher Huma score = less risky loan
  function setPoolTranches(PoolTranche[] memory _tranches) external onlyOwner {
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

  function getLoanWithdrawalLockoutPeriod() public view returns (uint256) {
    return loanWithdrawalLockoutPeriod;
  }

  function setLoanWithdrawalLockoutPeriod(uint256 _loanWithdrawalLockoutPeriod)
    external
    onlyOwner
  {
    loanWithdrawalLockoutPeriod = _loanWithdrawalLockoutPeriod;
  }

  function deposit(uint256 liquidityAmount) external poolOn returns (bool) {
    lenderInfo[msg.sender].amount += liquidityAmount;
    lenderInfo[msg.sender].mostRecentLoanTimestamp = block.timestamp;
    poolToken.safeTransferFrom(msg.sender, poolSafe, liquidityAmount);

    return true;
  }

  function withdraw(uint256 amount) external {
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
    IHumaPoolSafe(poolSafe).transfer(msg.sender, amount);
  }

  function borrow(
    uint256 _borrowAmount,
    uint256 _paybackTimestamp,
    uint256 _payInterval
  ) external poolOn returns (bool) {
    // Borrowers must not have existing loans from this pool
    require(
      creditMapping[msg.sender].amount == 0,
      "HumaPool:DENY_BORROW_EXISTING_LOAN"
    );
    // TODO: check token allowance for pool collector

    // TODO: Check huma score here. Hardcoding for now.
    uint256 humaScore = 88;
    uint256 trancheIndex = getTrancheIndexForHumaScore(humaScore);
    require(
      tranches[trancheIndex].maxLoanAmount >= _borrowAmount,
      "HumaPool:DENY_BORROW_GREATER_THAN_LIMIT"
    );

    creditMapping[msg.sender] = Loan({
      amount: _borrowAmount,
      issuedTimestamp: block.timestamp,
      paybackTimestamp: _paybackTimestamp,
      payInterval: _payInterval,
      interestRate: tranches[trancheIndex].interestRate
    });
    IHumaPoolSafe(poolSafe).transfer(msg.sender, _borrowAmount);

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

  // Allow borrow applications and loans to be processed by this pool.
  function enablePool() external onlyOwner {
    require(tranches.length > 0, "HumaPool:ENABLE_WITHOUT_TRANCHES");
    status = PoolStatus.On;
  }

  // Reject all future borrow applications and loans. Note that existing
  // loans will still be processed as expected.
  function disablePool() external onlyOwner {
    status = PoolStatus.Off;
  }

  // Function to receive Ether. msg.data must be empty
  receive() external payable {}

  // Fallback function is called when msg.data is not empty
  fallback() external payable {}

  function getBalance() public view returns (uint256) {
    return address(this).balance;
  }
}
