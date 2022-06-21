pragma solidity >=0.8.0 <0.9.0;
//SPDX-License-Identifier: MIT

import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./HumaPoolSafeFactory.sol";

contract HumaPool is Ownable {
  using SafeERC20 for IERC20;

  IERC20 public immutable poolToken;
  uint256 private immutable poolTokenDecimals;

  HumaPoolSafe private poolSafe;

  mapping(address => uint256) liquidityMapping;

  struct PoolTranche {
    uint256 humaScoreLowerBound;
    uint256 interestRate;
    uint256 collateralRequired;
  }
  PoolTranche[] public tranches;

  enum PoolStatus {
    on,
    off
  }
  PoolStatus public status = PoolStatus.on;

  constructor(address _poolToken) payable {
    poolToken = IERC20(_poolToken);
    poolTokenDecimals = ERC20(_poolToken).decimals();
    poolSafe = HumaPoolSafeFactory.deployNewPoolSafe(address(this), _poolToken);
  }

  modifier poolOn() {
    require(status == PoolStatus.on, "HumaPool:POOL_NOT_ON");
    _;
  }

  function getPoolTranches() external view returns (PoolTranche[] memory) {
    return tranches;
    _;
  }

  function setPoolTranches(PoolTranche[] calldata _tranches)
    external
    onlyOwner
  {
    uint256 lastHumaScore = 100;
    for (uint256 i = 0; i < _tranches.length; i++) {
      require(_tranches[i].humaScoreLowerBound < lastHumaScore);
      require(_tranches[i].interestRate >= 0);
      require(_tranches[i].collateralRequired >= 0);
    }

    tranches = _tranches;
  }

  function deposit(uint256 liquidityAmount) external poolOn {
    poolToken.safeTransferFrom(msg.sender, poolSafe, liquidityAmount);
    liquidityMapping[msg.sender] += liquidityAmount;
  }

  function withdraw(uint256 amount) external {
    require(amount <= liquidityMapping[msg.sender]);
    liquidityMapping[msg.sender] -= amount;
    poolSafe.transfer(msg.sender, amount);
  }

  // Allow borrow applications and loans to be processed by this pool.
  function enablePool() external onlyOwner {
    status = PoolStatus.on;
  }

  // Reject all future borrow applications and loans. Note that existing
  // loans will still be processed as expected.
  function disablePool() external onlyOwner {
    status = PoolStatus.off;
  }

  // Function to receive Ether. msg.data must be empty
  receive() external payable {}

  // Fallback function is called when msg.data is not empty
  fallback() external payable {}

  function getBalance() public view returns (uint256) {
    return address(this).balance;
  }
}
