//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface IPool {
    function addCreditApprover(address approver) external;

    function disablePool() external;

    function enablePool() external;

    // function setKeySettings(
    //     uint256 _apr,
    //     uint256 _collateralRateInBps,
    //     uint256 _minAmt,
    //     uint256 _maxAmt,
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

    function setCollateralRequiredInBps(uint256 _collateralRateInBps) external;

    function setMinMaxBorrowAmt(uint256 _minAmt, uint256 _maxAmt) external;

    function setFees(
        uint256 _front_fee_flat,
        uint256 _front_fee_bps,
        uint256 _late_fee_flat,
        uint256 _late_fee_bps,
        uint256 _back_fee_flat,
        uint256 _back_fee_bps
    ) external;

    function setPoolDefaultGracePeriod(uint256 _gracePeriodInDays) external;

    function setPoolLiquidityCap(uint256 _liquidityCap) external;

    function setPoolLocker(address _poolLocker) external returns (bool);

    function setWithdrawalLockoutPeriod(uint256 _lockoutPeriodInDays) external;

    function getPoolSummary()
        external
        view
        returns (
            address poolToken,
            uint256 apr,
            uint256 minCreditAmt,
            uint256 maxCreditAmt,
            uint256 liquiditycap,
            string memory name,
            string memory symbol,
            uint8 decimal
        );

    function getPoolFees()
        external
        view
        returns (
            uint256 apr,
            uint256 front_fee_flat,
            uint256 front_fee_bps,
            uint256 late_fee_flat,
            uint256 late_fee_bps,
            uint256 back_fee_flat,
            uint256 back_fee_bps
        );
}
