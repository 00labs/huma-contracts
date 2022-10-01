//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
    constructor() ERC20("TestToken", "USDC") {
        _mint(msg.sender, 1000 * 10**decimals());
    }

    function give1000To(address to) external {
        _mint(to, 1000 * 10**decimals());
    }

    function give100000To(address to) external {
        _mint(to, 100000 * 10**decimals());
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function decimals() public view virtual override returns (uint8) {
        return 6;
    }
}
