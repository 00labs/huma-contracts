//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @notice A token that tracks the gains and losses that the token owner can claim.
 * It is inspired by EIP-2222, which hanldes the gains only. The enhancement allows
 * the handling of the principle, gains, and losses.
 */
interface IHDT {
    /**
     * @dev This event emits when distributed funds are withdrawn by a token holder.
     * @param by the address of the receiver of funds
     * @param fundsWithdrawn the amount of funds that were withdrawn
     */
    event FundsWithdrawn(address indexed by, uint256 fundsWithdrawn);

    /**
     * @dev This event emits when new funds are distributed
     * @param by the address of the sender who distributed funds
     * @param fundsDistributed the amount of funds received for distribution
     */
    event IncomeDistributed(address indexed by, uint256 fundsDistributed);

    /**
     * @dev This event emits when new losses are distributed
     * @param by the address of the sender who distributed the loss
     * @param lossesDistributed the amount of losses received for distribution
     */
    event LossesDistributed(address indexed by, uint256 lossesDistributed);

    /**
     * @dev This event emits when distributed losses are recognized by a token holder.
     * @param by the address of the token owner
     * @param incomeRecognized the amount of income that were recognized
     */
    event IncomeRecognized(address indexed by, uint256 incomeRecognized);

    /**
     * @dev This event emits when distributed losses are recognized by a token holder.
     * @param by the address of the token owner
     * @param lossesRecognized the amount of losses that were recognized
     */
    event LossesRecognized(address indexed by, uint256 lossesRecognized);

    /**
     * @notice Distributes new income to accounts.
     */
    function distributeIncome(uint256 value) external;

    /**
     * @notice Distributes new losses to accounts.
     */
    function distributeLosses(uint256 value) external;

    /**
     * @dev Withdraws all available funds for the token holder.
     */
    function withdrawFunds() external returns (uint256);

    /**
     * @dev Returns the total amount of funds a given address is able to withdraw currently.
     * @param owner Address of the token holder
     * @return a uint256 representing the available funds for a given account
     */
    function withdrawableFundsOf(address owner) external view returns (uint256);
}
