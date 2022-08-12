//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "hardhat/console.sol";

library BaseStructs {
    uint256 public constant BPS_DIVIDER = 120000;

    /**
     * @notice CreditInfo stores the overall info about a loan.
     * @dev amounts are stored in uint32, all counts are stored in uint16
     * @dev all fields in CreditInfo will not change after initialization.
     * @dev each struct can have no more than 13 elements. Some fields
     * are stored in CreditStatus because of space limitation.
     */
    struct CreditInfo {
        // fields related to the overall picture of the loan
        address collateralAsset;
        uint32 collateralAmt;
        uint32 loanAmt;
        uint16 numOfPayments;
        bool deleted;
        uint256 collateralParam;
    }

    struct CreditFeeStructure {
        uint16 apr_in_bps; // interest rate in bps
        uint16 platform_fee_flat;
        uint16 platform_fee_bps;
        uint16 late_fee_flat;
        uint16 late_fee_bps;
        uint16 early_payoff_fee_flat;
        uint16 early_payoff_fee_bps;
        bool deleted;
    }

    /**
     * @notice CreditStatus tracks the state such as how much has been paid,
     * how many payments are remaining.
     * @dev most fields in LaonState change as the borrower pays back
     */
    struct CreditStatus {
        uint64 nextDueDate;
        uint32 nextAmtDue;
        uint32 remainingPrincipal; // remaining principal balance
        uint16 remainingPayments;
        uint16 paymentInterval; // in days
        uint64 lastLateFeeTimestamp;
        uint32 feesDue;
        CreditState state;
        bool deleted;
    }

    enum CreditState {
        Deleted,
        Requested,
        Approved,
        Originated,
        GoodStanding,
        Delayed,
        PaidOff,
        InDefaultGracePeriod,
        Defaulted
    }

    // Please do NOT delete during development stage.
    // Debugging helper function. Please comment out after finishing debugging.
    function printDetailStatus(
        CreditFeeStructure storage cfs,
        CreditInfo storage ci,
        CreditStatus storage cs
    ) public view {
        console.log("\n##### Status of the Credit #####");
        console.log("ci.collateralAsset=", ci.collateralAsset);
        console.log("ci.collateralAmt=", uint256(ci.collateralAmt));
        console.log("ci.loanAmt=", uint256(ci.loanAmt));
        console.log("ci.numOfPayments=", uint256(ci.numOfPayments));
        console.log("ci.deleted=", ci.deleted);
        console.log("ci.collateralParam=", ci.collateralParam);

        console.log("cfs.apr_in_bps=", uint256(cfs.apr_in_bps));
        console.log("cfs.platform_fee_flat=", uint256(cfs.platform_fee_flat));
        console.log("cfs.platform_fee_bps=", uint256(cfs.platform_fee_bps));
        console.log("cfs.late_fee_flat=", uint256(cfs.late_fee_flat));
        console.log("cfs.late_fee_bps=", uint256(cfs.late_fee_bps));
        console.log("cfs.deleted=", cfs.deleted);

        console.log("cs.nextDueDate=", uint256(cs.nextDueDate));
        console.log("cs.nextAmtDue=", uint256(cs.nextAmtDue));
        console.log("cs.remainingPrincipal=", uint256(cs.remainingPrincipal));
        console.log("cs.remainingPayments=", uint256(cs.remainingPayments));
        console.log("cs.paymentInterval=", uint256(cs.paymentInterval));
        console.log(
            "cs.lastLateFeeTimestamp=",
            uint256(cs.lastLateFeeTimestamp)
        );

        console.log("cs.feesDue=", uint256(cs.feesDue));
        console.log("cs.state=", uint256(cs.state));
        console.log("cs.deleted=", cs.deleted);
    }

    /**
     * @notice Checks if a late fee should be charged and charges if needed
     * @return fees the amount of fees charged
     */
    function assessLateFee(
        CreditFeeStructure storage cfs,
        CreditStatus storage cs
    ) internal view returns (uint256 fees) {
        // Charge a late fee if 1) passed the due date and 2) there is no late fee charged
        // between the due date and the current timestamp.
        if (
            block.timestamp > cs.nextDueDate &&
            cs.lastLateFeeTimestamp < cs.nextDueDate
        ) {
            if (cfs.late_fee_flat > 0) fees = cfs.late_fee_flat;
            if (cfs.late_fee_bps > 0) {
                fees += (cs.nextAmtDue * cfs.late_fee_bps) / BPS_DIVIDER;
            }
        }
    }
}
