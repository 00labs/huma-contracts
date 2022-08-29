//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

/**
 * @notice Interface for contracts to receive payback from sources other than the borrower
 */
interface IIndirectPayment {
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
