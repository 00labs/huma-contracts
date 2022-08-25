//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;
import "../interfaces/IFeeManager.sol";
import "hardhat/console.sol";

library BaseStructs {
    // Divider to get monthly interest rate from APR BPS. 10000 * 12
    uint256 public constant BPS_DIVIDER = 120000;

    /**
     * @notice CreditRecord stores the overall info and status about a credit originated.
     * @dev amounts are stored in uint96, all counts are stored in uint16
     * @dev each struct can have no more than 13 elements.
     */
    struct CreditRecord {
        uint96 creditLimit; // the limit of the credit line
        uint96 balance; // the outstanding principal
        uint64 dueDate; // the due date of oustanding balance
        uint96 offset; //
        uint96 totalDue; // the due amount
        uint96 feesDue; // interest and fees
        uint16 missedCycles;
        uint16 remainingPayments;
        uint16 aprInBps;
        uint16 intervalInDays;
        CreditState state;
        PayScheduleOptions option;
    }

    /**
     * @notice CollateralInfo stores collateral used for credits.
     * @dev Used uint88 for collateralAmount to pack the entire struct in 2 storage units
     * @dev deleted is used to mark the entry as deleted in mappings
     * @dev collateralParam is used to store info such as NFT tokenId
     */
    struct CollateralInfo {
        address collateralAsset;
        uint88 collateralAmount;
        bool deleted;
        uint256 collateralParam;
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

    enum PayScheduleOptions {
        InterestOnly,
        MonthlyMinimal,
        Installment
    }

    // Please do NOT delete during development stage.
    // Debugging helper function. Please comment out after finishing debugging.
    function printCreditInfo(CreditRecord memory cr) internal view {
        console.log("\n##### Status of the Credit #####");
        console.log("cr.creditLimit=", uint256(cr.creditLimit));
        console.log("cr.balance=", uint256(cr.balance));
        console.log("cr.dueDate=", uint256(cr.dueDate));
        console.log("cr.offset=", uint256(cr.offset));
        console.log("cr.totalDue=", uint256(cr.totalDue));
        console.log("cr.feesDue=", uint256(cr.feesDue));
        console.log("cr.missedCycles=", uint256(cr.missedCycles));
        console.log("cr.remainingPayments=", uint256(cr.remainingPayments));
        console.log("cr.apr_in_bps=", uint256(cr.aprInBps));
        console.log("cr.intervalInDays=", uint256(cr.intervalInDays));
        console.log("cr.state=", uint256(cr.state));
        console.log("cr.option=", uint256(cr.option));
    }
}
