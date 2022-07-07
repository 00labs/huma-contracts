//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./FDT.sol";
import "./interfaces/IFDTWithLosses.sol";
import "../libraries/SafeMathInt.sol";
import "../libraries/SafeMathUint.sol";

/**
 * @title FDT that supports losses
 * @notice FDTWithLosses allows an FDT to distribute and recognize losses.
 */
abstract contract FDTWithLosses is FDT, IFDTWithLosses {
    using SafeMath for uint256;
    using SafeMathInt for int256;
    using SafeMathUint for uint256;

    /// reported losses per share
    uint256 internal lossesPerShare;

    /**
     * Accumulative losses adjustment per account.
     * lossesCorrection is used when tokens are minted to the owner on different dates
     * or transferred between accounts.
     */
    mapping(address => int256) internal lossesCorrection;

    /// Recognized losses per account
    mapping(address => uint256) internal recognizedLosses;

    /**
     * @param name the name of the token
     * @param symbol the symbol of the token
     * @param _fundsToken the asset token that leads to the FDT's gain and losses
     */
    constructor(
        string memory name,
        string memory symbol,
        address _fundsToken
    ) FDT(name, symbol, _fundsToken) {}

    /**
     * @notice Distributes losses to FDT token holders.
     * @dev It reverts if the total supply of tokens is 0.
     * It emits the `LossesDistributed` event if the amount of received is greater than 0.
     * About undistributed losses:
     *   In each distribution, there is a small amount of funds which does not get distributed,
     *     which is `(msg.value * pointsMultiplier) % totalSupply()`.
     *   With a well-chosen `pointsMultiplier`, the amount funds that are not getting distributed
     *     in a distribution can be less than 1 (base unit).
     *   We can actually keep track of the undistributed in a distribution
     *     and try to distribute it in the next distribution ....... todo implement
     */
    function distributeLosses(uint256 amount) public virtual override {
        require(totalSupply() > 0, "FDTWithLosses:ZERO_SUPPLY");

        if (amount > 0) {
            lossesPerShare = lossesPerShare.add(
                amount.mul(pointsMultiplier) / totalSupply()
            );
            emit LossesDistributed(msg.sender, amount);
        }
    }

    /**
     * @notice Withdraws all available losses for a token holder.
     */
    function recognizeLosses() external virtual override returns (uint256) {
        uint256 _recognizableLosses = recognizableLossesOf(msg.sender);

        recognizedLosses[msg.sender] = recognizedLosses[msg.sender].add(
            _recognizableLosses
        );

        emit LossesRecognized(msg.sender, _recognizableLosses);

        return _recognizableLosses;
    }

    /**
     * @notice Views the losses that an address can recognize.
     * @param _owner The address of a token holder.
     * @return The amount of losses to be recognized for the `_owner`.
     */
    function recognizableLossesOf(address _owner)
        public
        view
        returns (uint256)
    {
        return accumulativeLossesOf(_owner).sub(recognizedLosses[_owner]);
    }

    /**
     * @notice Views the losses that an address has recognized.
     * @param _owner The address of a token holder.
     * @return The amount of losses recognized for the `_owner`.
     */
    function recognizedLossesOf(address _owner) public view returns (uint256) {
        return recognizedLosses[_owner];
    }

    /**
     * @notice Views the amount of losses that an address has accumulated in total.
     * @dev accumulativeLossesOf(_owner) = recognizableLossesOf(_owner) + recognizedLossesOf(_owner)
     * = (lossesPerShare * balanceOf(_owner) + lossesCorrection[_owner]) / pointsMultiplier
     * @param _owner The address of a token holder.
     * @return The amount of losses that `_owner` has ammulumated in total.
     */
    function accumulativeLossesOf(address _owner)
        public
        view
        returns (uint256)
    {
        return
            lossesPerShare
                .mul(balanceOf(_owner))
                .toInt256Safe()
                .add(lossesCorrection[_owner])
                .toUint256Safe() / pointsMultiplier;
    }

    // *****************************
    // * IERC20 Functions          *
    // *****************************
    /**
     * @dev Internal function that transfer tokens from one address to another.
     * Update pointsCorrection and lossCorrection to keep funds unchanged.
     * @param from The address to transfer from.
     * @param to The address to transfer to.
     * @param value The amount to be transferred.
     */
    function _transfer(
        address from,
        address to,
        uint256 value
    ) internal override {
        super._transfer(from, to, value);

        int256 _Correction = pointsPerShare.mul(value).toInt256Safe();
        pointsCorrection[from] = pointsCorrection[from].add(_Correction);
        pointsCorrection[to] = pointsCorrection[to].sub(_Correction);

        int256 _lossCorrection = lossesPerShare.mul(value).toInt256Safe();
        lossesCorrection[from] = lossesCorrection[from].add(_lossCorrection);
        lossesCorrection[to] = lossesCorrection[to].sub(_lossCorrection);
    }

    /**
     * @dev Internal function that mints tokens to an account.
     * Update pointsCorrection and lossCorrection to keep funds unchanged.
     * @param account The account that will receive the created tokens.
     * @param value The amount that will be created.
     */
    function _mint(address account, uint256 value) internal virtual override {
        super._mint(account, value);

        pointsCorrection[account] = pointsCorrection[account].sub(
            (pointsPerShare.mul(value)).toInt256Safe()
        );

        lossesCorrection[account] = lossesCorrection[account].sub(
            (lossesPerShare.mul(value)).toInt256Safe()
        );
    }

    /**
     * @dev Internal function that burns an amount of the token of a given account.
     * Update pointsCorrection and lossCorrection to keep funds unchanged.
     * @param account The account whose tokens will be burnt.
     * @param value The amount that will be burnt.
     */
    function _burn(address account, uint256 value) internal virtual override {
        super._burn(account, value);

        pointsCorrection[account] = pointsCorrection[account].add(
            (pointsPerShare.mul(value)).toInt256Safe()
        );

        lossesCorrection[account] = lossesCorrection[account].add(
            (lossesPerShare.mul(value)).toInt256Safe()
        );
    }
}
