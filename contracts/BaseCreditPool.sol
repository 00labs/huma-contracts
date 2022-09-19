//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC721, IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

import "./interfaces/ICredit.sol";

import "./BasePool.sol";
import "./BaseCreditPoolStorage.sol";

import "hardhat/console.sol";

contract BaseCreditPool is BasePool, BaseCreditPoolStorage, ICredit, IERC721Receiver {
    using SafeERC20 for IERC20;
    using ERC165Checker for address;
    using BS for BS.CreditRecord;

    event DefaultTriggered(address indexed borrower, uint256 losses, address by);
    event PaymentMade(address indexed borrower, uint256 amount, address by);

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
        // todo _internalInDays and _numOfPayments are set by the pool owner.
        // Need to add these two in pool settings and remove them from the constructor parameter.

        // Open access to the borrower
        // Parameter and condition validation happens in initiate()
        initiateCredit(
            msg.sender,
            creditLimit,
            address(0),
            0,
            0,
            _poolConfig._poolAprInBps,
            intervalInDays,
            numOfPayments
        );
    }

    /**
     * @notice initiation of a credit line
     * @param borrower the address of the borrower
     * @param creditLimit the amount of the liquidity asset that the borrower obtains
     * @param receivableAsset the address of the receivable asset.
     * @param receivableAmount the amount of the receivable asset
     */
    function initiateCredit(
        address borrower,
        uint256 creditLimit,
        address receivableAsset,
        uint256 receivableParam,
        uint256 receivableAmount,
        uint256 aprInBps,
        uint256 intervalInDays,
        uint256 remainingPeriods
    ) internal virtual {
        protocolAndPoolOn();
        // Borrowers cannot have two credit lines in one pool. They can request to increase line.
        // todo add a test for this check
        require(_creditRecordMapping[borrower].creditLimit == 0, "CREDIT_LINE_ALREADY_EXIST");

        // Borrowing amount needs to be lower than max for the pool.
        require(_poolConfig._maxCreditLine >= creditLimit, "GREATER_THAN_LIMIT");

        // Populates basic credit info fields
        BS.CreditRecord memory cr;
        cr.creditLimit = uint96(creditLimit);
        // note, leaving balance at the default 0, update balance only after drawdown
        cr.aprInBps = uint16(aprInBps);
        cr.intervalInDays = uint16(intervalInDays);
        cr.remainingPeriods = uint16(remainingPeriods);
        cr.state = BS.CreditState.Requested;
        _creditRecordMapping[borrower] = cr;

        // Populates fields related to receivable
        if (receivableAsset != address(0)) {
            BS.ReceivableInfo memory ci;
            ci.receivableAsset = receivableAsset;
            ci.receivableParam = receivableParam;
            ci.receivableAmount = uint88(receivableAmount);
            _receivableInfoMapping[borrower] = ci;
        }
    }

    /**
     * @notice After the EA (EvalutionAgent) has approved a factoring, it calls this function
     * to record the approval on chain and mark as factoring as approved, which will enable
     * the borrower to drawdown (borrow) from the approved credit.
     * @param borrower the borrower address
     * @param creditAmount the limit of the credit
     * @param receivableAsset the receivable asset used for this credit
     * @param receivableParam additional parameter of the receivable asset, e.g. NFT tokenid
     * @param receivableAmount amount of the receivable asset
     * @param intervalInDays time interval for each payback in units of days
     * @param remainingPeriods the number of pay periods for this credit
     * @dev Only Evaluation Agents for this contract can call this function.
     */
    function recordPreapprovedCredit(
        address borrower,
        uint256 creditAmount,
        address receivableAsset,
        uint256 receivableParam,
        uint256 receivableAmount,
        uint256 intervalInDays,
        uint256 remainingPeriods
    ) external virtual override {
        onlyEvaluationAgent();

        // Pool status and data validation happens within initiate().
        initiateCredit(
            borrower,
            creditAmount,
            receivableAsset,
            receivableParam,
            receivableAmount,
            _poolConfig._poolAprInBps,
            intervalInDays,
            remainingPeriods
        );

        approveCredit(borrower);
    }

    /**
     * Approves the credit request with the terms on record.
     * @dev only Evaluation Agent can call
     */
    function approveCredit(address borrower) public virtual override {
        protocolAndPoolOn();
        onlyEvaluationAgent();

        BS.CreditRecord memory cr = _creditRecordMapping[borrower];
        require(cr.creditLimit <= _poolConfig._maxCreditLine, "GREATER_THAN_LIMIT");

        _creditRecordMapping[borrower].state = BS.CreditState.Approved;
    }

    /**
     * @notice changes the limit of the borrower's credit line
     * @param borrower the owner of the credit line
     * @param newLine the new limit of the line in the unit of pool token
     * @dev only Evaluation Agent can call
     */
    function changeCreditLine(address borrower, uint256 newLine) external {
        protocolAndPoolOn();
        onlyEvaluationAgent();
        // Borrowing amount needs to be lower than max for the pool.
        require(_poolConfig._maxCreditLine >= newLine, "GREATER_THAN_LIMIT");

        _creditRecordMapping[borrower].creditLimit = uint96(newLine);
    }

    /**
     * @notice Invalidate the credit line
     * @dev If the credit limit is 0, we treat the line as deleted.
     */
    function invalidateApprovedCredit(address borrower) external virtual override {
        protocolAndPoolOn();
        onlyEvaluationAgent();
        BS.CreditRecord memory cr = _creditRecordMapping[borrower];
        cr.state = BS.CreditState.Deleted;
        cr.creditLimit = 0;
        _creditRecordMapping[borrower] = cr;
    }

    function isApproved(address borrower) external view virtual override returns (bool) {
        if ((_creditRecordMapping[borrower].state >= BS.CreditState.Approved)) return true;
        else return false;
    }

    /**
     * @notice allows the borrower to borrow against an approved credit line
     * The borrower can borrow and pay back as many times as they would like.
     * @param borrowAmount the amount to borrow
     */
    function drawdown(uint256 borrowAmount) external virtual override {
        // Open access to the borrower
        // Condition validation happens in drawdownWithReceivable()
        return drawdownWithReceivable(msg.sender, borrowAmount, address(0), 0, 0);
    }

    /**
     * @notice allows the borrower to borrow using a receivable / covenant
     * @param borrower the borrower
     * @param borrowAmount the amount to borrow
     * @param receivableAsset the contract address of the receivable
     * @param receivableParam is additional parameter of the receivable asset, such as NFT Tokenid
     * @param receivableAmount the amount of the receivable asset
     */
    function drawdownWithReceivable(
        address borrower,
        uint256 borrowAmount,
        address receivableAsset,
        uint256 receivableParam,
        uint256 receivableAmount
    ) public virtual override {
        protocolAndPoolOn();

        ///msg.sender needs to be the borrower themselvers or the EA.
        if (msg.sender != borrower) onlyEvaluationAgent();

        BS.CreditRecord memory cr = _creditRecordMapping[borrower];

        require(
            cr.state == BS.CreditState.Approved || cr.state == BS.CreditState.GoodStanding,
            "NOT_APPROVED_OR_IN_GOOD_STANDING"
        );

        // Bring the account current by moving forward cycles to allow the due date of
        // the current cycle to be ahead of block.timestamp.
        if (cr.dueDate > 0) {
            if (block.timestamp > cr.dueDate) cr = updateDueInfo(borrower, true);
            require(cr.remainingPeriods > 0, "CREDIT_LINE_EXPIRED");
        }

        // todo 8/23 add a test for this check
        require(
            borrowAmount <=
                (cr.creditLimit - cr.unbilledPrincipal - (cr.totalDue - cr.feesAndInterestDue)),
            "EXCEEDED_CREDIT_LMIIT"
        );

        if (cr.dueDate > 0) {
            // For non-first bill, we will accrue interest for the rest of the pay period
            // and add to the bill of the next cycle.
            cr.correction += int96(
                uint96(IFeeManager(_feeManagerAddress).calcCorrection(cr, borrowAmount))
            );
            cr.unbilledPrincipal = uint96(uint256(cr.unbilledPrincipal) + borrowAmount);
        } else {
            // For the first drawdown, generates the first bill
            cr.unbilledPrincipal = uint96(borrowAmount);
            _creditRecordMapping[borrower] = cr;
            cr = updateDueInfo(borrower, true);
        }

        // Set account status in good standing
        cr.state = BS.CreditState.GoodStanding;

        _creditRecordMapping[borrower] = cr;

        (uint256 amtToBorrower, uint256 platformFees) = IFeeManager(_feeManagerAddress)
            .distBorrowingAmount(borrowAmount);

        if (platformFees > 0) distributeIncome(platformFees);

        // Record the receivable info.
        if (receivableAsset != address(0)) {
            BS.ReceivableInfo memory ci = _receivableInfoMapping[borrower];
            if (ci.receivableAsset != address(0)) {
                // review remove _receivableAsset, _receivableParam and _receivableAmount parameters,
                // use data in cr directly
                require(receivableAsset == ci.receivableAsset, "COLLATERAL_MISMATCH");
            }

            // todo only do this at the first time,
            // Need to add periodForFirstDrawn(), if not completed, the credit line is invalidated.
            if (receivableAsset.supportsInterface(type(IERC721).interfaceId)) {
                IERC721(receivableAsset).safeTransferFrom(
                    borrower,
                    address(this),
                    receivableParam
                );
            } else if (receivableAsset.supportsInterface(type(IERC20).interfaceId)) {
                IERC20(receivableAsset).safeTransferFrom(
                    borrower,
                    address(this),
                    receivableAmount
                );
            } else {
                revert("COLLATERAL_ASSET_NOT_SUPPORTED");
            }

            // todo check to make sure the receivable amount meets the requirements
            ci.receivableAmount = uint88(receivableAmount);
            ci.receivableParam = receivableParam;
            _receivableInfoMapping[borrower] = ci;
        }

        // Transfer funds to the _borrower
        _underlyingToken.safeTransfer(borrower, amtToBorrower);
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
            cr.state = BS.CreditState.GoodStanding;
        }

        // If there is principal payment, calcuate new correction
        if (principalPayment > 0) {
            cr.correction -= int96(
                uint96(IFeeManager(_feeManagerAddress).calcCorrection(cr, principalPayment))
            );
        }

        if (amountToCollect == payoffAmount) {
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
        ) = IFeeManager(_feeManagerAddress).getDueInfo(cr);

        // Distribute income
        if (distributeChargesForLastCycle) distributeIncome(newCharges);
        else distributeIncome(newCharges - cr.feesAndInterestDue);

        if (periodsPassed > 0) {
            if (cr.dueDate > 0)
                cr.dueDate = uint64(
                    cr.dueDate + periodsPassed * cr.intervalInDays * SECONDS_IN_A_DAY
                );
            else cr.dueDate = uint64(block.timestamp + cr.intervalInDays * SECONDS_IN_A_DAY);

            // Adjusts remainingPeriods, special handling when reached the maturity of the credit line
            if (cr.remainingPeriods > periodsPassed) {
                cr.remainingPeriods = uint16(cr.remainingPeriods - periodsPassed);
            } else {
                cr.remainingPeriods = 0;
            }

            // Sets the right missedPeriods and state for the credit record
            if (alreadyLate) cr.missedPeriods = uint16(cr.missedPeriods + periodsPassed);
            else cr.missedPeriods = 0;

            if (cr.missedPeriods > 0) cr.state = BS.CreditState.Delayed;
            else cr.state = BS.CreditState.GoodStanding;

            // Correction is used when moving to a new payment cycle, ready for reset.
            // However, correction has not been used if it is still the same cycle, cannot reset
            if (periodsPassed > 0) cr.correction = 0;

            _creditRecordMapping[borrower] = cr;
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
        require(
            cr.missedPeriods * cr.intervalInDays * SECONDS_IN_A_DAY >=
                _poolConfig._poolDefaultGracePeriodInSeconds +
                    cr.intervalInDays *
                    SECONDS_IN_A_DAY,
            "DEFAULT_TRIGGERED_TOO_EARLY"
        );
        losses = cr.unbilledPrincipal + (cr.totalDue - cr.feesAndInterestDue);
        distributeLosses(losses);

        emit DefaultTriggered(borrower, losses, msg.sender);

        return losses;
    }

    function extendCreditLineDuration(address borrower, uint256 numOfPeriods) external {
        onlyEvaluationAgent();
        // Brings the account current. todo research why this is needed to extend remainingPeriods.
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
        return (
            cr.unbilledPrincipal,
            cr.dueDate,
            cr.correction,
            cr.totalDue,
            cr.feesAndInterestDue,
            cr.missedPeriods,
            cr.remainingPeriods,
            cr.state,
            cr.creditLimit,
            cr.aprInBps,
            cr.intervalInDays
        );
    }

    function creditRecordMapping(address account) external view returns (BS.CreditRecord memory) {
        return _creditRecordMapping[account];
    }

    // review it is duplicated to isApproved, remove which one?
    function getApprovalStatusForBorrower(address borrower) external view returns (bool) {
        return _creditRecordMapping[borrower].state >= BS.CreditState.Approved;
    }

    function isLate(address borrower) external view returns (bool) {
        BS.CreditRecord memory cr = _creditRecordMapping[borrower];
        return block.timestamp > cr.dueDate ? true : false;
    }

    function onlyEvaluationAgent() internal view {
        require(msg.sender == _evaluationAgent, "APPROVER_REQUIRED");
    }
}
