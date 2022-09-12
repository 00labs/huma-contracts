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
        initiate(
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
    function initiate(
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

        // todo 8/23 add a test for this check
        // review cr.unbilledPrincipal is not all principal,
        // all principal is cr.unbilledPrincipal + cr.totalDue - cr.feesAndInterestDue
        require(borrowAmount <= cr.creditLimit - cr.unbilledPrincipal, "EXCEEDED_CREDIT_LMIIT");

        // For the first drawdown, set the first due date exactly one billing cycle away
        // For existing credit line, the account might have been dormant for months.
        // Bring the account current by moving forward cycles to allow the due date of
        // the current cycle to be ahead of block.timestamp.
        if (cr.dueDate == 0) {
            cr.dueDate = uint64(block.timestamp + uint256(cr.intervalInDays) * SECONDS_IN_A_DAY);
        } else if (block.timestamp > cr.dueDate) {
            uint256 periodsPassed;
            (periodsPassed, , cr) = _updateDueInfo(borrower);

            require(cr.remainingPeriods > 0, "CREDIT_LINE_EXPIRED");

            // review check if state is delayed? and credit limit again?
        }

        cr.unbilledPrincipal = uint96(uint256(cr.unbilledPrincipal) + borrowAmount);

        // With drawdown, balance increases, interest charge will be higher than it should be,
        // thus record a negative correction to compensate it at the end of the period
        cr.correction -= int96(
            uint96(IFeeManager(_feeManagerAddress).calcCorrection(cr, borrowAmount))
        );

        // Set account status in good standing
        cr.state = BS.CreditState.GoodStanding;

        _creditRecordMapping[borrower] = cr;

        (uint256 amtToBorrower, uint256 protocolFee, uint256 poolIncome) = IFeeManager(
            _feeManagerAddress
        ).distBorrowingAmount(borrowAmount, _humaConfig);

        _accuredIncome._protocolIncome += protocolFee;

        if (poolIncome > 0) distributeIncome(poolIncome);

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
        (uint256 periodsPassed, uint96 payoffAmount, BS.CreditRecord memory cr) = _updateDueInfo(
            borrower
        );

        // How many amount will be applied towards principal
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

        // Correction is used when moving to a new payment cycle, ready for reset.
        // However, correction has not been used if it is still the same cycle, cannot reset
        if (periodsPassed > 0) cr.correction = 0;

        // If there is principal payment, calcuate new correction
        if (principalPayment > 0) {
            cr.correction += int96(
                uint96(IFeeManager(_feeManagerAddress).calcCorrection(cr, principalPayment))
            );
        }

        // `payoffAmount` includes interest for the final billing period.
        // If the user pays off before the end of the cycle, we will subtract
        // the `correction` amount in the transfer.
        if (amountToCollect == payoffAmount) {
            // review this logic seems not right
            // correction is for multiple drawdowns or payments, different from payoff interest

            // todo fix issue if there is any, and at least find a cleaner solution
            amountToCollect = amountToCollect - uint256(uint96(cr.correction));
            cr.correction = 0;
        }

        _creditRecordMapping[borrower] = cr;

        // Distribute income
        // todo need to apply logic for protocol fee
        if (cr.feesAndInterestDue > amountToCollect) distributeIncome(cr.feesAndInterestDue);
        else distributeIncome(amountToCollect);

        if (amountToCollect > 0) {
            // Transfer assets from the _borrower to pool locker
            _underlyingToken.safeTransferFrom(msg.sender, address(this), amountToCollect);
        }
    }

    /**
     * @notice updates CreditRecord for `_borrower` using the most up to date information.
     * @dev this is used in both makePayment() and drawdown() to bring the account current
     * @dev getDueInfo() gets the due information of the most current cycle. This function
     * updates the record in creditRecordMapping for `_borrower`
     */
    function _updateDueInfo(address borrower)
        internal
        virtual
        returns (
            uint256 periodsPassed,
            uint96 payoffAmount,
            BS.CreditRecord memory cr
        )
    {
        cr = _creditRecordMapping[borrower];

        // Gets the up-to-date due information for the borrower. If the account has been
        // late or dormant for multiple cycles, getDueInfo() will bring it current and
        // return the most up-to-date due information.
        (
            periodsPassed,
            cr.feesAndInterestDue,
            cr.totalDue,
            payoffAmount,
            cr.unbilledPrincipal
        ) = IFeeManager(_feeManagerAddress).getDueInfo(cr);

        if (periodsPassed > 0) {
            cr.dueDate = uint64(cr.dueDate + periodsPassed * cr.intervalInDays * SECONDS_IN_A_DAY);
            // Adjusts remainingPeriods, special handling when reached the maturity of the credit line
            if (cr.remainingPeriods > periodsPassed) {
                cr.remainingPeriods = uint16(cr.remainingPeriods - periodsPassed);
            } else {
                cr.remainingPeriods = 0;
                cr.creditLimit = 0;
            }

            // Sets the right missedPeriods and state for the credit record
            if (cr.totalDue > 0) {
                // note the design of missedPeriods is awkward. need to find a simpler solution
                cr.missedPeriods = uint16(cr.missedPeriods + periodsPassed - 1);
                if (cr.missedPeriods > 0) cr.state = BS.CreditState.Delayed;
            } else {
                // When totalDue has been paid, the account is in good standing
                cr.missedPeriods = 0;
                cr.state = BS.CreditState.GoodStanding;
            }
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
        // todo add security check

        // check to make sure the default grace period has passed.
        require(
            block.timestamp >
                _creditRecordMapping[borrower].dueDate +
                    _poolConfig._poolDefaultGracePeriodInSeconds,
            "DEFAULT_TRIGGERED_TOO_EARLY"
        );

        // FeatureRequest: add pool cover logic

        // FeatureRequest: add staking logic

        // Trigger loss process
        // todo double check if we need to include fees into losses
        BS.CreditRecord memory cr = _creditRecordMapping[borrower];
        losses = cr.unbilledPrincipal + cr.totalDue;
        distributeLosses(losses);

        return losses;
    }

    function extendCreditLineDuration(address borrower, uint256 numOfPeriods) external {
        onlyEvaluationAgent();
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
            uint96 creditLimit,
            uint96 totalDue,
            uint64 intervalInDays,
            uint16 aprInBps,
            uint64 dueDate,
            uint96 balance,
            uint16 remainingPeriods,
            BS.CreditState state
        )
    {
        BS.CreditRecord memory cr = _creditRecordMapping[borrower];
        return (
            cr.creditLimit,
            cr.totalDue,
            cr.intervalInDays,
            cr.aprInBps,
            cr.dueDate,
            cr.unbilledPrincipal,
            cr.remainingPeriods,
            cr.state
        );
    }

    function creditRecordMapping(address account) external view returns (BS.CreditRecord memory) {
        return _creditRecordMapping[account];
    }

    // review it is duplicated to isApproved, remove which one?
    function getApprovalStatusForBorrower(address borrower) external view returns (bool) {
        return _creditRecordMapping[borrower].state >= BS.CreditState.Approved;
    }

    function onlyEvaluationAgent() internal view {
        require(msg.sender == _evaluationAgent, "APPROVER_REQUIRED");
    }
}
