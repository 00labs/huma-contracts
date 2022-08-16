//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IFeeManager.sol";
import "./HumaConfig.sol";
import "./libraries/BaseStructs.sol";
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
    ) public virtual override returns (uint256 fees) {
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
        public
        virtual
        override
        returns (uint256 fees)
    {
        fees = back_loading_fee_flat;
        if (back_loading_fee_bps > 0)
            fees += (_amount * back_loading_fee_bps) / BPS_DIVIDER;
    }

    function distBorrowingAmount(uint256 borrowAmount, address humaConfig)
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
        uint256 platformFees = calcFrontLoadingFee(borrowAmount);

        // Split the fee between treasury and the pool
        protocolFee =
            (uint256(HumaConfig(humaConfig).treasuryFee()) * borrowAmount) /
            10000;

        assert(platformFees >= protocolFee);

        poolIncome = platformFees - protocolFee;

        amtToBorrower = borrowAmount - platformFees;

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

    function getFixedPaymentAmount(
        uint256 creditAmount,
        uint256 aprInBps,
        uint256 numOfPayments
    ) public view virtual override returns (uint256 paymentAmount) {
        uint256 uintPrice = (fixedPaymentPerOneMillion[numOfPayments])[
            aprInBps
        ];
        paymentAmount = (uintPrice * creditAmount) / 1000000;
    }

    function getNextPayment(
        BaseStructs.CreditRecord memory _cr,
        uint256 _lastLateFeeDate,
        uint256 _paymentAmount
    )
        public
        virtual
        override
        returns (
            uint256 principal,
            uint256 interest,
            uint256 fees,
            bool paidOff
        )
    {
        fees = calcLateFee(
            _cr.nextAmountDue,
            _cr.nextDueDate,
            _lastLateFeeDate,
            _cr.paymentIntervalInDays
        );

        interest = (_cr.remainingPrincipal * _cr.aprInBps) / BPS_DIVIDER;

        // final payment
        if (_cr.remainingPayments == 1) {
            fees += calcBackLoadingFee(_cr.loanAmount);
            principal = _cr.remainingPrincipal;
            paidOff = true;
        } else {
            principal = _cr.nextAmountDue - interest;
            paidOff = false;

            // Handle overpayment
            // if the extra is not enough for all the reamining principle,
            // simply apply the extra towards principal, otherwise,
            // check if the extra can cover the backloading fee as well. If yes,
            // process this as a payoff; otherwise, we get into a corner case
            // when the remaining principal becomes 0 but the credit is not
            // paid off because of back loading fee.
            uint256 totalDue = principal + interest + fees;
            if (_paymentAmount > totalDue) {
                uint256 extra = _paymentAmount - totalDue;

                if ((_cr.remainingPrincipal - principal) > extra) {
                    // The extra does not cover all the remaining principal, simply
                    // apply the extra towards principal
                    principal += extra;
                } else {
                    // the extra can cover the remaining principal, check if it is
                    // enough to cover back loading fee.
                    principal = _cr.remainingPrincipal;
                    extra -= (_cr.remainingPrincipal - principal);
                    uint256 backloadingFee = calcBackLoadingFee(_cr.loanAmount);

                    if (extra >= backloadingFee) {
                        fees += backloadingFee;
                        paidOff = true;
                    }
                }
            }
        }

        return (principal, interest, fees, paidOff);
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
