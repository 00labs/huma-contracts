//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./interfaces/IHDT.sol";
import "../libraries/SafeMathInt.sol";
import "../libraries/SafeMathUint.sol";

/**
 * @title Huma Distribution Token
 * @notice HDT tracks the principal, earnings and losses associated with a token.
 */
contract HDT is IHDT, ERC20 {
    using SafeMath for uint256;
    using SafeMathInt for int256;
    using SafeMathUint for uint256;
    using SafeERC20 for IERC20;

    // optimize, see https://github.com/ethereum/EIPs/issues/1726#issuecomment-472352728
    uint256 internal constant pointsMultiplier = 2**128;

    /// // The underlying token that the FDT owners can claim interest for
    IERC20 public immutable fundsToken;

    /**
     * The value per share. It starts with $1, goes up with income, goes down with losses,
     * and it will never go below $0.
     */
    uint256 internal pointsPerShare;

    /**
     * Accumulative adjustment per account.
     */
    mapping(address => int256) internal pointsCorrection;

    /// Amount that has withdrawn by the account owner
    mapping(address => uint256) internal withdrawnFunds;

    /**
     * @param name the name of the token
     * @param symbol the symbol of the token
     * @param _fundsToken the asset token that leads to the FDT's gain and losses
     */
    constructor(
        string memory name,
        string memory symbol,
        address _fundsToken
    ) ERC20(name, symbol) {
        fundsToken = IERC20(_fundsToken);
        pointsPerShare = 1;
    }

    /**
     * @notice Distributes income to token holders.
     * @dev It reverts if the total supply of tokens is 0.
     * It emits the `IncomeDistributed` event if the amount of received is greater than 0.
     * About undistributed income:
     *   In each distribution, there is a small amount of funds which does not get distributed,
     *     which is `(msg.value * pointsMultiplier) % totalSupply()`.
     *   With a well-chosen `pointsMultiplier`, the amount funds that are not getting distributed
     *     in a distribution can be less than 1 (base unit).
     *   We can actually keep track of the undistributed in a distribution
     *     and try to distribute it in the next distribution ....... todo implement
     */
    function distributeIncome(uint256 value) public virtual override {
        require(totalSupply() > 0, "HDT:SUPPLY_IS_ZERO");

        if (value > 0) {
            pointsPerShare = pointsPerShare.add(
                value.mul(pointsMultiplier) / totalSupply()
            );

            emit IncomeDistributed(msg.sender, value);
        }
    }

    /**
     * @notice Distributes losses associated with the token
     * @dev Technically, we can combine distributeIncome() and distributeLossees() by making
     * the parameter to int256, however, we decided to use separate APIs to improve readability
     * and reduce errors.
     * @param value the amount of losses to be distributed
     */
    function distributeLosses(uint256 value) public virtual override {
        require(totalSupply() > 0, "HDT:SUPPLY_IS_ZERO");

        if (value > 0) {
            pointsPerShare = pointsPerShare.sub(
                value.mul(pointsMultiplier) / totalSupply()
            );
            emit LossesDistributed(msg.sender, value);
        }
    }

    /**
     * @dev Withdraws all available funds for a token holder.
     */
    function withdrawFunds() external virtual override returns (uint256) {
        uint256 _withdrawableFund = withdrawableFundsOf(msg.sender);

        withdrawnFunds[msg.sender] = withdrawnFunds[msg.sender].add(
            _withdrawableFund
        );

        if (_withdrawableFund > uint256(0)) {
            fundsToken.safeTransfer(msg.sender, _withdrawableFund);

            emit FundsWithdrawn(msg.sender, _withdrawableFund);
        }

        return _withdrawableFund;
    }

    /**
     * @notice Views the amount of funds that an address can withdraw.
     * @param _owner The address of a token holder.
     * @return The amount funds that `_owner` can withdraw.
     */
    function withdrawableFundsOf(address _owner) public view returns (uint256) {
        return accumulativeFundsOf(_owner).sub(withdrawnFunds[_owner]);
    }

    /**
     * @notice Views the amount of funds that an address has withdrawn.
     * @param _owner The address of a token holder.
     * @return The amount of funds that `_owner` has withdrawn.
     */
    function withdrawnFundsOf(address _owner) public view returns (uint256) {
        return withdrawnFunds[_owner];
    }

    /**
     * @notice Views the amount of funds that an address has earned in total.
     * @dev accumulativeFundsOf(_owner) = withdrawableFundsOf(_owner) + withdrawnFundsOf(_owner)
     * = (pointsPerShare * balanceOf(_owner) + pointsCorrection[_owner]) / pointsMultiplier
     * @param _owner The address of a token holder.
     * @return The amount of funds that `_owner` has earned in total.
     */
    function accumulativeFundsOf(address _owner) public view returns (uint256) {
        return
            pointsPerShare
                .mul(balanceOf(_owner))
                .toInt256Safe()
                .add(pointsCorrection[_owner])
                .toUint256Safe() / pointsMultiplier;
    }

    // *****************************
    // * IERC20 Functions          *
    // *****************************
    /**
     * @dev Internal function that transfer tokens from one address to another.
     * Update pointsCorrection to keep funds unchanged.
     * @param from The address to transfer from.
     * @param to The address to transfer to.
     * @param value The amount to be transferred.
     */
    function _transfer(
        address from,
        address to,
        uint256 value
    ) internal virtual override {
        super._transfer(from, to, value);

        int256 _magCorrection = pointsPerShare.mul(value).toInt256Safe();
        pointsCorrection[from] = pointsCorrection[from].add(_magCorrection);
        pointsCorrection[to] = pointsCorrection[to].sub(_magCorrection);
    }

    /**
     * @dev Internal function that mints tokens to an account.
     * Update pointsCorrection to keep funds unchanged.
     * @param account The account that will receive the created tokens.
     * @param value The amount that will be created.
     */
    function _mint(address account, uint256 value) internal virtual override {
        super._mint(account, value);

        pointsCorrection[account] = pointsCorrection[account].sub(
            (pointsPerShare.mul(value)).toInt256Safe()
        );
    }

    /**
     * @dev Internal function that burns an amount of the token of a given account.
     * Update pointsCorrection to keep funds unchanged.
     * @param account The account whose tokens will be burnt.
     * @param value The amount that will be burnt.
     */
    function _burn(address account, uint256 value) internal virtual override {
        super._burn(account, value);

        pointsCorrection[account] = pointsCorrection[account].add(
            (pointsPerShare.mul(value)).toInt256Safe()
        );
    }
}
