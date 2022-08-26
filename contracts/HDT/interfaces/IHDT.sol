//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

/**
 * @notice A token that tracks the gains and losses that the token owner can claim.
 * It is inspired by EIP-2222, which hanldes the gains only. The enhancement allows
 * the handling of the principle, gains, and losses.
 */
interface IHDT {
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
     * @notice Distributes new income to accounts.
     */
    function distributeIncome(uint256 value) external;

    /**
     * @notice Distributes new losses to accounts.
     */
    function distributeLosses(uint256 value) external;

    /**
     * @notice Reports amount withdrawn from account
     */
    function reportWithdrawn(uint256 amount) external;

    /**
     * @dev Returns the total amount of funds a given address is able to withdraw currently.
     * @param owner Address of the token holder
     * @return a uint256 representing the available funds for a given account
     */
    function withdrawableFundsOf(address owner) external view returns (uint256);
}
