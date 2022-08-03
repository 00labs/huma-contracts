//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./IReputationTracker.sol";

interface ICredit {
    function initiate(address _borrower, uint256 liquidityAmt) external;

    function initiateWithCollateral(
        address _borrower,
        uint256 liquidityAmt,
        address collateralAsset,
        uint256 collateralAmt
    ) external;

    function approve(
        address borrower,
        uint256 liquidityAmt,
        address collateralAsset,
        uint256 collateralAmt
    ) external;

    function originateCredit(address _borrower, uint256 _borrowAmt) external;

    function originateCreditWithCollateral(
        address _borrower,
        uint256 borrowAmt,
        address collateralAsset,
        uint256 collateralParam,
        uint256 collateralCount
    ) external returns (bool);

    function invalidateApprovedCredit(address _borrower) external;

    function makePayment(
        address _borrower,
        address _asset,
        uint256 _amount
    ) external;

    function payoff(
        address borrower,
        address asset,
        uint256 amount
    ) external;

    function triggerDefault(address borrower) external returns (uint256 losses);

    function assessLateFee(address borrower) external returns (uint256 fees);

    function assessEarlyPayoffFees(address borrower)
        external
        returns (uint256 fees);

    function reportReputationTracking(
        address borrower,
        IReputationTracker.TrackingType trackingType
    ) external;

    function addCreditApprover(address approver) external;

    function removeCreditApprover(address approver) external;

    function getApprovalStatusForBorrower(address borrower) external view;

    function getNextPayment(address borrower)
        external
        returns (
            uint256 totalAmt,
            uint256 principal,
            uint256 interest,
            uint256 fees,
            uint256 dueDate
        );

    function getNextPaymentInterestOnly(address borrower)
        external
        returns (
            uint256 totalAmt,
            uint256 principal,
            uint256 interest,
            uint256 fees,
            uint256 dueDate
        );

    function getPayoffInfo(address borrower)
        external
        returns (
            uint256 total,
            uint256 principal,
            uint256 interest,
            uint256 fees,
            uint256 dueDate
        );

    function getPayoffInfoInterestOnly(address borrower)
        external
        returns (
            uint256 total,
            uint256 principal,
            uint256 interest,
            uint256 fees,
            uint256 dueDate
        );

    function getLoanInformation(address borrower)
        external
        view
        returns (
            uint32 _amount,
            uint32 _paybackPerInterval,
            uint64 _paybackInterval,
            uint32 _interestRateBasis,
            uint64 _nextDueDate,
            uint32 _principalPaidBack,
            uint16 _remainingPayments,
            uint16 _numOfPayments
        );

    function getCreditBalance(address borrower)
        external
        view
        returns (uint256 amount);
}
