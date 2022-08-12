//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface ICredit {
    function initiate(
        address _borrower,
        uint256 liquidityAmt,
        address collateralAsset,
        uint256 collateralAmt,
        uint256[] memory terms
    ) external;

    function approveCredit(address borrower) external;

    function originateCredit(uint256 _borrowAmt) external;

    function originateCreditWithCollateral(
        address _borrower,
        uint256 borrowAmt,
        address collateralAsset,
        uint256 collateralParam,
        uint256 collateralCount
    ) external;

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

    // function assessLateFee(address borrower) external returns (uint256 fees);

    // function assessEarlyPayoffFees(address borrower)
    //     external
    //     returns (uint256 fees);

    // function getNextPayment(address borrower)
    //     external
    //     returns (
    //         uint256 totalAmt,
    //         uint256 principal,
    //         uint256 interest,
    //         uint256 fees,
    //         uint256 dueDate
    //     );

    function getNextPaymentInterestOnly(address borrower)
        external
        returns (
            uint256 totalAmt,
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

    function isApproved(address borrower) external view returns (bool);
}
