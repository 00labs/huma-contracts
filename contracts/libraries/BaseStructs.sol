//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/IFeeManager.sol";
import "hardhat/console.sol";

library BaseStructs {
    /**
     * @notice CreditRecord stores the overall info and status about a credit originated.
     * @dev amounts are stored in uint96, all counts are stored in uint16
     * @dev each struct can have no more than 13 elements.
     */
    struct CreditRecord {
        uint96 creditLimit; // the limit of the credit line
        uint96 unbilledPrincipal; // the amount of principal not included in the bill
        uint64 dueDate; // the due date of the next payment
        // correction is the adjustment of interest over or under-counted becasue of drawdown
        // or principal payment in the middle of a month
        int96 correction;
        uint96 totalDue; // the due amount of the next payment
        uint96 feesAndInterestDue; // interest and fees due for the next payment
        uint16 missedPeriods; // # of consecutive missed payments, for default processing
        uint16 remainingPeriods; // # of payment periods until the maturity of the credit line
        uint16 aprInBps; // annual percentage rate in basis points, 3.75% is represented as 375
        uint16 intervalInDays; // # of days in one billing period
        CreditState state; // status of the credit line
    }

    /**
     * @notice ReceivableInfo stores receivable used for credits.
     * @dev receivableParam is used to store info such as NFT tokenId
     */
    struct ReceivableInfo {
        address receivableAsset;
        uint96 receivableAmount;
        uint256 receivableParam;
    }

    enum CreditState {
        Deleted,
        Requested,
        Approved,
        GoodStanding,
        Delayed,
        InDefaultGracePeriod,
        Defaulted
    }

    // Please do NOT delete during development stage.
    // Debugging helper function. Please comment out after finishing debugging.
    // function printCreditInfo(CreditRecord memory cr) internal view {
    //     console.log("##### Status of the Credit #####");
    //     console.log("cr.creditLimit=", uint256(cr.creditLimit));
    //     console.log("cr.unbilledPrincipal=", uint256(cr.unbilledPrincipal));
    //     console.log("cr.dueDate=", uint256(cr.dueDate));
    //     console.logInt(cr.correction);
    //     console.log("cr.totalDue=", uint256(cr.totalDue));
    //     console.log("cr.feesAndInterestDue=", uint256(cr.feesAndInterestDue));
    //     console.log("cr.missedPeriods=", uint256(cr.missedPeriods));
    //     console.log("cr.remainingPeriods=", uint256(cr.remainingPeriods));
    //     console.log("cr.apr_in_bps=", uint256(cr.aprInBps));
    //     console.log("cr.intervalInDays=", uint256(cr.intervalInDays));
    //     console.log("cr.state=", uint256(cr.state));
    // }
}
