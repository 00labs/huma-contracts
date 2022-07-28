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
     * @param _poolLocker the address of pool locker that holds the liquidity asset
     * @param _treasury the address of the treasury that accepts fees
     * @param _borrower the address of the borrower
     * @param liquidityAsset the address of the liquidity asset that the borrower obtains
     * @param liquidityAmount the amount of the liquidity asset that the borrower obtains
     * @param collateralAsset the address of the collateral asset. `Collateral` is a broader
     * term than a classical collateral in finance term. It can be the NFT that represents
     * the invoice payment in the Invoice Factoring use case. It can be the game asset
     * in the x-to-own use case.
     * @param collateralAmount the amount of the collateral asset
     */
    function initiate(
        address payable pool,
        address _poolLocker,
        address _humaConfig,
        address _treasury,
        address _borrower,
        address liquidityAsset,
        uint256 liquidityAmount,
        address collateralAsset,
        uint256 collateralAmount,
        uint256[] calldata terms
    ) external;

    /**
     * @notice approves the terms of the credit.
     */
    function approve() external returns (bool);

    /**
     * @notice allows the borrower to originate the credit
     */
    function originateCredit(uint256 borrowAmt)
        external
        returns (uint256, uint256);

    /**
     * @notice Borrower makes one payment
     * @return status if the payment is successful or not
     *
     */
    function makePayment(address asset, uint256 amount)
        external
        returns (bool status);

    /**
     * @notice Borrower requests to payoff the credit
     * @return status if the payoff is successful or not
     */
    function payoff(address asset, uint256 amount)
        external
        returns (bool status);

    /**
     * @notice Triggers the default process
     * @return losses the amount of remaining losses to the pool after collateral
     * liquidation, pool cover, and staking.
     */
    function triggerDefault() external returns (uint256 losses);

    /**
     * @notice Gets the payoff information
     * @return total the total amount for the payoff
     * @return principal the remaining principal amount
     * @return interest the interest amount for the last period
     * @return fees fees including early payoff penalty
     * @return duedate the date that payment needs to be made for this payoff amount
     */
    function getPayoffInfo()
        external
        returns (
            uint256 total,
            uint256 principal,
            uint256 interest,
            uint256 fees,
            uint256 duedate
        );

    /**
     * @notice Gets the information of the next payment due
     * @return total the total amount for the next payment
     * @return principal the principle amount per the payment schedule
     * @return interest the interest amount for this period
     * @return fees fees including early payoff penalty
     * @return duedate the date that payment needs to be made for this payoff amount
     */
    function getNextPayment()
        external
        returns (
            uint256 total,
            uint256 principal,
            uint256 interest,
            uint256 fees,
            uint256 duedate
        );

    /**
     * @notice Check if the credit is approved or not.
     */
    function isApproved() external view returns (bool);

    function getCreditBalance() external view returns (uint256);
}
