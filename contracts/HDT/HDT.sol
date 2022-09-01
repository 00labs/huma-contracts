//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IHDT.sol";
import "../interfaces/IPool.sol";

/**
 * @title Huma Distribution Token
 * @notice HDT tracks the principal, earnings and losses associated with a token.
 */
contract HDT is IHDT, ERC20 {
    using SafeERC20 for IERC20;

    IERC20 public assetToken;

    IPool public pool;

    /**
     * @param name the name of the token
     * @param symbol the symbol of the token
     */
    constructor(
        string memory name,
        string memory symbol,
        address poolAddress
    ) ERC20(name, symbol) {
        pool = IPool(poolAddress);
        assetToken = pool.underlyingToken();
    }

    function totalAssets() public view virtual returns (uint256) {
        return pool.totalLiquidity();
    }

    function mint(address account, uint256 assets)
        external
        override
        onlyPool
        returns (uint256 shares)
    {
        shares = convertToShares(assets);
        require(shares > 0, "HDT:SHARE_IS_ZERO");
        _mint(account, shares);
    }

    function burn(address account, uint256 assets)
        external
        override
        onlyPool
        returns (uint256 shares)
    {
        shares = convertToShares(assets);
        require(shares > 0, "HDT:SHARE_IS_ZERO");
        _burn(account, shares);
    }

    function burnShares(address account, uint256 shares)
        external
        override
        onlyPool
        returns (uint256 assets)
    {
        assets = convertToAssets(shares);
        _burn(account, shares);
    }

    function convertToShares(uint256 assets) public view virtual returns (uint256) {
        uint256 ts = totalSupply();
        uint256 ta = totalAssets();

        return ts == 0 ? assets : (assets * ts) / ta;
    }

    function convertToAssets(uint256 shares) public view virtual returns (uint256) {
        uint256 ts = totalSupply();
        uint256 ta = totalAssets();

        return ts == 0 ? shares : (shares * ta) / ts;
    }

    /**
     * @notice Views the amount of funds that an address can withdraw.
     * @param _owner The address of a token holder.
     * @return The amount funds that `_owner` can withdraw.
     */
    function withdrawableFundsOf(address _owner) public view virtual override returns (uint256) {
        return convertToAssets(balanceOf(_owner));
    }

    modifier onlyPool() {
        require(msg.sender == address(pool), "HDT:INVALID_CALLER");
        _;
    }
}
