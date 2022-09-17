//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @notice Interface for contracts that can record pre-approved credit request
 */
interface IReceivable {
    /**
     * @notice reports after an payment is received for the borrower from a source
     * other than the borrower wallet
     */
    function onReceivedPayment(
        address borrower,
        address asset,
        uint256 amount
    ) external;
}
