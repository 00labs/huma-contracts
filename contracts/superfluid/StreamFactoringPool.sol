// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

import "./StreamFactoringPoolStorage.sol";
import "../BaseCreditPool.sol";
import "../interfaces/IReceivableAsset.sol";
import "./StreamFeeManager.sol";

contract StreamFactoringPool is BaseCreditPool, StreamFactoringPoolStorage, IERC721Receiver {
    using ERC165Checker for address;
    using SafeERC20 for IERC20;

    event DrawdownMadeWithReceivable(
        address indexed borrower,
        uint256 borrowAmount,
        uint256 netAmountToBorrower,
        address receivableAsset,
        uint256 receivableTokenId
    );
    event ExtraFundsDispersed(address indexed receiver, uint256 amount);

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

    function drawdownWithReceivable(
        uint256 borrowAmount,
        address receivableAsset,
        uint256 receivableTokenId
    ) external virtual {
        if (receivableAsset == address(0)) revert Errors.zeroAddressProvided();

        address borrower = msg.sender;
        BS.CreditRecord memory cr = _getCreditRecord(borrower);
        super._checkDrawdownEligibility(borrower, cr, borrowAmount);

        _transferReceivableAsset(borrower, borrowAmount, receivableAsset, receivableTokenId);

        StreamFeeManager(address(_feeManager)).setTempCreditRecordStatic(
            _getCreditRecordStatic(borrower)
        );
        _creditRecordStaticMapping[borrower].aprInBps = 0;
        uint256 netAmountToBorrower = super._drawdown(borrower, cr, borrowAmount);
        StreamFeeManager(address(_feeManager)).deleteTempCreditRecordStatic();

        emit DrawdownMadeWithReceivable(
            borrower,
            borrowAmount,
            netAmountToBorrower,
            receivableAsset,
            receivableTokenId
        );
    }

    function payoff(address receivableAsset, uint256 receivableTokenId) external virtual {
        address borrower = _receivableOwnershipMapping[
            keccak256(abi.encode(receivableAsset, receivableTokenId))
        ];
        require(isAbleToPayoff(borrower, receivableAsset, receivableTokenId), "Can't payoff");

        BS.CreditRecord memory cr = _getCreditRecord(borrower);
        uint256 beforeAmount = _underlyingToken.balanceOf(address(this));
        IReceivableAsset(receivableAsset).payOwner(receivableTokenId, cr.unbilledPrincipal);
        uint256 amountReceived = _underlyingToken.balanceOf(address(this)) - beforeAmount;

        (uint256 amountPaid, bool paidoff, ) = _makePayment(
            borrower,
            amountReceived,
            BS.PaymentStatus.ReceivedAndVerified
        );

        require(paidoff, "Received amount isn't enough to payoff");

        IReceivableAsset(receivableAsset).burn(receivableTokenId);

        if (amountReceived > amountPaid)
            _disburseRemainingFunds(borrower, amountReceived - amountPaid);
    }

    function isAbleToPayoff(
        address borrower,
        address receivableAsset,
        uint256 receivableTokenId
    ) public view returns (bool) {
        (, uint256 receivableAmount, ) = IReceivableAsset(receivableAsset).getReceivableData(
            receivableTokenId
        );
        BS.CreditRecord memory cr = _getCreditRecord(borrower);
        return receivableAmount >= cr.unbilledPrincipal;
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
            !receivableAsset.supportsInterface(type(IReceivableAsset).interfaceId)
        ) revert Errors.unsupportedReceivableAsset();

        BS.ReceivableInfo memory ri = BS.ReceivableInfo(
            receivableAsset,
            uint88(receivableAmount),
            receivableParam
        );
        _receivableInfoMapping[borrower] = ri;
    }

    /**
     * @notice Transfers the backing asset for the credit line. The BaseCreditPool does not
     * require backing asset, thus empty implementation. The extended contracts can
     * support various backing assets, such as receivables, ERC721, and ERC20.
     * @param borrower the borrower
     * @param receivableAsset the contract address of the receivable asset.
     * @param receivableTokenId parameter of the receivable asset.
     */
    function _transferReceivableAsset(
        address borrower,
        uint256 borrowAmount,
        address receivableAsset,
        uint256 receivableTokenId
    ) internal virtual {
        // Transfer receivable asset.
        BS.ReceivableInfo memory ri = _receivableInfoMapping[borrower];

        assert(ri.receivableAsset != address(0));

        if (receivableAsset != ri.receivableAsset) revert Errors.receivableAssetMismatch();

        (uint256 receivableParam, uint256 receivableAmount, address token) = IReceivableAsset(
            receivableAsset
        ).getReceivableData(receivableTokenId);

        // For ERC721, receivableParam is the tokenId
        if (ri.receivableParam != receivableParam) revert Errors.receivableAssetParamMismatch();

        if (receivableAmount < borrowAmount) revert Errors.insufficientReceivableAmount();

        // Store a keccak256 hash of the receivableAsset and receivableParam on-chain
        // for lookup by off-chain payment processers
        _receivableOwnershipMapping[
            keccak256(abi.encode(receivableAsset, receivableTokenId))
        ] = borrower;

        IERC721(receivableAsset).safeTransferFrom(borrower, address(this), receivableTokenId);
        uint256 allowance = IERC20(token).allowance(address(this), receivableAsset) +
            receivableAmount;
        IERC20(token).approve(receivableAsset, allowance);
    }
}
