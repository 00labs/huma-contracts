// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "../BaseFeeManager.sol";

contract SuperfluidFeeManager is BaseFeeManager {
    uint256 public tempInterest;

    function distBorrowingAmount(uint256 borrowAmount)
        external
        view
        override
        returns (uint256 amtToBorrower, uint256 platformFees)
    {
        // Calculate platform fee, which includes protocol fee and pool fee
        platformFees = calcFrontLoadingFee(borrowAmount);
        // uint256 interest = (borrowAmount *
        //     _tempCrStatic.aprInBps *
        //     _tempCrStatic.intervalInDays *
        //     SECONDS_IN_A_DAY) /
        //     SECONDS_IN_A_YEAR /
        //     HUNDRED_PERCENT_IN_BPS;
        platformFees += tempInterest;

        if (borrowAmount < platformFees) revert Errors.borrowingAmountLessThanPlatformFees();

        amtToBorrower = borrowAmount - platformFees;
    }

    function setTempInterest(uint256 _tempInterest) public {
        tempInterest = _tempInterest;
    }

    function deleteTempInterest() public {
        delete tempInterest;
    }

    function getDueInfo(
        BaseStructs.CreditRecord memory _cr,
        BaseStructs.CreditRecordStatic memory _crStatic
    )
        public
        view
        virtual
        override
        returns (
            uint256 periodsPassed,
            uint96 feesAndInterestDue,
            uint96 totalDue,
            uint96 unbilledPrincipal,
            int96 totalCharges
        )
    {
        if (_cr.state > BS.CreditState.GoodStanding) {
            (periodsPassed, feesAndInterestDue, totalDue, unbilledPrincipal, totalCharges) = super
                .getDueInfo(_cr, _crStatic);
        } else if (_cr.state == BS.CreditState.Approved) {
            periodsPassed = 1;
            totalDue = _cr.unbilledPrincipal;
        } else if (_cr.state == BS.CreditState.GoodStanding) {
            periodsPassed = 0;
            totalDue = _cr.totalDue;
        }
    }

    function calcCorrection(
        uint256 dueDate,
        uint256 aprInBps,
        uint256 amount
    ) public view virtual override returns (uint256 correction) {
        if (dueDate > block.timestamp) {
            correction = super.calcCorrection(dueDate, aprInBps, amount);
        }
    }
}
