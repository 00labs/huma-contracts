//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @notice Implementation for EIP-2222. We choose to support all mandatory events and functions,
 * and some selected optional events and functions.
 *
 * There are 3 stages for a reported fund for the FDT: deposit, distribute, and withdraw.
 * FundsDeposited, FundsDistributed, and FundsWithdrawn will be emited after each step.
 */
interface IFDT {
    /**
     * @dev This event emits when new funds are distributed
     * @dev Mandatory by EIP-2222
     * @param by the address of the sender who distributed funds
     * @param fundsDistributed the amount of funds received for distribution
     */
    event FundsDistributed(address indexed by, uint256 fundsDistributed);

    /**
     * @dev This event emits when distributed funds are withdrawn by a token holder.
     * @dev Mandatory by EIP-2222
     * @param by the address of the receiver of funds
     * @param fundsWithdrawn the amount of funds that were withdrawn
     */
    event FundsWithdrawn(address indexed by, uint256 fundsWithdrawn);

    /**
     * @notice Distributes undistributed funds to accounts.
     * @dev Optional for EIP-2222. Changed signature to accept a parameter
     */
    function distributeFunds(uint256 value) external;

    /**
     * @dev Returns the total amount of funds a given address is able to withdraw currently.
     * @dev Mandatory by EIP-2222
     * @param owner Address of FundsDistributionToken holder
     * @return a uint256 representing the available funds for a given account
     */
    function withdrawableFundsOf(address owner) external view returns (uint256);

    /**
     * @dev Withdraws all available funds for a FundsDistributionToken holder.
     * @dev Mandatory by EIP-2222
     */
    function withdrawFunds() external;
}
