//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface IFeeManager {
    function calcFrontLoadingFee(uint256 _amount)
        external
        returns (uint256 fees);

    function calcRecurringFee(uint256 _amount) external returns (uint256 fees);

    function calcLateFee(
        uint256 _amount,
        uint256 _dueDate,
        uint256 _lastLateFeeDate,
        uint256 _paymentInterval
    ) external returns (uint256 fees);

    function calcBackLoandingFee(uint256 _amount)
        external
        returns (uint256 fees);
}
