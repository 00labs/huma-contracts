// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

import {ReceivableFactoringPoolStorageV2} from "./ReceivableFactoringPoolStorageV2.sol";
import "./BaseCreditPool.sol";
import {Errors} from "./Errors.sol";

contract ReceivableFactoringPoolV2 is
    BaseCreditPool,
    ReceivableFactoringPoolStorageV2,
    IERC721Receiver
{
    using ERC165Checker for address;
    using SafeERC20 for IERC20;

    event ExtraFundsDispersed(address indexed receiver, uint256 amount);

    function initialize(address poolConfigAddr, address processorAddr) external initializer {
        super._baseInitialize(poolConfigAddr);
        processor = processorAddr;
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
     * @notice After the EA (EvalutionAgent) has approved a factoring, it calls this function
     * to record the approval on chain and mark as factoring as approved, which will enable
     * the borrower to drawdown (borrow) from the approved credit.
     * @param borrower the borrower address
     * @param creditLimit the limit of the credit
     * @param receivableAsset the receivable asset used for this credit
     * @param receivableParam additional parameter of the receivable asset, e.g. NFT tokenid
     * @param receivableAmount amount of the receivable asset
     * @param intervalInDays time interval for each payback in units of days
     * @param remainingPeriods the number of pay periods for this credit
     * @dev Only Evaluation Agents for this contract can call this function.
     */
    function approveCredit(
        address borrower,
        uint256 creditLimit,
        uint256 intervalInDays,
        uint256 remainingPeriods,
        uint256 aprInBps,
        address receivableAsset,
        uint256 receivableParam,
        uint256 receivableAmount
    ) external virtual {
        onlyEAServiceAccount();

        _checkReceivableRequirement(creditLimit, receivableAmount);

        // Populates fields related to receivable
        if (receivableAsset == address(0)) revert Errors.zeroAddressProvided();

        _setReceivableInfo(borrower, receivableAsset, receivableParam, receivableAmount);

        // Pool status and data validation happens within initiate().
        _initiateCredit(borrower, creditLimit, aprInBps, intervalInDays, remainingPeriods, true);
    }

    /**
     * @notice Drawdown function is disabled for this contract intentionally.
     * drawdownWithReceivable() should be used instead.
     */
    function drawdown(
        uint256 /*borrowAmount*/
    ) external virtual override {
        /// Intentional empty implementation to disable this function.
        revert Errors.drawdownFunctionUsedInsteadofDrawdownWithReceivable();
    }

    function validateReceivableAsset(
        address borrower,
        uint256 borrowAmount,
        address receivableAsset,
        uint256 receivableParam
    ) external view virtual {
        if (receivableAsset == address(0)) revert Errors.zeroAddressProvided();
        BS.CreditRecord memory cr = _getCreditRecord(borrower);
        super._checkDrawdownEligibility(borrower, cr, borrowAmount);

        BS.ReceivableInfo memory ri = receivableInfoMapping[borrower];
        assert(ri.receivableAsset != address(0));
        if (receivableAsset != ri.receivableAsset) revert Errors.receivableAssetMismatch();
        if (receivableParam != ri.receivableParam) revert Errors.receivableAssetParamMismatch();
    }

    /**
     * @notice Allows the processor to initiate a drawdown on behalf of a borrower.
     * @param borrower The address of the borrower.
     * @param borrowAmount The amount to be borrowed.
     * @return netAmountToBorrower The net amount to be borrowed after deducting any fees.
     */
    function drawdown4Processor(address borrower, uint256 borrowAmount)
        external
        virtual
        returns (uint256 netAmountToBorrower)
    {
        _onlyProcessor();
        BS.CreditRecord memory cr = _getCreditRecord(borrower);
        netAmountToBorrower = super._drawdown(borrower, cr, borrowAmount);
    }

    /**
     * @notice Allows the processor to record a payment made by the borrower.
     * @param borrower The address of the borrower.
     * @param amount The amount of the payment.
     * @return amountPaid The amount of the payment that was applied to the credit.
     * @return paidoff A boolean indicating whether the credit has been fully paid off.
     */
    function makePayment4Processor(address borrower, uint256 amount)
        external
        virtual
        returns (uint256 amountPaid, bool paidoff)
    {
        _onlyProcessor();
        (amountPaid, paidoff, ) = _makePayment(
            borrower,
            amount,
            BS.PaymentStatus.ReceivedAndVerified
        );
    }

    /**
     * @notice This function is used to settle the credit of a borrower and disburse any remaining funds to them.
     * If the credit has been fully paid off, the `paidoff` variable will be set to true and the function can be
     * called to settle the credit. However, if the credit is still active and the borrower tries to settle before
     * the due date, the function will revert with the error message "settlement too soon".
     * @param borrower The address of the borrower whose credit is being settled.
     * @param amount The amount to be settled.
     * @return amountPaid The amount that was actually paid.
     * @return paidoff A boolean indicating whether the credit has been fully paid off.
     *
     * @dev This function can only be called by the processor address set during contract initialization.
     */
    function settlement4Processor(address borrower, uint256 amount)
        external
        virtual
        returns (uint256 amountPaid, bool paidoff)
    {
        _onlyProcessor();
        (amountPaid, paidoff, ) = _makePayment(
            borrower,
            amount,
            BS.PaymentStatus.ReceivedAndVerified
        );

        if (paidoff) {
            delete receivableInfoMapping[borrower];
            if (amount > amountPaid) _disburseRemainingFunds(borrower, amount - amountPaid);
        } else {
            BS.CreditRecord storage cr = _creditRecordMapping[borrower];
            if (block.timestamp <= cr.dueDate) revert Errors.settlementTooSoon();
            if (cr.state == BS.CreditState.GoodStanding) {
                cr.state = BS.CreditState.Delayed;
                _updateDueInfo(borrower, false, false);
            }
        }
    }

    /**
     * @notice disburse the remaining funds associated with the factoring to the borrower
     * @param receiver receiver of the funds, namely, the borrower
     * @param amount the amount of the dispursement
     */
    function _disburseRemainingFunds(address receiver, uint256 amount) internal {
        _underlyingToken.safeTransfer(receiver, amount);
        emit ExtraFundsDispersed(receiver, amount);
    }

    /**
     * @notice Checks if the receivable provided is able fulfill the receivable requirement
     * for the requested credit line.
     * @param creditLine the credit limit requested
     * @param receivableAmount the value of the receivable
     */
    function _checkReceivableRequirement(uint256 creditLine, uint256 receivableAmount)
        internal
        view
    {
        if (
            receivableAmount <
            (creditLine * _poolConfig.receivableRequiredInBps()) / HUNDRED_PERCENT_IN_BPS
        ) revert Errors.insufficientReceivableAmount();
    }

    /**
     * @notice Sets the receivable asset for the borrower
     */
    function _setReceivableInfo(
        address borrower,
        address receivableAsset,
        uint256 receivableParam,
        uint256 receivableAmount
    ) internal virtual {
        // If receivables are required, they need to be ERC721 or ERC20.
        if (
            receivableAsset != address(0) &&
            !receivableAsset.supportsInterface(type(IERC721).interfaceId)
        ) revert Errors.unsupportedReceivableAsset();

        BS.ReceivableInfo memory ri = BS.ReceivableInfo(
            receivableAsset,
            uint88(receivableAmount),
            receivableParam
        );
        receivableInfoMapping[borrower] = ri;
    }

    function _onlyProcessor() internal view {
        if (msg.sender != processor) revert Errors.notProcessor();
    }
}
