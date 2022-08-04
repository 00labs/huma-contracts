//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface IPool {
    function makeInitialDeposit(uint256 amount) external;

    function deposit(uint256 amount) external;

    function withdraw(uint256 amount) external;

    function withdrawAll() external;

    function enablePool() external;

    function disablePool() external;

    function setPoolLocker(address _poolLocker) external returns (bool);

    function setMinMaxBorrowAmt(uint256 minAmt, uint256 maxAmt) external;

    function setAPR(uint256 _interestRateBasis) external;

    function setFees(
        uint256 _platform_fee_flat,
        uint256 _platform_fee_bps,
        uint256 _late_fee_flat,
        uint256 _late_fee_bps,
        uint256 _early_payoff_fee_flat,
        uint256 _early_payoff_fee_bps
    ) external;

    function setCollateralRateInBps(uint256 _collateralRequired) external;

    function setPoolDefaultGracePeriod(uint256 gracePeriod) external;

    function setWithdrawalLockoutPeriod(uint256 _period) external;

    function setPoolLiquidityCap(uint256 cap) external;

    function addCreditApprover(address approver) external;

    function getPoolSummary()
        external
        view
        returns (
            address token,
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
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256
        );
}
