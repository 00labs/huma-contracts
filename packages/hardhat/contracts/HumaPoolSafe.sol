//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract HumaPoolSafe {
  using SafeERC20 for IERC20;

  address public immutable pool;
  IERC20 public immutable poolToken;

  constructor(address _pool, address _poolToken) {
    poolToken = IERC20(_poolToken);
    pool = _pool;
  }

  modifier isPool() {
    require(msg.sender == pool, "HumaPoolSafe:NOT_POOL");
    _;
  }

  function transfer(address to, uint256 amount) external isPool {
    require(to != address(0), "HumaPoolSafe:NULL_ADDR");
    poolToken.safeTransfer(to, amount);
  }
}
