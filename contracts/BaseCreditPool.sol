//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC721, IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

import "./interfaces/ICredit.sol";

import "./BasePool.sol";
import "./BaseCreditPoolStorage.sol";
import "./Errors.sol";

import "hardhat/console.sol";

contract BaseCreditPool is BasePool, BaseCreditPoolStorage, ICredit, IERC721Receiver {
    using SafeERC20 for IERC20;
    using ERC165Checker for address;
    using BS for BS.CreditRecord;

    event DefaultTriggered(address indexed borrower, uint256 losses, address by);
    event PaymentMade(address indexed borrower, uint256 amount, address by);
    event DrawdownWithReceivable(address indexed borrower, uint256 amount, address by);
    event BillRefreshed(address indexed borrower, uint256 newDueDate, address by);

    /**
     * @notice accepts a credit request from msg.sender
     * @param creditLimit the credit line (number of pool token)
     * @param intervalInDays duration of a payment cycle, typically 30 days
     * @param numOfPayments number of cycles for the credit line to be valid.
     */
    function requestCredit(
        uint256 creditLimit,
        uint256 intervalInDays,
        uint256 numOfPayments
    ) external virtual override {
        // Open access to the borrower. Data validation happens in initiateCredit()
        initiateCredit(
            msg.sender,
            creditLimit,
            _poolConfig.poolAprInBps(),
            intervalInDays,
            numOfPayments,
            false
        );
    }

    /**
     * @notice initiation of a credit line
     * @param borrower the address of the borrower
     * @param creditLimit the amount of the liquidity asset that the borrower obtains
     */
    function initiateCredit(
        address borrower,
        uint256 creditLimit,
        uint256 aprInBps,
        uint256 intervalInDays,
        uint256 remainingPeriods,
        bool preApproved
    ) internal virtual {
        protocolAndPoolOn();
        // Borrowers cannot have two credit lines in one pool. They can request to increase line.
        // todo add a test for this check
        if (_creditRecordMapping[borrower].state != BS.CreditState.Deleted)
            revert Errors.creditLineAlreadyExists();

        // Borrowing amount needs to be lower than max for the pool.
        _maxCreditLineCheck(creditLimit);

        _creditRecordStaticMapping[borrower] = BS.CreditRecordStatic({
            creditLimit: uint96(creditLimit),
            aprInBps: uint16(aprInBps),
            intervalInDays: uint16(intervalInDays),
            defaultAmount: uint96(0)
        });

        BS.CreditRecord memory cr;

        cr.remainingPeriods = uint16(remainingPeriods);

        if (preApproved) cr = _approveCredit(cr);
        else cr.state = BS.CreditState.Requested;

        _creditRecordMapping[borrower] = cr;
    }

    /**
     * Approves the credit request with the terms on record.
     * @dev only Evaluation Agent can call
     */
    function approveCredit(address borrower) public virtual override {
        protocolAndPoolOn();
        onlyEAServiceAccount();

        _creditRecordMapping[borrower] = _approveCredit(_creditRecordMapping[borrower]);
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

    function _maxCreditLineCheck(uint256 amount) internal view {
        if (amount > _poolConfig.maxCreditLine()) {
            revert Errors.greaterThanMaxCreditLine();
        }
    }

    function _receivableRequirementCheck(uint256 creditLine, uint256 receivableAmount)
        internal
        view
    {
        if (receivableAmount < creditLine * _poolConfig.receivableRequiredInBps())
            revert Errors.insufficientReceivableAmount();
    }

    /**
     * @notice changes the limit of the borrower's credit line
     * @param borrower the owner of the credit line
     * @param newLine the new limit of the line in the unit of pool token
     * @dev only Evaluation Agent can call
     */
    function changeCreditLine(address borrower, uint256 newLine) external {
        protocolAndPoolOn();
        onlyEAServiceAccount();
        // Borrowing amount needs to be lower than max for the pool.
        _maxCreditLineCheck(newLine);

        if (_receivableInfoMapping[borrower].receivableAsset != address(0)) {
            _receivableRequirementCheck(
                newLine,
                _receivableInfoMapping[borrower].receivableAmount
            );
        }

        _creditRecordStaticMapping[borrower].creditLimit = uint96(newLine);
    }

    /**
     * @notice Invalidate the credit line
     * @dev If the credit limit is 0, we treat the line as deleted.
     */
    function invalidateApprovedCredit(address borrower) external virtual override {
        protocolAndPoolOn();
        onlyEAServiceAccount();
        //critical todo need to make sure there is no outstanding balance
        _creditRecordMapping[borrower].state = BS.CreditState.Deleted;
        _creditRecordStaticMapping[borrower].creditLimit = 0;
    }

    function isApproved(address borrower) external view virtual override returns (bool) {
        if ((_creditRecordMapping[borrower].state >= BS.CreditState.Approved)) return true;
        else return false;
    }

    function _checkAccountState(BS.CreditState state) internal pure {
        if (state != BS.CreditState.Approved && state != BS.CreditState.GoodStanding)
            revert Errors.creditLineNotInApprovedOrGoodStandingState();
    }

    /**
     * @notice allows the borrower to borrow against an approved credit line
     * The borrower can borrow and pay back as many times as they would like.
     * @param borrowAmount the amount to borrow
     */
    function drawdown(uint256 borrowAmount) external virtual override {
        // Open access to the borrower
        // Condition validation happens in drawdownWithReceivable()
        return drawdownWithReceivable(msg.sender, borrowAmount, address(0), 0);
    }

    /**
     * @notice allows the borrower to borrow using a receivable / covenant
     * @param borrower the borrower
     * @param borrowAmount the amount to borrow
     * @param receivableAsset the contract address of the receivable
     * @param receivableParam is additional parameter of the receivable asset. For ERC721,
     * it is tokenId; for ERC20, it is the quantity of the asset
     */
    function drawdownWithReceivable(
        address borrower,
        uint256 borrowAmount,
        address receivableAsset,
        uint256 receivableParam
    ) public virtual override {
        protocolAndPoolOn();

        ///msg.sender needs to be the borrower themselvers or the EA.
        if (msg.sender != borrower) onlyEAServiceAccount();

        BS.CreditRecord memory cr = _creditRecordMapping[borrower];

        _checkAccountState(cr.state);

        if (
            borrowAmount >
            (_creditRecordStaticMapping[borrower].creditLimit -
                cr.unbilledPrincipal -
                (cr.totalDue - cr.feesAndInterestDue))
        ) revert Errors.creditLineExceeded();

        bool isFirstDrawdown = cr.state == BS.CreditState.Approved ? true : false;

        if (isFirstDrawdown) {
            // After the credit approval, if the pool has credit expiration for first drawdown,
            // the borrower must complete the first drawdown before the expiration date, which
            // is set in cr.dueDate in approveCredit().
            // note For pools without credit expiration for first drawdown, cr.dueDate is 0
            // before the first drawdown, thus the cr.dueDate > 0 check
            if (cr.dueDate > 0 && block.timestamp > cr.dueDate)
                revert Errors.creditExpiredDueToFirstDrawdownTooLate();

            // Update total principal
            _creditRecordMapping[borrower].unbilledPrincipal = uint96(borrowAmount);

            // Generates the first bill
            cr = updateDueInfo(borrower, true);

            // Transfer receivable assset.
            BS.ReceivableInfo memory ri = _receivableInfoMapping[borrower];
            if (ri.receivableAsset != address(0)) {
                if (receivableAsset != ri.receivableAsset) revert Errors.receivableAssetMismatch();
                if (receivableAsset.supportsInterface(type(IERC721).interfaceId)) {
                    // For ERC721, receivableParam is the tokenId
                    if (ri.receivableParam != receivableParam)
                        revert Errors.receivableAssetParamMismatch();

                    IERC721(receivableAsset).safeTransferFrom(
                        borrower,
                        address(this),
                        receivableParam
                    );
                } else if (receivableAsset.supportsInterface(type(IERC20).interfaceId)) {
                    if (receivableParam < ri.receivableParam)
                        revert Errors.insufficientReceivableAmount();

                    IERC20(receivableAsset).safeTransferFrom(
                        borrower,
                        address(this),
                        receivableParam
                    );
                } else {
                    revert Errors.unsupportedReceivableAsset();
                }
            }
        } else {
            // Bring the account current.
            if (block.timestamp > cr.dueDate) cr = updateDueInfo(borrower, true);

            _checkAccountState(cr.state);

            // note Drawdown is not allowed in the final pay period since the payment due for
            // such drawdown will fall outside of the window of the credit line.
            // note since we bill at the beginning of a period, cr.remainingPeriods is zero
            // in the final period.
            if (cr.remainingPeriods == 0) revert Errors.creditExpiredDueToMaturity();
            //            require(cr.remainingPeriods > 0, "CREDIT_LINE_EXPIRED");

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

        // Set account status in good standing
        cr.state = BS.CreditState.GoodStanding;

        _creditRecordMapping[borrower] = cr;

        (uint256 amtToBorrower, uint256 platformFees) = _feeManager.distBorrowingAmount(
            borrowAmount
        );

        if (platformFees > 0) distributeIncome(platformFees);

        // Transfer funds to the _borrower
        _underlyingToken.safeTransfer(borrower, amtToBorrower);

        emit DrawdownWithReceivable(borrower, amtToBorrower, msg.sender);
    }

    /**
     * @notice Borrower makes one payment. If this is the final payment,
     * it automatically triggers the payoff process.
     * @dev "WRONG_ASSET" reverted when asset address does not match
     * @dev "AMOUNT_TOO_LOW" reverted when the asset is short of the scheduled payment and fees
     */
    function makePayment(
        address borrower,
        address asset,
        uint256 amount
    ) external virtual override {
        protocolAndPoolOn();

        require(asset == address(_underlyingToken), "WRONG_ASSET");
        require(amount > 0, "CANNOT_BE_ZERO_AMOUNT");

        // Bring the account current. This is necessary since the account might have been dormant for
        // several cycles.
        BS.CreditRecord memory cr = updateDueInfo(borrower, true);
        uint96 payoffAmount = cr.totalDue + cr.unbilledPrincipal;
        bool isDefaulted = cr.state == BS.CreditState.Defaulted ? true : false;

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
            if (!isDefaulted) cr.state = BS.CreditState.GoodStanding;
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
            // For account in default, record the recovered principal for the pool.
            // Note: correction only impacts interest amount, thus no impact on recovered principal
            if (isDefaulted) {
                _totalPoolValue += principalPayment;
                _creditRecordStaticMapping[borrower].defaultAmount -= uint96(principalPayment);

                distributeIncome(amount - principalPayment);
            }
        }

        if (amountToCollect == payoffAmount) {
            // Set account state to GoodStanding if paid off even if it was delayed or defaulted.
            cr.state = BS.CreditState.GoodStanding;

            // the interest for the final pay period has been distributed. When the user pays off
            // early, the interest charge for the remainder of the period will be substracted,
            // thus the income should be reversed.
            reverseIncome(uint256(uint96(0 - cr.correction)));
            amountToCollect = uint256(int256(amountToCollect) + int256(cr.correction));
            cr.correction = 0;
        }

        _creditRecordMapping[borrower] = cr;

        if (amountToCollect > 0) {
            // Transfer assets from the _borrower to pool locker
            _underlyingToken.safeTransferFrom(msg.sender, address(this), amountToCollect);
        }

        emit PaymentMade(borrower, amountToCollect, msg.sender);
    }

    /**
     * @notice updates CreditRecord for `_borrower` using the most up to date information.
     * @dev this is used in both makePayment() and drawdown() to bring the account current
     * @dev getDueInfo() gets the due information of the most current cycle. This function
     * updates the record in creditRecordMapping for `_borrower`
     */
    function updateDueInfo(address borrower, bool distributeChargesForLastCycle)
        public
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
                        _creditRecordStaticMapping[borrower].intervalInDays *
                        SECONDS_IN_A_DAY
                );
            else
                cr.dueDate = uint64(
                    block.timestamp +
                        _creditRecordStaticMapping[borrower].intervalInDays *
                        SECONDS_IN_A_DAY
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

    /**
     * @notice Triggers the default process
     * @return losses the amount of remaining losses to the pool after receivable
     * liquidation, pool cover, and staking.
     */
    function triggerDefault(address borrower) external virtual override returns (uint256 losses) {
        protocolAndPoolOn();

        // check to make sure the default grace period has passed.
        BS.CreditRecord memory cr = _creditRecordMapping[borrower];

        if (block.timestamp > cr.dueDate) {
            cr = updateDueInfo(borrower, false);
        }

        // Check if grace period has exceeded. Please note it takes a full pay period
        // before the account is considered to be late. The time passed should be one pay period
        // plus the grace period.
        if (!isDefaultReady(borrower)) revert Errors.defaultTriggeredTooEarly();

        losses = cr.unbilledPrincipal + (cr.totalDue - cr.feesAndInterestDue);

        _creditRecordMapping[borrower].state = BS.CreditState.Defaulted;

        _creditRecordStaticMapping[borrower].defaultAmount = uint96(losses);

        distributeLosses(losses);

        emit DefaultTriggered(borrower, losses, msg.sender);

        return losses;
    }

    function extendCreditLineDuration(address borrower, uint256 numOfPeriods) external {
        onlyEAServiceAccount();
        // Although it is not essential to call updateDueInfo() to extend the credit line duration
        // it is good practice to bring the account current while we update one of the fields.
        // Also, only if we call updateDueInfo(), we can write proper tests.
        updateDueInfo(borrower, false);
        _creditRecordMapping[borrower].remainingPeriods += uint16(numOfPeriods);
    }

    function onERC721Received(
        address, /*operator*/
        address, /*from*/
        uint256, /*tokenId*/
        bytes calldata /*data*/
    ) external virtual override returns (bytes4) {
        return this.onERC721Received.selector;
    }

    /**
     * @notice Gets high-level information about the loan.
     */
    // review remove it to use default getter creditRecordMapping(address)
    function getCreditInformation(address borrower)
        external
        view
        returns (
            uint96 unbilledPrincipal,
            uint64 dueDate,
            int96 correction,
            uint96 totalDue,
            uint96 feesAndInterestDue,
            uint16 missedPeriods,
            uint16 remainingPeriods,
            BS.CreditState state,
            uint96 creditLimit,
            uint16 aprInBps,
            uint16 intervalInDays
        )
    {
        BS.CreditRecord memory cr = _creditRecordMapping[borrower];
        BS.CreditRecordStatic memory crStatic = _creditRecordStaticMapping[borrower];

        return (
            cr.unbilledPrincipal,
            cr.dueDate,
            cr.correction,
            cr.totalDue,
            cr.feesAndInterestDue,
            cr.missedPeriods,
            cr.remainingPeriods,
            cr.state,
            crStatic.creditLimit,
            crStatic.aprInBps,
            crStatic.intervalInDays
        );
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

    function isLate(address borrower) external view returns (bool) {
        return block.timestamp > _creditRecordMapping[borrower].dueDate ? true : false;
    }

    function isDefaultReady(address borrower) public view returns (bool) {
        uint16 intervalInDays = _creditRecordStaticMapping[borrower].intervalInDays;
        return
            _creditRecordMapping[borrower].missedPeriods * intervalInDays * SECONDS_IN_A_DAY >=
                _poolConfig.poolDefaultGracePeriodInSeconds() + intervalInDays * SECONDS_IN_A_DAY
                ? true
                : false;
    }

    function onlyEAServiceAccount() internal view {
        if (msg.sender != _humaConfig.eaServiceAccount())
            revert Errors.evaluationAgentServiceAccountRequired();
    }

    function maxCreditLine() internal view returns (uint256) {
        return _poolConfig.maxCreditLine();
    }

    function onlyPDSServiceAccount() internal view {
        if (msg.sender != HumaConfig(_humaConfig).pdsServiceAccount())
            revert Errors.paymentDetectionServiceAccountRequired();
    }
}
