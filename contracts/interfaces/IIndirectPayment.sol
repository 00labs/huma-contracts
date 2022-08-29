//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

/**
 * @notice Interface to for contracts that can receive off-contract payback
 */
interface IIndirectPayment {
    /**
     * @notice reports after an off-contract payment is received for the borrower
     */
    function onReceivedPayment(
        address borrower,
        address asset,
        uint256 amount
    ) external;
}
