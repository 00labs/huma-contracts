//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IFeeManager.sol";
import "./HumaConfig.sol";
import "hardhat/console.sol";

contract BaseFeeManager is IFeeManager, Ownable {
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

    // fixedPaymentPerOneMillion is a mapping from terms (# of multiple of 30 days) to
    // a mapping from interest rate to payment.
    // It is used for efficiency and gas consideration. We pre-compute the monthly payments for
    // different combination of terms and interest rate off-chain and load it on-chain when
    // the contract is initiazed by the pool owner. At run time, intead of using complicated
    // formula to get monthly payment for every request to a mortgage type of loan on the fly,
    // we will just do a lookup.
    mapping(uint256 => mapping(uint256 => uint256)) fixedPaymentPerOneMillion;

    function setFees(
        uint256 _front_loading_fee_flat,
        uint256 _front_loading_fee_bps,
        uint256 _late_fee_flat,
        uint256 _late_fee_bps,
        uint256 _back_platform_fee_flat,
        uint256 _back_platform_fee_bps
    ) public onlyOwner {
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

    function addBatchOfFixedPayments(
        uint256[] calldata numOfPayments,
        uint256[] calldata aprInBps,
        uint256[] calldata payments
    ) external onlyOwner {
        uint256 length = numOfPayments.length;
        require(
            (length == aprInBps.length) && (aprInBps.length == payments.length),
            "INPUT_ARRAY_SIZE_MISMATCH"
        );

        uint256 i;
        for (i = 0; i < length; i++) {
            addFixedPayment(numOfPayments[i], aprInBps[i], payments[i]);
        }
    }

    function addFixedPayment(
        uint256 numberOfPayments,
        uint256 aprInBps,
        uint256 payment
    ) public onlyOwner {
        mapping(uint256 => uint256) storage tempMap = fixedPaymentPerOneMillion[
            numberOfPayments
        ];
        tempMap[aprInBps] = payment;
    }

    function getFixedPaymentAmt(
        uint256 creditAmt,
        uint256 aprInBps,
        uint256 numOfPayments
    ) public view returns (uint256 paymentAmt) {
        uint256 uintPrice = (fixedPaymentPerOneMillion[numOfPayments])[
            aprInBps
        ];
        paymentAmt = (uintPrice * creditAmt) / 1000000;
    }

    /// returns (maxLoanAmt, interest, and the 6 fee fields)
    function getFees()
        public
        view
        virtual
        returns (
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        return (
            front_loading_fee_flat,
            front_loading_fee_bps,
            late_fee_flat,
            late_fee_bps,
            back_loading_fee_flat,
            back_loading_fee_bps
        );
    }
}
