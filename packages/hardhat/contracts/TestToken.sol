//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
  uint256 constant _initial_supply = 100000 * (10**18);

  constructor() ERC20("TestToken", "TT") {
    _mint(msg.sender, 1000);
  }

  function give1000To(address _to) external {
    _mint(_to, 1000);
  }
}
