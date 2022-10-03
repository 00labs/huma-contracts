// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "./interfaces/IReceivable.sol";

import "./BaseCreditPool.sol";
import "./Errors.sol";

/**
 * @notice Receivable Factoring is the process for the receivable owner to trade in their
 * receivable for immediate access to portion of the fund tied with the receivable, and
 * receive the remainder minus fees after the receivable is paid in full.
 */
contract ReceivableFactoringPool is BaseCreditPool, IReceivable {
    using SafeERC20 for IERC20;

    event ReceivedPaymentProcessed(
        address indexed sender,
        address indexed borrower,
        uint256 amount,
        bytes32 paymentIdHash
    );
    event ExtraFundsDispersed(address indexed receiver, uint256 amount);

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

        if (amount > amountPaid) disperseRemainingFunds(borrower, amount - amountPaid);

        emit ReceivedPaymentProcessed(msg.sender, borrower, amount, paymentIdHash);
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
     * @param intervalInSeconds time interval for each payback in units of days
     * @param remainingPeriods the number of pay periods for this credit
     * @dev Only Evaluation Agents for this contract can call this function.
     */
    function recordApprovedCredit(
        address borrower,
        uint256 creditLimit,
        address receivableAsset,
        uint256 receivableParam,
        uint256 receivableAmount,
        uint256 intervalInSeconds,
        uint256 remainingPeriods
    ) external virtual override {
        onlyEAServiceAccount();

        _receivableRequirementCheck(creditLimit, receivableAmount);

        // Populates fields related to receivable
        if (receivableAsset != address(0)) {
            BS.ReceivableInfo memory ri;
            ri.receivableAsset = receivableAsset;
            ri.receivableParam = receivableParam;
            ri.receivableAmount = uint88(receivableAmount);
            _receivableInfoMapping[borrower] = ri;
        }

        // Pool status and data validation happens within initiate().
        _initiateCredit(
            borrower,
            creditLimit,
            _poolConfig.poolAprInBps(),
            intervalInSeconds,
            remainingPeriods,
            true
        );
    }

    /**
     * @notice disperse the remaining funds associated with the factoring to the borrower
     * @param receiver receiver of the funds, namely, the borrower
     * @param amount the amount of the dispersement
     */
    function disperseRemainingFunds(address receiver, uint256 amount) internal {
        _underlyingToken.safeTransfer(receiver, amount);
        emit ExtraFundsDispersed(receiver, amount);
    }

    /// "Modifier" function that limits access to pdsServiceAccount only.
    function onlyPDSServiceAccount() internal view {
        if (msg.sender != HumaConfig(_humaConfig).pdsServiceAccount())
            revert Errors.paymentDetectionServiceAccountRequired();
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
}
