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
    uint256 public constant SECONDS_IN_A_YEAR = 31536000;
    uint256 public constant SECONDS_IN_A_DAY = 86400;

    // Platform fee, charged when a loan is originated
    uint256 public frontLoadingFeeFlat;
    uint256 public frontLoadingFeeBps;
    // Late fee, charged when the borrow is late for a pyament.
    uint256 public lateFeeFlat;
    uint256 public lateFeeBps;

    // The min percentage of principal to be paid each period for credit line
    uint256 public minPrincipalRateInBps;

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

    /**
     * @notice Sets the min and max of each loan/credit allowed by the pool.
     */
    function setMinPrincipalRateInBps(uint256 _minPrincipalRateInBps)
        external
        onlyOwner
    {
        require(_minPrincipalRateInBps < 5000, "RATE_TOO_HIGH");
        minPrincipalRateInBps = _minPrincipalRateInBps;
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
        uint256 totalBalance
    ) public view virtual override returns (uint256 fees) {
        console.log("In calcLateFee, block.timestamp=", block.timestamp);
        console.log("dueDate=", dueDate);
        console.log("totalDue=", totalDue);
        if (block.timestamp >= dueDate && totalDue > 0) {
            console.log("late fee triggered.");
            fees = lateFeeFlat;
            if (lateFeeBps > 0)
                fees += (totalBalance * lateFeeBps) / BPS_DIVIDER;
        } else {
            console.log("no late fee.");
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

    /**
     * @notice Simulate if a payment _amount is applied towards the current credit line,
     * what is the post-payment unbilledPrincipal,totalDue,feesAndInterestDue.
     * If the amount is more than payoff, it also returns how much to collect for the payoff.
     * When there is no "cron" to process statements, it is possible that the user is late
     * for several payment periods, it also returns the number of periods being late.
     */
    function applyPayment(
        BaseStructs.CreditRecord calldata _cr,
        uint256 _amount
    )
        external
        view
        virtual
        override
        returns (
            uint96 unbilledPrincipal,
            uint64 dueDate,
            uint96 totalDue,
            uint96 feesAndInterestDue,
            uint256 periodsPassed,
            uint256 amountToCollect
        )
    {
        console.log("\n****At the top of applyPayment...");
        _cr.printCreditInfo();

        uint96 payoffAmount;
        (
            periodsPassed,
            feesAndInterestDue,
            totalDue,
            payoffAmount
        ) = getDueInfo(_cr);

        console.log("unbilledPrincipal=", _cr.unbilledPrincipal);
        console.log("principal due=", (totalDue - feesAndInterestDue));

        unbilledPrincipal =
            (_cr.unbilledPrincipal + _cr.totalDue) -
            (totalDue - feesAndInterestDue);
        console.log("unbilledPrincipal=", unbilledPrincipal);

        if (_amount < totalDue) {
            // Insufficient payment. No impact on unbilledPrincipal.
            amountToCollect = _amount;
            totalDue = uint96(totalDue - _amount);
            if (_amount <= feesAndInterestDue) {
                feesAndInterestDue = uint96(feesAndInterestDue - _amount);
            } else {
                feesAndInterestDue = 0;
            }
        } else {
            if (_amount < payoffAmount) {
                console.log(
                    "In applyPayment, enough to cover this payment, not enought to payoff"
                );
                console.log("extra amount:", _amount - totalDue);
                console.log(
                    "before adjusting, unbilledPrincipal:",
                    unbilledPrincipal
                );
                amountToCollect = _amount;
                unbilledPrincipal -= uint96(_amount - totalDue);
                console.log(
                    "after adjusting, unbilledPrincipal:",
                    unbilledPrincipal
                );
            } else {
                // payoff
                console.log("In applyPayment, enough to payoff");
                unbilledPrincipal = 0;
                amountToCollect = payoffAmount;
            }
            totalDue = 0;
            feesAndInterestDue = 0;
        }

        dueDate = uint64(
            _cr.dueDate + periodsPassed * _cr.intervalInDays * SECONDS_IN_A_DAY
        );
        console.log(
            "Before return from applyPayment(), unbilledPrincipal=",
            unbilledPrincipal
        );
        console.log("dueDate=", dueDate);
        console.log("totalDue=", totalDue);
        console.log("feesAndInterestDue=", feesAndInterestDue);
        console.log("periodsPassed=", periodsPassed);
        console.log("amountToCollect=", amountToCollect);
    }

    /**
     * @notice Gets the current total due, fees and interest due, and payoff amount
     * @dev the difference between totalDue and feesAndInterestDue is required principal payment
     * @dev payoffAmount is good until the next statement date. It includes the interest for the
     * entire current/new billing period.
     * @return periodsPassed the number of billing periods has passed since the last statement
     * @return feesAndInterestDue the sum of fees and interest charged in this period
     * @return totalDue amount due in this period, it includes fees, interest, and min principal
     * @return payoffAmount amount for payoff. It includes totalDue, unbilled principal, and
     * interest for the final period
     */
    function getDueInfo(BaseStructs.CreditRecord memory _cr)
        public
        view
        returns (
            uint256 periodsPassed,
            uint96 feesAndInterestDue,
            uint96 totalDue,
            uint96 payoffAmount
        )
    {
        console.log(
            "\nAt the top of getDueInfo, block.timestamp=",
            block.timestamp
        );
        _cr.printCreditInfo();

        // Without a cron job, the user may have missed multiple payments.
        if (block.timestamp < _cr.dueDate) {
            // console.log("Not late");
            payoffAmount = uint96(
                int96(
                    _cr.feesAndInterestDue +
                        _cr.unbilledPrincipal +
                        calcPayoffInterest(_cr)
                ) + _cr.correction
            );
            console.log("Payoff amount=", payoffAmount);
            return (0, _cr.feesAndInterestDue, _cr.totalDue, payoffAmount);
        }

        periodsPassed =
            1 +
            (block.timestamp - _cr.dueDate) /
            (_cr.intervalInDays * SECONDS_IN_A_DAY);

        console.log("\nPeriods passed: ", periodsPassed);

        uint256 i;
        uint256 fees;
        uint256 interest;
        for (i = 0; i < periodsPassed; i++) {
            console.log("\ni=", i);
            if (_cr.totalDue > 0)
                fees = calcLateFee(
                    _cr.dueDate + i * _cr.intervalInDays * SECONDS_IN_A_DAY,
                    _cr.totalDue,
                    _cr.unbilledPrincipal + _cr.totalDue
                );

            console.log("New fees=", fees);
            _cr.unbilledPrincipal += _cr.totalDue;
            console.log(
                "beginning of calculating interest, _cr.unbilledPrincipal=",
                _cr.unbilledPrincipal
            );
            interest =
                (_cr.unbilledPrincipal *
                    _cr.aprInBps *
                    _cr.intervalInDays *
                    SECONDS_IN_A_DAY) /
                SECONDS_IN_A_YEAR /
                BPS_DIVIDER;
            console.log("New interest=", interest);

            // If r.correction is negative, its absolute value is guaranteed to be
            // no more than interest. Thus, the following statement is safe.
            // No correction after the 1st period since no drawdown is allowed
            // when there are outstanding late payments
            if (i == 0) interest = uint256(int256(interest) + _cr.correction);

            uint256 principalToBill = (_cr.unbilledPrincipal *
                minPrincipalRateInBps) / 10000;
            _cr.feesAndInterestDue = uint96(fees + interest);
            _cr.totalDue = uint96(fees + interest + principalToBill);
            _cr.unbilledPrincipal = uint96(
                _cr.unbilledPrincipal - principalToBill
            );
            console.log("principalToBill=", principalToBill);
            console.log("unbilledPrincipal=", _cr.unbilledPrincipal);
            console.log("New totalDue=", _cr.totalDue);
            // todo add logic to make sure totalDue meets the min requirement.
        }

        payoffAmount = uint96(
            _cr.unbilledPrincipal + _cr.totalDue + calcPayoffInterest(_cr)
        );

        // If passed final period, all principal is due
        if (periodsPassed >= _cr.remainingPeriods - 1)
            totalDue = uint96(payoffAmount);

        console.log("Before returning from getDueInfo");
        console.log("periodsPassed=", periodsPassed);
        console.log("feesAndInterestDue=", _cr.feesAndInterestDue);
        console.log("totalDue=", _cr.totalDue);
        console.log("payoffAmount=", payoffAmount);
        return (
            periodsPassed,
            _cr.feesAndInterestDue,
            _cr.totalDue,
            payoffAmount
        );
    }

    // The payoff amount is good until the due date.
    // todo add a test to final interest calculation
    function calcPayoffInterest(BS.CreditRecord memory _cr)
        internal
        view
        returns (uint96 payoffInterest)
    {
        console.log(
            "In calcPayoffInterest, _cr.unbilledPrincipal=",
            _cr.unbilledPrincipal
        );
        console.log("In calcPayoffInterest, _cr.totalDue=", _cr.totalDue);
        console.log(
            "In calcPayoffInterest, _cr.feesAndInterestDue=",
            _cr.totalDue
        );
        payoffInterest = uint96(
            ((_cr.unbilledPrincipal + _cr.totalDue - _cr.feesAndInterestDue) *
                _cr.aprInBps *
                _cr.intervalInDays *
                SECONDS_IN_A_DAY) /
                SECONDS_IN_A_YEAR /
                BPS_DIVIDER
        );
        console.log("payoffInterest=", payoffInterest);
    }

    function calcCorrection(BS.CreditRecord memory _cr, uint256 amount)
        external
        view
        virtual
        override
        returns (uint256 correction)
    {
        console.log("In calcCorrection, block.timestamp=", block.timestamp);
        console.log("_cr.dueDate=", _cr.dueDate);
        console.log("_cr.intervalInDays=", _cr.intervalInDays);
        // rounding to days
        uint256 timePassed = block.timestamp -
            (_cr.dueDate - _cr.intervalInDays * SECONDS_IN_A_DAY);
        uint256 numOfDays = timePassed / SECONDS_IN_A_DAY;
        uint256 remainder = timePassed % SECONDS_IN_A_DAY;
        if (remainder > 43200) numOfDays++;
        console.log("numOfDays = ", numOfDays);

        console.log("\n****IN calcCorrection()****");
        console.log("amount=", amount);
        console.log("_cr.aprInBps=", _cr.aprInBps);
        console.log("numOfDays=", numOfDays);
        console.log("SECONDS_IN_A_DAY=", SECONDS_IN_A_DAY);
        console.log("SECONDS_IN_A_YEAR=", SECONDS_IN_A_YEAR);
        console.log("amount * _cr.aprInBps=", amount * _cr.aprInBps);
        console.log(
            "amount * _cr.aprInBps * numOfDays=",
            amount * _cr.aprInBps * numOfDays
        );
        console.log(
            "amount * _cr.aprInBps * numOfDays * SECONDS_IN_A_DAY=",
            amount * _cr.aprInBps * numOfDays * SECONDS_IN_A_DAY
        );
        console.log(
            "first division",
            (amount * _cr.aprInBps * numOfDays * SECONDS_IN_A_DAY) /
                SECONDS_IN_A_YEAR
        );
        console.log(
            "final division=",
            (amount * _cr.aprInBps * numOfDays * SECONDS_IN_A_DAY) /
                SECONDS_IN_A_YEAR /
                10000
        );
        (amount * _cr.aprInBps * numOfDays * SECONDS_IN_A_DAY) /
            SECONDS_IN_A_YEAR /
            10000;

        return
            (amount * _cr.aprInBps * numOfDays * SECONDS_IN_A_DAY) /
            SECONDS_IN_A_YEAR /
            10000;
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
    //     fees = calcLateFee(_cr.dueDate, _cr.totalDue, _cr.unbilledPrincipal);
    //     if (fees > 0) isLate = true;
    //     interest = (_cr.unbilledPrincipal * _cr.aprInBps) / APR_BPS_DIVIDER;

    //     // final payment
    //     if (_cr.remainingPeriods == 1) {
    //         uint256 due = fees + interest + _cr.unbilledPrincipal;

    //         if (_paymentAmount >= due) {
    //             // Successful payoff. If overpaid, leave overpaid unallocated
    //             markPaid = true;
    //             paidOff = true;
    //             principal = _cr.unbilledPrincipal;
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

    //             if (forPrincipal >= _cr.unbilledPrincipal) {
    //                 // Early payoff
    //                 principal = _cr.unbilledPrincipal;
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
