//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;
import "../libraries/BaseStructs.sol";

interface IFeeManager {
    /**
     * @notice Computes the amuont to be offseted due to in-cycle drawdown or principal payment
     * @param _cr the credit record associated with the account associated with the drawdown/payment
     * @param amount the amount of the drawdown/payment that we are trying to compute correction
     * @dev Correction is used when there is change to the principal in the middle of the cycle
     * due to drawdown or principal payment. For a drawdown, principal goes up, the interest at
     * the end of cycle will be higher than the actual interest that should have been generated
     * since the balance was lower for a portion of the cycle. For drawdown, the correction is
     * negative to offset the over-count at the end of the cycle. It will be positive for
     * principal payment.
     */
    function calcCorrection(BaseStructs.CreditRecord memory _cr, uint256 amount)
        external
        view
        returns (uint256 correction);

    /**
     * @notice Computes the front loading fee including both the flat fee and percentage fee
     * @param _amount the borrowing amount
     * @return fees the amount of fees to be charged for this borrowing
     */
    function calcFrontLoadingFee(uint256 _amount)
        external
        returns (uint256 fees);

    /**
     * @notice Computes the late fee including both the flat fee and percentage fee
     * @param dueDate the due date of the payment
     * @param totalDue the amount that is due
     * @param balance the total balance including amount due and unbilled principal
     * @return fees the amount of late fees to be charged
     * @dev Charges only if 1) there is outstanding due, 2) the due date has passed
     */
    function calcLateFee(
        uint256 dueDate,
        uint256 totalDue,
        uint256 balance
    ) external view returns (uint256 fees);

    /**
     * @notice Apply front loading fee, distribute the total amount to borrower, pool, & protocol
     * @param borrowAmount the amount of the borrowing
     * @param humaConfig address of the configurator
     * @return amtToBorrower the amount that the borrower can take
     * @return protocolFee the portion of the fee charged that goes to the protocol
     * @return poolIncome the portion of the fee charged that goes to the pool as income
     * @dev the protocol always takes a percentage of the total fee generated
     */
    function distBorrowingAmount(uint256 borrowAmount, address humaConfig)
        external
        returns (
            uint256 amtToBorrower,
            uint256 protocolFee,
            uint256 poolIncome
        );

    /**
     * @notice Gets the current total due, fees and interest due, and payoff amount.
     * Because there is no "cron" kind of mechanism, it is possible that the account is behind
     * for multiple cycles due to a lack of activities. This function will traverse through
     * these cycles to get the most up-to-date due information.
     * @param _cr the credit record associated the account
     * @return periodsPassed the number of billing periods has passed since the last statement.
     * If it is within the same period, it will be 0.
     * @return feesAndInterestDue the sum of fees and interest due. If multiple cycles have passed,
     * this amount is not necessarily the stotal fees and interest charged. It only returns the amount
     * that is due currently.
     * @return totalDue amount due in this period, it includes fees, interest, and min principal
     * @return payoffAmount amount for payoff. It includes totalDue, unbilled principal, and
     * interest for the final period.
     */
    function getDueInfo(BaseStructs.CreditRecord memory _cr)
        external
        view
        returns (
            uint256 periodsPassed,
            uint96 feesAndInterestDue,
            uint96 totalDue,
            uint96 payoffAmount,
            uint96 unbilledPrincipal
        );

    /**
     * @notice Sets the standard front loading and late fee policy for the fee manager
     * @param _frontLoadingFeeFlat flat fee portion of the front loading fee
     * @param _frontLoadingFeeBps a fee in the percentage of a new borrowing
     * @param _lateFeeFlat flat fee portion of the late
     * @param _lateFeeBps a fee in the percentage of the outstanding balance
     * @dev Only owner can make this setting
     */
    function setFees(
        uint256 _frontLoadingFeeFlat,
        uint256 _frontLoadingFeeBps,
        uint256 _lateFeeFlat,
        uint256 _lateFeeBps
    ) external;

    /**
     * @notice Sets the min percentage of principal to be paid in each billing period
     * @param _minPrincipalRateInBps the min % in unit of bps. For example, 5% will be 500
     * @dev Only owner can make this setting
     * @dev This is a global limit of 5000 bps (50%).
     */
    function setMinPrincipalRateInBps(uint256 _minPrincipalRateInBps) external;

    /**
     * @notice Gets the fee structure for the pool
     * @param _frontLoadingFeeFlat flat fee portion of the front loading fee
     * @param _frontLoadingFeeBps a fee in the percentage of a new borrowing
     * @param _lateFeeFlat flat fee portion of the late
     * @param _lateFeeBps a fee in the percentage of the outstanding balance
     */
    function getFees()
        external
        view
        returns (
            uint256 _frontLoadingFeeFlat,
            uint256 _frontLoadingFeeBps,
            uint256 _lateFeeFlat,
            uint256 _lateFeeBps
        );
}
