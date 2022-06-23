//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./interfaces/IHumaPoolLockerFactory.sol";
import "./interfaces/IHumaPoolLocker.sol";

contract HumaPool is Ownable {
  using SafeERC20 for IERC20;

  IERC20 public immutable poolToken;
  uint256 private immutable poolTokenDecimals;

  address private poolLocker;

  mapping(address => uint256) liquidityMapping;

  struct PoolTranche {
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

  constructor(address _poolToken, address _poolLockerFactory) {
    poolToken = IERC20(_poolToken);
    poolTokenDecimals = ERC20(_poolToken).decimals();
    poolLocker = IHumaPoolLockerFactory(_poolLockerFactory).deployNewPoolLocker(
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
  function setPoolTranches(PoolTranche[] memory _tranches) external onlyOwner {
    uint256 lastHumaScore = 2**256 - 1; // MAX_INT
    delete tranches;
    for (uint256 i = 0; i < _tranches.length; i++) {
      require(_tranches[i].humaScoreLowerBound <= lastHumaScore);
      require(_tranches[i].interestRate >= 0);
      require(_tranches[i].collateralRequired >= 0);

      lastHumaScore = _tranches[i].humaScoreLowerBound;

      tranches.push(_tranches[i]);
    }
  }

  function deposit(uint256 liquidityAmount) external poolOn returns (bool) {
    poolToken.safeTransferFrom(msg.sender, poolLocker, liquidityAmount);
    liquidityMapping[msg.sender] += liquidityAmount;

    return true;
  }

  function withdraw(uint256 amount) external returns (bool) {
    require(amount <= liquidityMapping[msg.sender]);
    liquidityMapping[msg.sender] -= amount;
    IHumaPoolLocker(poolLocker).transfer(msg.sender, amount);

    return true;
  }

  // Allow borrow applications and loans to be processed by this pool.
  function enablePool() external onlyOwner {
    require(tranches.length > 0);
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
