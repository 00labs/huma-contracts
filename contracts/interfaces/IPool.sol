//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../libraries/BaseStructs.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPool {
    function setEvaluationAgent(uint256 eaId, address agent) external;

    function addApprovedLender(address lender) external;

    function removeApprovedLender(address lender) external;

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

    function setAPR(uint256 _apr) external;

    function setReceivableRequiredInBps(uint256 _receivableRateInBps) external;

    function setMaxCreditLine(uint256 _maxAmount) external;

    function setPoolDefaultGracePeriod(uint256 _gracePeriodInDays) external;

    function setPoolPayPeriod(uint256 periodInDays) external;

    function setPoolLiquidityCap(uint256 _liquidityCap) external;

    function setWithdrawalLockoutPeriod(uint256 _lockoutPeriodInDays) external;

    function setPoolOwnerRewardsAndLiquidity(uint256 rewardsRate, uint256 liquidityRate) external;

    function setEARewardsAndLiquidity(uint256 rewardsRate, uint256 liquidityRate) external;

    function getPoolSummary()
        external
        view
        returns (
            address poolToken,
            uint256 apr,
            uint256 payPeriod,
            uint256 maxCreditAmount,
            uint256 liquiditycap,
            string memory name,
            string memory symbol,
            uint8 decimal,
            uint256 evaluationAgentId,
            address eaNFTContractAddress
        );

    function totalPoolValue() external view returns (uint256);
}
