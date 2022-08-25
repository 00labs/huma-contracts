//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IFeeManager.sol";
import "./HumaConfig.sol";
import {BaseStructs as BS} from "./libraries/BaseStructs.sol";
import "hardhat/console.sol";

contract BaseFeeManager is IFeeManager, Ownable {
    using BS for BS.CreditRecord;

    // Divider to get monthly interest rate from APR BPS. 10000 * 12
    uint256 public constant BPS_DIVIDER = 10000;
    uint256 public constant APR_BPS_DIVIDER = 120000;

    // Platform fee, charged when a loan is originated
    uint256 public frontLoadingFeeFlat;
    uint256 public frontLoadingFeeBps;
    // Late fee, charged when the borrow is late for a pyament.
    uint256 public lateFeeFlat;
    uint256 public lateFeeBps;

    // installmentPaymentPerOneMillion is a mapping from terms (# of multiple of 30 days) to
    // a mapping from interest rate to payment.
    // It is used for efficiency and gas consideration. We pre-compute the monthly payments for
    // different combination of terms and interest rate off-chain and load it on-chain when
    // the contract is initiazed by the pool owner. At run time, intead of using complicated
    // formula to get monthly payment for every request to a mortgage type of loan on the fly,
    // we will just do a lookup.
    mapping(uint256 => mapping(uint256 => uint256))
        public installmentPaymentPerOneMillion;

    function setFees(
        uint256 _frontLoadingFeeFlat,
        uint256 _frontLoadingFeeBps,
        uint256 _lateFeeFlat,
        uint256 _lateFeeBps
    ) public onlyOwner {
        frontLoadingFeeFlat = _frontLoadingFeeFlat;
        frontLoadingFeeBps = _frontLoadingFeeBps;
        lateFeeFlat = _lateFeeFlat;
        lateFeeBps = _lateFeeBps;
    }

    function calcFrontLoadingFee(uint256 _amount)
        public
        virtual
        override
        returns (uint256 fees)
    {
        fees = frontLoadingFeeFlat;
        if (frontLoadingFeeBps > 0)
            fees += (_amount * frontLoadingFeeBps) / 10000;
    }

    function calcLateFee(
        uint256 dueDate,
        uint256 totalDue,
        uint256 balance
    ) public view virtual override returns (uint256 fees) {
        if (block.timestamp > dueDate && totalDue > 0) {
            fees = lateFeeFlat;
            if (lateFeeBps > 0) fees += (balance * lateFeeBps) / BPS_DIVIDER;
        }
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

    function addBatchOfInstallments(
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
            addInstallment(numOfPayments[i], aprInBps[i], payments[i]);
        }
    }

    function addInstallment(
        uint256 numberOfPayments,
        uint256 aprInBps,
        uint256 payment
    ) public onlyOwner {
        mapping(uint256 => uint256)
            storage tempMap = installmentPaymentPerOneMillion[numberOfPayments];
        tempMap[aprInBps] = payment;
    }

    function getInstallmentAmount(
        uint256 creditAmount,
        uint256 aprInBps,
        uint256 numOfPayments
    ) public view virtual override returns (uint256 paymentAmount) {
        uint256 unitPrice = (installmentPaymentPerOneMillion[numOfPayments])[
            aprInBps
        ];
        require(unitPrice > 0, "PRICE_NOT_EXIST");
        paymentAmount = (unitPrice * creditAmount) / 1000000;
    }

    function applyPayment(
        BaseStructs.CreditRecord calldata _cr,
        uint256 _amount
    )
        external
        view
        virtual
        override
        returns (
            uint96 balance,
            uint64 dueDate,
            uint96 totalDue,
            uint96 feesDue,
            uint256 cyclesPassed,
            uint256 amountToCollect
        )
    {
        console.log("At the top of applyPayment...");
        _cr.printCreditInfo();

        uint96 payoffAmount;
        (cyclesPassed, feesDue, totalDue, payoffAmount) = getDueInfo(_cr);

        if (_amount < totalDue) {
            totalDue = uint96(totalDue - _amount);
            if (_amount <= feesDue) {
                amountToCollect = _amount;
            } else {
                balance = uint96(_cr.balance - _amount + feesDue);
                amountToCollect = _amount;
            }
        } else {
            console.log("Enough to cover totalDue");
            totalDue = 0;
            if (_amount < payoffAmount) {
                console.log("Not enought to payoff");
                console.log("balance=", balance);
                console.log("_amount=", _amount);
                console.log("feesDue=", feesDue);
                balance = uint96(_cr.balance - _amount + feesDue);
                amountToCollect = _amount;
            } else {
                // payoff
                console.log("Enough to payoff");
                balance = 0;
                amountToCollect = payoffAmount;
            }
        }

        dueDate = uint64(
            _cr.dueDate + cyclesPassed * _cr.intervalInDays * 86400
        );
    }

    function getDueInfo(BaseStructs.CreditRecord calldata _cr)
        public
        view
        returns (
            uint256 cyclesPassed,
            uint96 feesDue,
            uint96 totalDue,
            uint96 payoffAmount
        )
    {
        console.log("At the top of getDueInfo...");
        _cr.printCreditInfo();

        // Without a cron job, the user may have missed multiple payments.
        if (block.timestamp < _cr.dueDate) {
            console.log("Not late");
            // todo prorate the interest
            payoffAmount = feesDue + _cr.balance;
            console.log("Payoff amount=", payoffAmount);
            return (0, _cr.feesDue, _cr.totalDue, payoffAmount);
        }

        cyclesPassed =
            1 +
            (block.timestamp - _cr.dueDate) /
            (_cr.intervalInDays * 86400);

        console.log("Late time: ", cyclesPassed);

        uint256 i;
        uint256 fees;
        uint256 interest;
        uint256 balance = uint256(_cr.balance);
        feesDue = _cr.feesDue;
        totalDue = _cr.totalDue;
        for (i = 1; i <= cyclesPassed; i++) {
            if (totalDue > 0)
                fees = calcLateFee(
                    _cr.dueDate + i * _cr.intervalInDays * 86400,
                    totalDue,
                    balance
                );

            balance += totalDue;
            interest = (balance * _cr.aprInBps) / APR_BPS_DIVIDER;

            // If r.offset is negative, its absolute value is guaranteed to be
            // no more than interest. Thus, the following statement is safe.
            // No offset after the 1st cycle since no drawdown is allowed
            // when there are outstanding late payments
            if (i == 1) interest = interest + _cr.offset;

            // todo add a config for 5%.
            totalDue = uint96(fees + interest + (balance * 5) / 100);
            // todo add logic to make sure totalDue meets the min requirement.
        }
        feesDue = uint96(fees + interest);
        payoffAmount = uint96(balance + feesDue);
        if (cyclesPassed >= _cr.remainingPayments - 1)
            totalDue = uint96(payoffAmount);

        console.log("Before returning from getDueInfo");
        console.log("cyclesPassed=", cyclesPassed);
        console.log("feesDue=", feesDue);
        console.log("totalDue=", totalDue);
        console.log("payoffAmount=", payoffAmount);
        return (cyclesPassed, feesDue, totalDue, payoffAmount);
    }

    /**
     * @dev Never accept partial payment for minimal due (interest + fees).
     */
    // function getNextPayment(
    //     BaseStructs.CreditRecord memory _cr,
    //     uint256 _lastLateFeeDate,
    //     uint256 _paymentAmount
    // )
    //     public
    //     view
    //     virtual
    //     override
    //     returns (
    //         uint256 principal,
    //         uint256 interest,
    //         uint256 fees,
    //         bool isLate,
    //         bool markPaid,
    //         bool paidOff
    //     )
    // {
    //     fees = calcLateFee(_cr.dueDate, _cr.totalDue, _cr.balance);
    //     if (fees > 0) isLate = true;
    //     interest = (_cr.balance * _cr.aprInBps) / APR_BPS_DIVIDER;

    //     // final payment
    //     if (_cr.remainingPayments == 1) {
    //         uint256 due = fees + interest + _cr.balance;

    //         if (_paymentAmount >= due) {
    //             // Successful payoff. If overpaid, leave overpaid unallocated
    //             markPaid = true;
    //             paidOff = true;
    //             principal = _cr.balance;
    //         } else {
    //             // Not enough to cover interest and late fees, do not accept any payment
    //             markPaid = false;
    //             fees = 0;
    //             interest = 0;
    //         }
    //     } else {
    //         uint256 due = _cr.totalDue + fees;

    //         if (_paymentAmount >= due) {
    //             markPaid = true;

    //             // Check if amount is good enough for payoff
    //             uint256 forPrincipal = _paymentAmount - interest - fees;

    //             if (forPrincipal >= _cr.balance) {
    //                 // Early payoff
    //                 principal = _cr.balance;
    //                 paidOff = true;
    //             } else {
    //                 // Not enough for payoff, apply extra payment for principal
    //                 principal = forPrincipal;
    //             }
    //         } else {
    //             // Not enough to cover the total due, reject the payment.
    //             markPaid = false;
    //             fees = 0;
    //             interest = 0;
    //         }
    //     }
    //     return (principal, interest, fees, isLate, markPaid, paidOff);
    // }

    /// returns the four fields for fees. The last two fields are unused. Kept it for compatibility.
    function getFees()
        public
        view
        virtual
        override
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
            frontLoadingFeeFlat,
            frontLoadingFeeBps,
            lateFeeFlat,
            lateFeeBps,
            0,
            0
        );
    }

    function getRecurringPayment(BaseStructs.CreditRecord memory _cr)
        external
        pure
        virtual
        override
        returns (uint256 amount)
    {
        // todo implement this
        return _cr.totalDue;
    }
}
