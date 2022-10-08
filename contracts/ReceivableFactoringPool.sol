// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {IERC721, IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

import "./interfaces/IReceivable.sol";
import "./BaseCreditPool.sol";
import "./ReceivableFactoringPoolStorage.sol";

import "./Errors.sol";

/**
 * @notice Receivable Factoring is the process for the receivable owner to trade in their
 * receivable for immediate access to portion of the fund tied with the receivable, and
 * receive the remainder minus fees after the receivable is paid in full.
 */
contract ReceivableFactoringPool is
    BaseCreditPool,
    ReceivableFactoringPoolStorage,
    IReceivable,
    IERC721Receiver
{
    using SafeERC20 for IERC20;
    using ERC165Checker for address;

    event ReceivedPaymentProcessed(
        address indexed sender,
        address indexed borrower,
        uint256 amount,
        bytes32 paymentIdHash
    );
    event ExtraFundsDispersed(address indexed receiver, uint256 amount);
    event PaymentInvalidated(bytes32 paymentIdHash);
    event DrawdownMadeWithReceivable(
        address indexed borrower,
        uint256 borrowAmount,
        uint256 netAmountToBorrower,
        address by,
        address receivableAsset,
        uint256 receivableParam
    );

    /**
     * @notice changes the limit of the borrower's credit line.
     * @dev The credit line is marked as Deleted if 1) the new credit line is 0 and
     * 2) there is no due or unbilled principals.
     * @param borrower the owner of the credit line
     * @param newCreditLimit the new limit of the line in the unit of pool token
     * @dev only Evaluation Agent can call
     */
    function changeCreditLine(address borrower, uint256 newCreditLimit) public virtual override {
        _checkReceivableAssetFor(borrower, newCreditLimit);
        super.changeCreditLine(borrower, newCreditLimit);
    }

    /**
     * @notice Drawdown function is disabled for this contract intentionally.
     * drawdownWithReceivable() should be used instead.
     */
    function drawdown(address borrower, uint256 borrowAmount) external virtual override {
        /// Intentional empty implementation to disable this function.
    }

    //      * @param receivableAsset the contract address of the receivable
    //  * @param receivableParam is additional parameter of the receivable asset. For ERC721,
    //  * it is tokenId; for ERC20, it is the quantity of the asset

    function drawdownWithReceivable(
        address borrower,
        uint256 borrowAmount,
        address receivableAsset,
        uint256 receivableParam
    ) external virtual override {
        BS.CreditRecord memory cr = _creditRecordMapping[msg.sender];
        super._checkDrawdownEligibility(borrower, cr, borrowAmount);

        if (cr.state == BS.CreditState.Approved)
            _transferReceivableAsset(borrower, receivableAsset, receivableParam);

        uint256 netAmountToBorrower = super._drawdown(borrower, cr, borrowAmount);
        emit DrawdownMadeWithReceivable(
            borrower,
            borrowAmount,
            netAmountToBorrower,
            msg.sender,
            receivableAsset,
            receivableParam
        );
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
     * @notice Borrower makes one payment. If this is the final payment,
     * it automatically triggers the payoff process.
     * @dev Reverted with assetNotMatchWithPoolAsset() when asset address does not match
     *
     */
    function onReceivedPayment(
        address borrower,
        uint256 amount,
        bytes32 paymentIdHash
    ) external virtual override {
        _protocolAndPoolOn();
        onlyPDSServiceAccount();

        // Makes sure no repeated processing of a payment.
        if (_processedPaymentIds[paymentIdHash] == true) revert Errors.paymentAlreadyProcessed();
        
        _processedPaymentIds[paymentIdHash] = true;

        uint256 amountPaid = _makePayment(borrower, amount, true);

        if (amount > amountPaid) _disperseRemainingFunds(borrower, amount - amountPaid);

        emit ReceivedPaymentProcessed(msg.sender, borrower, amount, paymentIdHash);
    }

    /**
     * @notice Used by the PDS service account to invalidate a payment and stop automatic
     * processing services like subgraph from ingesting this payment.
     * This will be called manually by the pool owner in extremely rare situations
     * when an SDK bug or payment reaches an invalid state and bookkeeping must be
     * manually made by the pool owners.
     */
    function markPaymentInvalid(bytes32 paymentIdHash) external {
        onlyPDSServiceAccount();

        _processedPaymentIds[paymentIdHash] = true;
        emit PaymentInvalidated(paymentIdHash);
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
    function recordApprovedCredit(
        address borrower,
        uint256 creditLimit,
        address receivableAsset,
        uint256 receivableParam,
        uint256 receivableAmount,
        uint256 intervalInDays,
        uint256 remainingPeriods,
        uint256 aprInBps
    ) external virtual override {
        onlyEAServiceAccount();

        _checkReceivableRequirement(creditLimit, receivableAmount);

        // Populates fields related to receivable
        if (receivableAsset != address(0)) {
            BS.ReceivableInfo memory ri;
            ri.receivableAsset = receivableAsset;
            ri.receivableParam = receivableParam;
            ri.receivableAmount = uint88(receivableAmount);
            _receivableInfoMapping[borrower] = ri;
        }

        // Pool status and data validation happens within initiate().
        _initiateCredit(borrower, creditLimit, aprInBps, intervalInDays, remainingPeriods, true);
    }

    function isPaymentProcessed(bytes32 paymentIdHash)
        external
        view
        virtual
        override
        returns (bool)
    {
        return _processedPaymentIds[paymentIdHash];
    }

    function receivableInfoMapping(address account)
        external
        view
        returns (BS.ReceivableInfo memory)
    {
        return _receivableInfoMapping[account];
    }

    function receivableOwnershipMapping(bytes32 receivableHash) external view returns (address) {
        return _receivableOwnershipMapping[receivableHash];
    }

    /**
     * @notice Checks if the borrower has enough receivable to back the requested credit line.
     * @param borrower the borrower addrescredit limit requested
     * @param newCreditLimit the credit limit requested
     */
    function _checkReceivableAssetFor(address borrower, uint256 newCreditLimit)
        internal
        view
        virtual
    {
        // Checks to make sure the receivable value satisfies the requirement
        if (_receivableInfoMapping[borrower].receivableAsset != address(0)) {
            _checkReceivableRequirement(
                newCreditLimit,
                _receivableInfoMapping[borrower].receivableAmount
            );
        }
    }

    /**
     * @notice disperse the remaining funds associated with the factoring to the borrower
     * @param receiver receiver of the funds, namely, the borrower
     * @param amount the amount of the dispersement
     */
    function _disperseRemainingFunds(address receiver, uint256 amount) internal {
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
     * @notice Transfers the backing asset for the credit line. The BaseCreditPool does not
     * require backing asset, thus empty implementation. The extended contracts can
     * support various backing assets, such as receivables, ERC721, and ERC20.
     * @param borrower the borrower
     * @param receivableAsset the contract address of the receivable asset.
     * @param receivableParam parameter of the receivable asset.
     */
    function _transferReceivableAsset(
        address borrower,
        address receivableAsset,
        uint256 receivableParam
    ) internal virtual {
        // Transfer receivable assset.
        BS.ReceivableInfo memory ri = _receivableInfoMapping[borrower];
        if (ri.receivableAsset != address(0)) {
            if (receivableAsset != ri.receivableAsset) revert Errors.receivableAssetMismatch();
            if (receivableAsset.supportsInterface(type(IERC721).interfaceId)) {
                // Store a keccak256 hash of the receivableAsset and receivableParam on-chain
                // for lookup by off-chain payment processers
                _receivableOwnershipMapping[
                    keccak256(abi.encode(receivableAsset, receivableParam))
                ] = borrower;

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

                IERC20(receivableAsset).safeTransferFrom(borrower, address(this), receivableParam);
            } else {
                revert Errors.unsupportedReceivableAsset();
            }
        }
    }

    /// "Modifier" function that limits access to pdsServiceAccount only.
    function onlyPDSServiceAccount() internal view {
        if (msg.sender != HumaConfig(_humaConfig).pdsServiceAccount())
            revert Errors.paymentDetectionServiceAccountRequired();
    }
}
