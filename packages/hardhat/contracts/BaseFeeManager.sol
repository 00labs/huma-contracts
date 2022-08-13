//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./interfaces/IFeeManager.sol";
import "./HumaConfig.sol";
import "hardhat/console.sol";

contract BaseFeeManager is IFeeManager {
    // Divider to get monthly interest rate from APR BPS. 10000 * 12
    uint256 public constant BPS_DIVIDER = 120000;

    // Platform fee, charged when a loan is originated
    uint256 public front_loading_fee_flat;
    uint256 public front_loading_fee_bps;
    // Late fee, charged when the borrow is late for a pyament.
    uint256 public late_fee_flat;
    uint256 public late_fee_bps;
    // Early payoff fee, charged when the borrow pays off prematurely
    uint256 public back_loading_fee_flat;
    uint256 public back_loading_fee_bps;

    function setFees(
        uint256 _front_loading_fee_flat,
        uint256 _front_loading_fee_bps,
        uint256 _late_fee_flat,
        uint256 _late_fee_bps,
        uint256 _back_platform_fee_flat,
        uint256 _back_platform_fee_bps
    ) public {
        front_loading_fee_flat = _front_loading_fee_flat;
        front_loading_fee_bps = _front_loading_fee_bps;
        late_fee_flat = _late_fee_flat;
        late_fee_bps = _late_fee_bps;
        back_loading_fee_flat = _back_platform_fee_flat;
        back_loading_fee_bps = _back_platform_fee_bps;
    }

    function calcFrontLoadingFee(uint256 _amount)
        public
        virtual
        override
        returns (uint256 fees)
    {
        fees = front_loading_fee_flat;
        if (front_loading_fee_bps > 0)
            fees += (_amount * front_loading_fee_bps) / 10000;
    }

    function calcRecurringFee(uint256 _amount)
        external
        virtual
        override
        returns (uint256 fees)
    {}

    function calcLateFee(
        uint256 _amount,
        uint256 _dueDate,
        uint256 _lastLateFeeDate,
        uint256 _paymentInterval
    ) external virtual override returns (uint256 fees) {
        if (
            block.timestamp > _dueDate &&
            _lastLateFeeDate < (block.timestamp - _paymentInterval)
        ) {
            fees = late_fee_flat;
            if (late_fee_bps > 0)
                fees += (_amount * late_fee_bps) / BPS_DIVIDER;
        }
    }

    function calcBackLoadingFee(uint256 _amount)
        external
        virtual
        override
        returns (uint256 fees)
    {
        fees = back_loading_fee_flat;
        if (back_loading_fee_bps > 0)
            fees += (_amount * back_loading_fee_bps) / BPS_DIVIDER;
    }

    function distBorrowingAmt(uint256 borrowAmt, address humaConfig)
        external
        virtual
        override
        returns (
            uint256 amtToBorrower,
            uint256 protocolFee,
            uint256 poolIncome
        )
    {
        // Calculate platform fee, which includes protocol fee and pool fee
        uint256 platformFees = calcFrontLoadingFee(borrowAmt);

        // Split the fee between treasury and the pool
        protocolFee =
            (uint256(HumaConfig(humaConfig).treasuryFee()) * borrowAmt) /
            10000;

        assert(platformFees >= protocolFee);

        poolIncome = platformFees - protocolFee;

        amtToBorrower = borrowAmt - platformFees;

        return (amtToBorrower, protocolFee, poolIncome);
    }
}
