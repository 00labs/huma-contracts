//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;
import "../libraries/BaseStructs.sol";

interface IFeeManager {
    function calcFrontLoadingFee(uint256 _amount)
        external
        returns (uint256 fees);

    function calcLateFee(
        uint256 dueDate,
        uint256 totalDue,
        uint256 balance
    ) external view returns (uint256 fees);

    function distBorrowingAmount(uint256 borrowAmount, address humaConfig)
        external
        returns (
            uint256 amtToBorrower,
            uint256 protocolFee,
            uint256 poolIncome
        );

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

    // function applyPayment(
    //     BaseStructs.CreditRecord calldata _cr,
    //     uint256 _amount
    // )
    //     external
    //     view
    //     returns (
    //         uint64 dueDate,
    //         uint256 periodsPassed,
    //         uint96 forFeesAndInterest,
    //         uint96 forPrincipal
    //     );

    function calcCorrection(BaseStructs.CreditRecord memory _cr, uint256 amount)
        external
        view
        returns (uint256 correction);

    // function getDueInfo(BaseStructs.CreditRecord calldata _cr)
    //     external
    //     view
    //     returns (
    //         uint256 dueDate,
    //         uint256 totalDue,
    //         uint256 interestAndFees,
    //         uint256 principal,
    //         uint256 payoffAmount,
    //         uint256 numOfLates
    //     );

    // function getNextPayment(
    //     BaseStructs.CreditRecord memory _cr,
    //     uint256 _lastLateFeeDate,
    //     uint256 _paymentAmount
    // )
    //     external
    //     view
    //     returns (
    //         uint256,
    //         uint256,
    //         uint256,
    //         bool,
    //         bool,
    //         bool
    //     );

    function getFees()
        external
        view
        returns (
            uint256 frontLoadingFeeFlat,
            uint256 frontLoadingFeeBps,
            uint256 lateFeeFlat,
            uint256 lateFeeBps,
            uint256 unused1,
            uint256 unused2
        );

    function getRecurringPayment(BaseStructs.CreditRecord memory _cr)
        external
        view
        returns (uint256 amount);
}
