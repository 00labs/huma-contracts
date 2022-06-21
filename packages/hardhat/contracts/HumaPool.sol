pragma solidity >=0.8.0 <0.9.0;
//SPDX-License-Identifier: MIT

import "hardhat/console.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract HumaPool is Ownable {
  IERC20 public immutable poolToken;
  uint256 private immutable poolTokenDecimals;

  struct PoolTranche {
    uint256 humaScoreLowerBound;
    uint256 interestRate;
    uint256 collateralRequired;
  }
  PoolTranche[] public tranches;

  enum PoolStatus {
    open,
    closed
  }
  PoolStatus public status = PoolStatus.open;

  constructor(address _poolToken) payable {
    poolToken = IERC20(_poolToken);
    poolTokenDecimals = ERC20(_poolToken).decimals();
  }

  modifier poolOpen() {
    require(
      status == PoolStatus.open,
      "HumaPool: Pool is not open. The owner must call enablePool"
    );
  }

  function getPoolTranches() external view returns (PoolTranche[] memory) {
    return tranches;
  }

  function setPoolTranches(PoolTranche[] calldata _tranches) external {
    uint256 lastHumaScore = 100;
    for (uint256 i = 0; i < _tranches.length; i++) {
      require(_tranches[i].humaScoreLowerBound < lastHumaScore);
      require(_tranches[i].interestRate >= 0);
      require(_tranches[i].collateralRequired >= 0);
    }

    tranches = _tranches;
  }

  // Allow borrow applications and loans to be processed by this pool.
  function enablePool() external onlyOwner {
    status = PoolStatus.open;
  }

  // Reject all future borrow applications and loans. Note that existing
  // loans will still be processed as expected.
  function disablePool() external onlyOwner {
    status = PoolStatus.closed;
  }

  // Function to receive Ether. msg.data must be empty
  receive() external payable {}

  // Fallback function is called when msg.data is not empty
  fallback() external payable {}

  function getBalance() public view returns (uint256) {
    return address(this).balance;
  }
}
