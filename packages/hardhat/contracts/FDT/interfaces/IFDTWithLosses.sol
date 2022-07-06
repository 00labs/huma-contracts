//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./IFDT.sol";

/**
 * @title FDT with losses.
 *
 * There are 2 stages for a reported losses for the FDT: distribute, and recognize.
 * `Distribute` happens when the implementation of this interface allocates losses to each token,
 * `Recognize` happens when the token over clears the losses.
 */
interface IFDTWithLosses {
    /**
     * @dev This event emits when new losses are distributed
     * @param by the address of the sender who distributed the loss
     * @param lossesDistributed the amount of losses received for distribution
     */
    event LossesDistributed(address indexed by, uint256 lossesDistributed);

    /**
     * @dev This event emits when distributed losses are recognized by a token holder.
     * @param by the address of the token owner
     * @param fundsWithdrawn the amount of losses that were recognized
     */
    event LossesRecognized(address indexed by, uint256 fundsWithdrawn);

    /**
     * @notice Distributes undistributed losses to accounts.
     */
    function distributeLosses(uint256 value) external;

    /**
     * @dev Returns the total amount of losses to be recognized by the given address
     * @param owner Address of the FDT holder
     * @return an uint256 representing the amount to be recognized for the given account
     */
    function recognizableLossesFor(address owner)
        external
        view
        returns (uint256);

    /**
     * @dev Recognize all losses for the FDT holder.
     */
    function recognizeLosses() external returns (uint256);
}
