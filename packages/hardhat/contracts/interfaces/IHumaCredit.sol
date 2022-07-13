//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

enum CreditType {
    Loan,
    InvoiceFactoring,
    X_to_own
}

/**
 * @notice Base interface for all credit in Huma protocol. Example applications
 * are loan, invoice factoring, and x-to-own, where the users can gain ownership
 * of the asset over time in an x-to-earn systems.
 */
interface IHumaCredit {
    /**
     * @notice the initiation of a credit
     */
    function originateCredit() external returns (uint256);

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
     * @notice Gets the balance of principal
     * @return amount the amount of the balance
     */
    function getPrincipalBalance() external view returns (uint256 amount);

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
}
