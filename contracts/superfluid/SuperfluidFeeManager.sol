// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "../BaseFeeManager.sol";

contract SuperfluidFeeManager is BaseFeeManager {
    BS.CreditRecordStatic internal _tempCrStatic;

    function distBorrowingAmount(uint256 borrowAmount)
        external
        view
        override
        returns (uint256 amtToBorrower, uint256 platformFees)
    {
        // Calculate platform fee, which includes protocol fee and pool fee
        platformFees = calcFrontLoadingFee(borrowAmount);
        uint256 interest = (borrowAmount *
            _tempCrStatic.aprInBps *
            _tempCrStatic.intervalInDays *
            SECONDS_IN_A_DAY) /
            SECONDS_IN_A_YEAR /
            HUNDRED_PERCENT_IN_BPS;
        platformFees += interest;

        if (borrowAmount < platformFees) revert Errors.borrowingAmountLessThanPlatformFees();

        amtToBorrower = borrowAmount - platformFees;
    }

    function setTempCreditRecordStatic(BS.CreditRecordStatic memory _crStatic) public {
        _tempCrStatic = _crStatic;
    }

    function deleteTempCreditRecordStatic() public {
        delete _tempCrStatic;
    }
}
