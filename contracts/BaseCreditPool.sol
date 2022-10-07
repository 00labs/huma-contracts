// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "./interfaces/ICredit.sol";

import "./BasePool.sol";
import "./BaseCreditPoolStorage.sol";
import "./Errors.sol";

import "hardhat/console.sol";

contract BaseCreditPool is BasePool, BaseCreditPoolStorage, ICredit {
    using SafeERC20 for IERC20;
    using BS for BS.CreditRecord;

    event BillRefreshed(address indexed borrower, uint256 newDueDate, address by);
    event CreditApproved(address indexed borrower, address by);
    event CreditInitiated(
        address indexed borrower,
        uint256 creditLimit,
        uint256 aprInBps,
        uint256 payPeriodInSeconds,
        uint256 remainingPeriods,
        bool approved
    );
    event CreditLineChanged(
        address indexed borrower,
        uint256 oldCreditLimit,
        uint256 newCreditLimit
    );
    event CreditLineClosed(address indexed borrower, address by);
    event CreditLineExtended(
        address indexed borrower,
        uint256 numOfPeriods,
        uint256 remainingPeriods,
        address by
    );
    event DefaultTriggered(address indexed borrower, uint256 losses, address by);
    event DrawdownMade(
        address indexed borrower,
        uint256 borrowAmount,
        uint256 netAmountToBorrower,
        address by
    );
    event PaymentMade(address indexed borrower, uint256 amount, address by);

    /**
     * Approves the credit request with the terms on record.
     * @dev only Evaluation Agent can call
     */
    function approveCredit(address borrower) public virtual override {
        _protocolAndPoolOn();
        onlyEAServiceAccount();
        _creditRecordMapping[borrower] = _approveCredit(_creditRecordMapping[borrower]);
        emit CreditApproved(borrower, msg.sender);
    }

    /**
     * @notice changes the limit of the borrower's credit line.
     * @dev The credit line is marked as Deleted if 1) the new credit line is 0 and
     * 2) there is no due or unbilled principals.
     * @param borrower the owner of the credit line
     * @param newCreditLimit the new limit of the line in the unit of pool token
     * @dev only Evaluation Agent can call
     */
    function changeCreditLine(address borrower, uint256 newCreditLimit) public virtual override {
        _protocolAndPoolOn();
        // Borrowing amount needs to be lower than max for the pool.
        _maxCreditLineCheck(newCreditLimit);

        uint256 oldCreditLimit = _creditRecordStaticMapping[borrower].creditLimit;

        // Only EA can increase credit line. Only EA or the borrower can reduce credit line.
        if (newCreditLimit > oldCreditLimit) onlyEAServiceAccount();
        else {
            if (msg.sender != borrower && msg.sender != _humaConfig.eaServiceAccount())
                revert Errors.onlyBorrowerOrEACanReduceCreditLine();
        }

        _creditRecordStaticMapping[borrower].creditLimit = uint96(newCreditLimit);

        // Delete the line when there is no due or unbilled principal
        if (newCreditLimit == 0) {
            // Bring the account current
            BS.CreditRecord memory cr = _updateDueInfo(borrower, true);
            // Note: updated state and remainingPeriods directly instead of the entire cr
            // for contract size consideration
            if (cr.totalDue == 0 && cr.unbilledPrincipal == 0) {
                _creditRecordMapping[borrower].state = BS.CreditState.Deleted;
                emit CreditLineClosed(borrower, msg.sender);
            }
            _creditRecordMapping[borrower].remainingPeriods = 0;
        }
        emit CreditLineChanged(borrower, oldCreditLimit, newCreditLimit);
    }

    /**
     * @notice allows the borrower to borrow against an approved credit line
     * The borrower can borrow and pay back as many times as they would like.
     * @param borrowAmount the amount to borrow
     */
    function drawdown(address borrower, uint256 borrowAmount) external virtual override {
        // Open access to the borrower
        BS.CreditRecord memory cr = _creditRecordMapping[msg.sender];
        _checkDrawdownEligibility(borrower, cr, borrowAmount);
        uint256 netAmountToBorrower = _drawdown(borrower, cr, borrowAmount);
        emit DrawdownMade(borrower, borrowAmount, netAmountToBorrower, msg.sender);
    }

    function extendCreditLineDuration(address borrower, uint256 numOfPeriods)
        external
        virtual
        override
    {
        onlyEAServiceAccount();
        // Although it is not essential to call _updateDueInfo() to extend the credit line duration
        // it is good practice to bring the account current while we update one of the fields.
        // Also, only if we call _updateDueInfo(), we can write proper tests.
        _updateDueInfo(borrower, true);
        _creditRecordMapping[borrower].remainingPeriods += uint16(numOfPeriods);
        emit CreditLineExtended(
            borrower,
            numOfPeriods,
            _creditRecordMapping[borrower].remainingPeriods,
            msg.sender
        );
    }

    /**
     * @notice Borrower makes one payment. If this is the final payment,
     * it automatically triggers the payoff process.
     * @dev "assetNotMatchWithPoolAsset()" reverted when asset address does not match
     * @dev "AMOUNT_TOO_LOW" reverted when the asset is short of the scheduled payment and fees
     */
    function makePayment(address borrower, uint256 amount)
        public
        virtual
        override
        returns (uint256 amountPaid)
    {
        return _makePayment(borrower, amount, false);
    }

    /// Brings the account status current.
    function refreshAccount(address borrower)
        external
        virtual
        override
        returns (BS.CreditRecord memory cr)
    {
        // If the account is defaulted, no need to update the account anymore
        // If the account is ready to be defaulted but not yet, update the account without
        // distributing the income for the upcoming period. Otherwise, update and distribute income
        if (_creditRecordMapping[borrower].state != BS.CreditState.Defaulted) {
            if (isDefaultReady(borrower)) return _updateDueInfo(borrower, false);
            else return _updateDueInfo(borrower, true);
        }
    }

    /**
     * @notice accepts a credit request from msg.sender
     * @param creditLimit the credit line (number of pool token)
     * @param intervalInSeconds duration of a payment cycle, typically 30 days
     * @param numOfPayments number of cycles for the credit line to be valid.
     */
    function requestCredit(
        uint256 creditLimit,
        uint256 intervalInSeconds,
        uint256 numOfPayments
    ) external virtual override {
        // Open access to the borrower. Data validation happens in initiateCredit()
        _initiateCredit(
            msg.sender,
            creditLimit,
            _poolConfig.poolAprInBps(),
            intervalInSeconds,
            numOfPayments,
            false
        );
    }

    /**
     * @notice Triggers the default process
     * @return losses the amount of remaining losses to the pool
     */
    function triggerDefault(address borrower) external virtual override returns (uint256 losses) {
        _protocolAndPoolOn();

        // check to make sure the default grace period has passed.
        BS.CreditRecord memory cr = _creditRecordMapping[borrower];

        if (block.timestamp > cr.dueDate) {
            cr = _updateDueInfo(borrower, false);
        }

        // Check if grace period has exceeded. Please note it takes a full pay period
        // before the account is considered to be late. The time passed should be one pay period
        // plus the grace period.
        if (!isDefaultReady(borrower)) revert Errors.defaultTriggeredTooEarly();

        if (cr.state == BS.CreditState.Defaulted) revert Errors.defaultHasAlreadyBeenTriggered();

        losses = cr.unbilledPrincipal + (cr.totalDue - cr.feesAndInterestDue);

        _creditRecordMapping[borrower].state = BS.CreditState.Defaulted;

        _creditRecordStaticMapping[borrower].defaultAmount = uint96(losses);

        distributeLosses(losses);

        emit DefaultTriggered(borrower, losses, msg.sender);

        return losses;
    }

    function creditRecordMapping(address account) external view returns (BS.CreditRecord memory) {
        return _creditRecordMapping[account];
    }

    function creditRecordStaticMapping(address account)
        external
        view
        returns (BS.CreditRecordStatic memory)
    {
        return _creditRecordStaticMapping[account];
    }

    function isApproved(address borrower) external view virtual override returns (bool) {
        if ((_creditRecordMapping[borrower].state >= BS.CreditState.Approved)) return true;
        else return false;
    }

    function isDefaultReady(address borrower) public view virtual override returns (bool) {
        uint32 intervalInSeconds = _creditRecordStaticMapping[borrower].intervalInSeconds;
        return
            _creditRecordMapping[borrower].missedPeriods * intervalInSeconds >=
                _poolConfig.poolDefaultGracePeriodInSeconds() + intervalInSeconds
                ? true
                : false;
    }

    function isLate(address borrower) external view virtual override returns (bool) {
        return block.timestamp > _creditRecordMapping[borrower].dueDate ? true : false;
    }

    function _approveCredit(BS.CreditRecord memory cr)
        internal
        view
        returns (BS.CreditRecord memory)
    {
        // Note: Special logic. dueDate is normally used to track the next bill due.
        // Before the first drawdown, it is also used to set the deadline for the first
        // drawdown to happen, otherwise, the credit line expires.
        // Decided to use this field in this way to save one field for the struct
        uint256 validPeriod = _poolConfig.creditApprovalExpirationInSeconds();
        if (validPeriod > 0) cr.dueDate = uint64(block.timestamp + validPeriod);

        cr.state = BS.CreditState.Approved;

        return cr;
    }

    function _checkDrawdownEligibility(
        address borrower,
        BS.CreditRecord memory cr,
        uint256 borrowAmount
    ) internal view {
        _protocolAndPoolOn();
        ///msg.sender needs to be the borrower themselvers or the EA.
        if (msg.sender != borrower) onlyEAServiceAccount();

        if (cr.state != BS.CreditState.GoodStanding && cr.state != BS.CreditState.Approved)
            revert Errors.creditLineNotInStateForDrawdown();
        else if (cr.state == BS.CreditState.Approved) {
            // After the credit approval, if the pool has credit expiration for first drawdown,
            // the borrower must complete the first drawdown before the expiration date, which
            // is set in cr.dueDate in approveCredit().
            // note For pools without credit expiration for first drawdown, cr.dueDate is 0
            // before the first drawdown, thus the cr.dueDate > 0 condition in the check
            if (cr.dueDate > 0 && block.timestamp > cr.dueDate)
                revert Errors.creditExpiredDueToFirstDrawdownTooLate();

            if (borrowAmount > _creditRecordStaticMapping[borrower].creditLimit)
                revert Errors.creditLineExceeded();
        }
    }

    /**
     * @notice helper function for drawdown
     * @param borrower the borrower
     * @param borrowAmount the amount to borrow
     */
    function _drawdown(
        address borrower,
        BS.CreditRecord memory cr,
        uint256 borrowAmount
    ) public virtual returns (uint256) {
        if (cr.state == BS.CreditState.Approved) {
            // Flow for first drawdown
            // Update total principal
            _creditRecordMapping[borrower].unbilledPrincipal = uint96(borrowAmount);

            // Generates the first bill
            // Note: the interest is calcuated at the beginning of each pay period
            cr = _updateDueInfo(borrower, true);

            // Set account status in good standing
            cr.state = BS.CreditState.GoodStanding;
        } else {
            // Follow-on drawdown flow
            // Bring the account current.
            if (block.timestamp > cr.dueDate) {
                cr = _updateDueInfo(borrower, true);
                // note check state again
                if (cr.state != BS.CreditState.GoodStanding)
                    revert Errors.creditLineNotInGoodStandingState();
            }

            if (
                borrowAmount >
                (_creditRecordStaticMapping[borrower].creditLimit -
                    cr.unbilledPrincipal -
                    (cr.totalDue - cr.feesAndInterestDue))
            ) revert Errors.creditLineExceeded();

            // note Drawdown is not allowed in the final pay period since the payment due for
            // such drawdown will fall outside of the window of the credit line.
            // note since we bill at the beginning of a period, cr.remainingPeriods is zero
            // in the final period.
            if (cr.remainingPeriods == 0) revert Errors.creditExpiredDueToMaturity();

            // For non-first bill, we do not update the current bill, the interest for the rest of
            // this pay period is accrued in correction and be add to the next bill.
            cr.correction += int96(
                uint96(
                    _feeManager.calcCorrection(
                        cr.dueDate,
                        _creditRecordStaticMapping[borrower].aprInBps,
                        borrowAmount
                    )
                )
            );

            cr.unbilledPrincipal = uint96(cr.unbilledPrincipal + borrowAmount);
        }

        _creditRecordMapping[borrower] = cr;

        (uint256 netAmountToBorrower, uint256 platformFees) = _feeManager.distBorrowingAmount(
            borrowAmount
        );

        if (platformFees > 0) distributeIncome(platformFees);

        // Transfer funds to the _borrower
        _underlyingToken.safeTransfer(borrower, netAmountToBorrower);

        return netAmountToBorrower;
    }

    /**
     * @notice initiation of a credit line
     * @param borrower the address of the borrower
     * @param creditLimit the amount of the liquidity asset that the borrower obtains
     */
    function _initiateCredit(
        address borrower,
        uint256 creditLimit,
        uint256 aprInBps,
        uint256 intervalInSeconds,
        uint256 remainingPeriods,
        bool preApproved
    ) internal virtual {
        if (remainingPeriods == 0) revert Errors.requestedCreditWithZeroDuration();

        _protocolAndPoolOn();
        // Borrowers cannot have two credit lines in one pool. They can request to increase line.
        BS.CreditRecord memory cr = _creditRecordMapping[borrower];

        if (cr.state != BS.CreditState.Deleted) {
            // Temp fix during Goerli test, should revert this logic later.
            // If the user has an existing line, but there is no balance, close the credit line automatically.
            cr = _updateDueInfo(borrower, true);
            if (cr.totalDue == 0 && cr.unbilledPrincipal == 0) {
                cr.state = BS.CreditState.Deleted;
                cr.remainingPeriods = 0;
                emit CreditLineClosed(borrower, msg.sender);
            } else {
                revert Errors.creditLineAlreadyExists();
            }
        }

        // Borrowing amount needs to be lower than max for the pool.
        _maxCreditLineCheck(creditLimit);

        _creditRecordStaticMapping[borrower] = BS.CreditRecordStatic({
            creditLimit: uint96(creditLimit),
            aprInBps: uint16(aprInBps),
            intervalInSeconds: uint32(intervalInSeconds),
            defaultAmount: uint96(0)
        });

        cr.remainingPeriods = uint16(remainingPeriods);
        cr.unbilledPrincipal = 0;
        cr.dueDate = 0;
        cr.correction = 0;
        cr.totalDue = 0;
        cr.feesAndInterestDue = 0;
        cr.missedPeriods = 0;

        if (preApproved) {
            cr = _approveCredit(cr);
            emit CreditApproved(borrower, msg.sender);
        } else cr.state = BS.CreditState.Requested;

        _creditRecordMapping[borrower] = cr;
        emit CreditInitiated(
            borrower,
            creditLimit,
            aprInBps,
            intervalInSeconds,
            remainingPeriods,
            preApproved
        );
    }

    /**
     * @notice Borrower makes one payment. If this is the final payment,
     * it automatically triggers the payoff process.
     * @dev "assetNotMatchWithPoolAsset()" reverted when asset address does not match
     * @dev "AMOUNT_TOO_LOW" reverted when the asset is short of the scheduled payment and fees
     */
    function _makePayment(
        address borrower,
        uint256 amount,
        bool isPaymentReceived
    ) internal returns (uint256 amountPaid) {
        _protocolAndPoolOn();

        // if (amount == 0) revert Errors.zeroAmountProvided();
        require(amount != 0, "zeroAmountProvided()");

        BS.CreditRecord memory cr = _creditRecordMapping[borrower];

        // if (
        //     cr.state == BS.CreditState.Requested ||
        //     cr.state == BS.CreditState.Approved ||
        //     cr.state == BS.CreditState.Deleted
        // ) {
        //     revert Errors.creditLineNotInStateForMakingPayment();
        // }

        require(
            cr.state != BS.CreditState.Requested &&
                cr.state != BS.CreditState.Approved &&
                cr.state != BS.CreditState.Deleted,
            "creditLineNotInStateForMakingPayment()"
        );

        if (block.timestamp > cr.dueDate) {
            // Bring the account current. This is necessary since the account might have been dormant for
            // several cycles.
            cr = _updateDueInfo(borrower, true);
        }
        uint96 payoffAmount = cr.totalDue + cr.unbilledPrincipal;

        // How much will be applied towards principal
        uint256 principalPayment = 0;

        // The amount to be collected from the borrower. When _amount is more than what is needed
        // for payoff, only the payoff amount will be transferred
        uint256 amountToCollect;

        if (amount < cr.totalDue) {
            amountToCollect = amount;
            cr.totalDue = uint96(cr.totalDue - amount);

            if (amount <= cr.feesAndInterestDue) {
                cr.feesAndInterestDue = uint96(cr.feesAndInterestDue - amount);
            } else {
                principalPayment = amount - cr.feesAndInterestDue;
                cr.feesAndInterestDue = 0;
            }
        } else {
            if (amount < payoffAmount) {
                amountToCollect = amount;
                principalPayment = amount - cr.feesAndInterestDue;
                cr.unbilledPrincipal = uint96(cr.unbilledPrincipal - (amount - cr.totalDue));
            } else {
                amountToCollect = payoffAmount;
                principalPayment = cr.unbilledPrincipal + cr.totalDue - cr.feesAndInterestDue;
                cr.unbilledPrincipal = 0;
            }
            cr.feesAndInterestDue = 0;
            cr.totalDue = 0;
            cr.missedPeriods = 0;
            if (cr.state == BS.CreditState.Delayed) cr.state = BS.CreditState.GoodStanding;
        }

        if (principalPayment > 0) {
            // If there is principal payment, calcuate new correction
            cr.correction -= int96(
                uint96(
                    _feeManager.calcCorrection(
                        cr.dueDate,
                        _creditRecordStaticMapping[borrower].aprInBps,
                        principalPayment
                    )
                )
            );
        }

        // For account in default, record the recovered principal for the pool.
        // Note: correction only impacts interest amount, thus no impact on recovered principal
        if (cr.state == BS.CreditState.Defaulted) {
            _totalPoolValue += principalPayment;
            _creditRecordStaticMapping[borrower].defaultAmount -= uint96(principalPayment);

            distributeIncome(amountToCollect - principalPayment);
        }

        if (amountToCollect >= payoffAmount) {
            // the interest for the final pay period has been distributed. When the user pays off
            // early, the interest charge for the remainder of the period will be substracted,
            // thus the income should be reversed.
            reverseIncome(uint256(uint96(0 - cr.correction)));
            amountToCollect = uint256(int256(amountToCollect) + int256(cr.correction));
            cr.correction = 0;

            if (cr.remainingPeriods == 0) cr.state = BS.CreditState.Deleted;
            else cr.state = BS.CreditState.GoodStanding;
        }

        _creditRecordMapping[borrower] = cr;

        if (amountToCollect > 0 && isPaymentReceived == false) {
            // Transfer assets from the _borrower to pool locker
            _underlyingToken.safeTransferFrom(msg.sender, address(this), amountToCollect);
            emit PaymentMade(borrower, amountToCollect, msg.sender);
        }

        return (amountToCollect);
    }

    function _maxCreditLineCheck(uint256 amount) internal view {
        if (amount > _poolConfig.maxCreditLine()) {
            revert Errors.greaterThanMaxCreditLine();
        }
    }

    /**
     * @notice updates CreditRecord for `_borrower` using the most up to date information.
     * @dev this is used in both makePayment() and drawdown() to bring the account current
     * @dev getDueInfo() gets the due information of the most current cycle. This function
     * updates the record in creditRecordMapping for `_borrower`
     */
    function _updateDueInfo(address borrower, bool distributeChargesForLastCycle)
        internal
        virtual
        returns (BS.CreditRecord memory cr)
    {
        cr = _creditRecordMapping[borrower];
        bool alreadyLate = cr.totalDue > 0 ? true : false;

        // Gets the up-to-date due information for the borrower. If the account has been
        // late or dormant for multiple cycles, getDueInfo() will bring it current and
        // return the most up-to-date due information.
        uint256 periodsPassed;
        uint256 newCharges;
        (
            periodsPassed,
            cr.feesAndInterestDue,
            cr.totalDue,
            cr.unbilledPrincipal,
            newCharges
        ) = _feeManager.getDueInfo(cr, _creditRecordStaticMapping[borrower]);

        if (periodsPassed > 0) {
            // Distribute income
            if (distributeChargesForLastCycle) distributeIncome(newCharges);
            else distributeIncome(newCharges - cr.feesAndInterestDue);
            if (cr.dueDate > 0)
                cr.dueDate = uint64(
                    cr.dueDate +
                        periodsPassed *
                        _creditRecordStaticMapping[borrower].intervalInSeconds
                );
            else
                cr.dueDate = uint64(
                    block.timestamp + _creditRecordStaticMapping[borrower].intervalInSeconds
                );

            // Adjusts remainingPeriods, special handling when reached the maturity of the credit line
            if (cr.remainingPeriods > periodsPassed) {
                cr.remainingPeriods = uint16(cr.remainingPeriods - periodsPassed);
            } else {
                cr.remainingPeriods = 0;
            }

            // Sets the right missedPeriods and state for the credit record
            if (alreadyLate) cr.missedPeriods = uint16(cr.missedPeriods + periodsPassed);
            else cr.missedPeriods = 0;

            if (cr.missedPeriods > 0) {
                if (cr.state != BS.CreditState.Defaulted) cr.state = BS.CreditState.Delayed;
            } else cr.state = BS.CreditState.GoodStanding;

            // Correction is used when moving to a new payment cycle, ready for reset.
            // However, correction has not been used if it is still the same cycle, cannot reset
            if (periodsPassed > 0) cr.correction = 0;

            _creditRecordMapping[borrower] = cr;

            emit BillRefreshed(borrower, cr.dueDate, msg.sender);
        }
    }

    /// "Modifier" function that limits access to eaServiceAccount only
    function onlyEAServiceAccount() internal view {
        if (msg.sender != _humaConfig.eaServiceAccount())
            revert Errors.evaluationAgentServiceAccountRequired();
    }
}
