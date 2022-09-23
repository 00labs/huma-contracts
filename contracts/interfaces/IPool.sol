//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../libraries/BaseStructs.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPool {
    function disablePool() external;

    function enablePool() external;

    // function setKeySettings(
    //     uint256 _apr,
    //     uint256 _receivableRateInBps,
    //     uint256 _minAmount,
    //     uint256 _maxAmount,
    //     uint256 _front_fee_flat,
    //     uint256 _front_fee_bps,
    //     uint256 _late_fee_flat,
    //     uint256 _late_fee_bps,
    //     uint256 _back_fee_flat,
    //     uint256 _back_fee_bps,
    //     uint256 _gracePeriodInDays,
    //     uint256 _liquidityCap,
    //     uint256 _lockoutPeriodInDays
    // ) external;

    function totalPoolValue() external view returns (uint256);
}
