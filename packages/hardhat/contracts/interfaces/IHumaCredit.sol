//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @notice Base interface for all credit in Huma protocol. Example applications
 * are loan, invoice factoring, and x-to-own, where the users can gain ownership
 * of the asset over time in an x-to-earn systems.
 */
interface IHumaCredit {
    /**
     * @notice the initiation of a credit
     * @param borrower the address of the borrower
     * @param liquidityAsset the address of the liquidity asset that the borrower obtains
     * @param liquidityAmount the amount of the liquidity asset that the borrower obtains
     * @param collateralAsset the address of the collateral asset. `Collateral` is a broader
     * term than a classical collateral in finance term. It can be the NFT that represents
     * the invoice payment in the Invoice Factoring use case. It can be the game asset
     * in the x-to-own use case.
     * @param collateralAmount the amount of the collateral asset
     * @return the actual amount borrowed
     */
    function originateCredit(
        address borrower,
        address liquidityAsset,
        uint256 liquidityAmount,
        address collateralAsset,
        uint256 collateralAmount,
        uint256 terms
    ) external view returns (uint256);

    /**
     * @notice Borrower makes one payment
     * @return status if the payment is successful or not
     *
     */
    function makePayment(
        address borrower,
        address asset,
        uint256 amount
    ) external returns (bool status);

    /**
     * @notice Borrower requests to payoff the credit
     * @return status if the payoff is successful or not
     */
    function payoff(
        address borrower,
        address asset,
        uint256 amount
    ) external returns (bool status);

    /**
     * @notice Triggers the default process
     * @return losses the amount of remaining losses to the pool after collateral
     * liquidation, pool cover, and staking.
     */
    function triggerDefault(address borrower) external returns (uint256 losses);

    /**
     * @notice Gets the balance of principal
     * @return amount the amount of the balance
     */
    function getPrincipalBalance() external view returns (uint256 amount);

    /**
     * @notice Gets the total amount for the payoff
     * @return amount the amount of the payoff
     */
    function getPayoffBalance() external view returns (uint256 amount);

    /**
     * @notice Gets the information of the next payment due
     * @return asset the address of the asset for the payback
     * @return fullAmount the full amount due for the next payment
     * @return minAmount the min amount due for the next payment
     * @return duedate the datetime of when the next payment is due
     */
    function getNextPayment()
        external
        view
        returns (
            address asset,
            uint256 fullAmount,
            uint256 minAmount,
            uint256 duedate
        );
}
