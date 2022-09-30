//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20MetadataUpgradeable, ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./interfaces/IHDT.sol";

import "./HDTStorage.sol";
import "../Errors.sol";

/**
 * @title Huma Distribution Token
 * @notice HDT tracks the principal, earnings and losses associated with a token.
 */
contract HDT is ERC20Upgradeable, OwnableUpgradeable, HDTStorage, IHDT {
    event PoolChanged(address pool);

    constructor() {
        _disableInitializers();
    }

    /**
     * @param name the name of the token
     * @param symbol the symbol of the token
     */
    function initialize(
        string memory name,
        string memory symbol,
        address underlyingToken
    ) external initializer {
        if (underlyingToken == address(0)) revert Errors.zeroAddressProvided();
        _assetToken = underlyingToken;

        __ERC20_init(name, symbol);
        _decimals = IERC20MetadataUpgradeable(underlyingToken).decimals();

        __Ownable_init();
    }

    function setPool(address poolAddress) external onlyOwner {
        _pool = IPool(poolAddress);
        emit PoolChanged(poolAddress);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function totalAssets() public view returns (uint256) {
        return _pool.totalPoolValue();
    }

    function mintAmount(address account, uint256 amount)
        external
        override
        onlyPool
        returns (uint256 shares)
    {
        shares = convertToShares(amount);
        // todo add test for zero share case
        if (shares == 0) revert Errors.zeroAmountProvided();
        _mint(account, shares);
    }

    function burnAmount(address account, uint256 amount)
        external
        override
        onlyPool
        returns (uint256 shares)
    {
        shares = convertToShares(amount);
        // todo add test for zero test case
        if (shares == 0) revert Errors.zeroAmountProvided();
        _burn(account, shares);
    }

    function burn(address account, uint256 shares)
        external
        override
        onlyPool
        returns (uint256 amount)
    {
        amount = convertToAssets(shares);
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
     * @param account The address of a token holder.
     * @return The amount funds that `_owner` can withdraw.
     */
    function withdrawableFundsOf(address account)
        external
        view
        virtual
        override
        returns (uint256)
    {
        return convertToAssets(balanceOf(account));
    }

    function assetToken() external view override returns (address) {
        return _assetToken;
    }

    function pool() external view returns (address) {
        return address(_pool);
    }

    modifier onlyPool() {
        if (msg.sender != address(_pool)) revert Errors.notPoolOwner();
        _;
    }
}
