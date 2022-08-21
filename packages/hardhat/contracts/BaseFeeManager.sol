//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IFeeManager.sol";
import "./HumaConfig.sol";
import "./libraries/BaseStructs.sol";
import "hardhat/console.sol";

contract BaseFeeManager is IFeeManager, Ownable {
    // Divider to get monthly interest rate from APR BPS. 10000 * 12
    uint256 public constant BPS_DIVIDER = 10000;
    uint256 public constant APR_BPS_DIVIDER = 120000;

    // Platform fee, charged when a loan is originated
    uint256 public frontLoadingFeeFlat;
    uint256 public frontLoadingFeeBps;
    // Late fee, charged when the borrow is late for a pyament.
    uint256 public lateFeeFlat;
    uint256 public lateFeeBps;

    // fixedPaymentPerOneMillion is a mapping from terms (# of multiple of 30 days) to
    // a mapping from interest rate to payment.
    // It is used for efficiency and gas consideration. We pre-compute the monthly payments for
    // different combination of terms and interest rate off-chain and load it on-chain when
    // the contract is initiazed by the pool owner. At run time, intead of using complicated
    // formula to get monthly payment for every request to a mortgage type of loan on the fly,
    // we will just do a lookup.
    mapping(uint256 => mapping(uint256 => uint256))
        public fixedPaymentPerOneMillion;

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
        uint256 _amount,
        uint256 _dueDate,
        uint256 _lastLateFeeDate,
        uint256 _paymentInterval
    ) public view virtual override returns (uint256 fees) {
        console.log("in calcLateFee, block.timestamp=", block.timestamp);
        console.log("in calcLateFee, dueDate=", _dueDate);
        if (
            block.timestamp > _dueDate &&
            _lastLateFeeDate < (block.timestamp - _paymentInterval)
        ) {
            fees = lateFeeFlat;
            if (lateFeeBps > 0) fees += (_amount * lateFeeBps) / BPS_DIVIDER;
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

    /**
     * @dev Never accept partial payment for minimal due (interest + fees).
     */
    function getNextPayment(
        BaseStructs.CreditRecord memory _cr,
        uint256 _lastLateFeeDate,
        uint256 _paymentAmount
    )
        public
        view
        virtual
        override
        returns (
            uint256 principal,
            uint256 interest,
            uint256 fees,
            bool isLate,
            bool markPaid,
            bool paidOff
        )
    {
        fees = calcLateFee(
            _cr.nextAmountDue,
            _cr.nextDueDate,
            _lastLateFeeDate,
            _cr.paymentIntervalInDays
        );
        console.log("in getNextPayment() fees=", fees);
        if (fees > 0) isLate = true;
        fees += _cr.feesAccrued;
        interest = (_cr.remainingPrincipal * _cr.aprInBps) / APR_BPS_DIVIDER;

        // final payment
        if (_cr.remainingPayments == 1) {
            console.log("_cr.remainingPrincipal=", _cr.remainingPrincipal);
            uint256 due = fees + interest + _cr.remainingPrincipal;
            console.log("due=", due);

            if (_paymentAmount >= due) {
                console.log("cover everything.");
                // Successful payoff. If overpaid, leave overpaid unallocated
                markPaid = true;
                paidOff = true;
                principal = _cr.remainingPrincipal;
            } else {
                console.log("unable to cover due.");
                // Not enough to cover interest and late fees, do not accept any payment
                markPaid = false;
                fees = 0;
                interest = 0;
            }
        } else {
            uint256 due = _cr.nextAmountDue + fees;
            console.log("due=", due);
            console.log("_paymentAmount=", _paymentAmount);

            if (_paymentAmount >= due) {
                console.log("able to cover due");
                markPaid = true;

                // Check if amount is good enough for payoff
                uint256 forPrincipal = _paymentAmount - interest - fees;

                if (forPrincipal >= _cr.remainingPrincipal) {
                    // Early payoff
                    console.log("early payoff");
                    principal = _cr.remainingPrincipal;
                    paidOff = true;
                } else {
                    // Not enough for payoff, apply extra payment for principal
                    principal = forPrincipal;
                }
            } else {
                console.log("unable to cover due.");
                // Not enough to cover the total due, reject the payment.
                markPaid = false;
                fees = 0;
                interest = 0;
            }
        }
        console.log("principal=", principal);
        console.log("interest=", interest);
        console.log("fees=", fees);
        console.log("isLate=", isLate);
        console.log("markPaid=", markPaid);
        console.log("paidOff=", paidOff);
        return (principal, interest, fees, isLate, markPaid, paidOff);
    }

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
}
