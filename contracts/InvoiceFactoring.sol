//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "./interfaces/IPreaprrovedCredit.sol";
import "./interfaces/IIndirectPayment.sol";

import "./BaseCreditPool.sol";

/**
 * @notice Invoice Factoring is the process for the invoice owner to trade in their invoices
 * for immediate access to portion of the fund tied with the invoices, and receive the remainder
 * minus fees after the invoice is paid in full.
 */
contract InvoiceFactoring is BaseCreditPool, IPreapprovedCredit, IIndirectPayment {
    using BaseStructs for InvoiceFactoring;
    using SafeERC20 for IERC20;

    constructor(
        address _poolToken,
        address _humaConfig,
        address _feeManagerAddress,
        string memory _poolName,
        string memory _hdtName,
        string memory _hdtSymbol
    )
        BaseCreditPool(
            _poolToken,
            _humaConfig,
            _feeManagerAddress,
            _poolName,
            _hdtName,
            _hdtSymbol
        )
    {}

    /**
     * @notice After the EA (EvalutionAgent) has approved a factoring, it calls this function
     * to record the approval on chain and mark as factoring as approved, which will enable
     * the borrower to drawdown (borrow) from the approved credit.
     * @param _borrower the borrower address
     * @param _creditAmount the limit of the credit
     * @param _receivableAsset the receivable asset used for this credit
     * @param _receivableParam additional parameter of the receivable asset, e.g. NFT tokenid
     * @param _receivableAmount amount of the receivable asset
     * @param _intervalInDays time interval for each payback in units of days
     * @param _remainingPeriods the number of pay periods for this credit
     * @dev Only Evaluation Agents for this contract can call this function.
     */
    function recordPreapprovedCredit(
        address _borrower,
        uint256 _creditAmount,
        address _receivableAsset,
        uint256 _receivableParam,
        uint256 _receivableAmount,
        uint256 _intervalInDays,
        uint256 _remainingPeriods
    ) public virtual override {
        onlyEvaluationAgents();

        // Pool status and data validation happens within initiate().
        initiate(
            _borrower,
            _creditAmount,
            _receivableAsset,
            _receivableParam,
            _receivableAmount,
            poolAprInBps,
            _intervalInDays,
            _remainingPeriods
        );

        approveCredit(_borrower);
    }

    /**
     * @notice Borrower makes one payment. If this is the final payment,
     * it automatically triggers the payoff process.
     * @dev "HumaIF:WRONG_ASSET" reverted when asset address does not match
     *
     */
    function onReceivedPayment(
        address borrower,
        address asset,
        uint256 amount
    ) public virtual override {
        // todo Need to  discuss whether to accept payments when the protocol is paused.
        protocolAndPoolOn();
        onlyEvaluationAgents();
        BaseStructs.CreditRecord memory cr = creditRecordMapping[borrower];

        require(asset == address(poolToken), "HumaIF:WRONG_ASSET");

        // todo handle multiple payments.
        // todo decide what to do if the payment amount is insufficient.
        require(amount >= cr.unbilledPrincipal, "HumaIF:AMOUNT_TOO_LOW");

        // todo For security, verify that we have indeeded received the payment.
        // If asset is not received, EA might be compromised. Emit event.

        uint256 lateFee = IFeeManager(feeManagerAddress).calcLateFee(
            cr.dueDate,
            cr.totalDue,
            cr.unbilledPrincipal
        );
        uint256 refundAmount = amount - cr.unbilledPrincipal - lateFee;

        // Sends the remainder to the borrower
        cr.creditLimit = 0;
        cr.unbilledPrincipal = 0;
        cr.remainingPeriods = 0;

        disperseRemainingFunds(borrower, refundAmount);
    }

    /**
     * @notice disperse the remaining funds associated with the factoring to the borrower
     * @param receiver receiver of the funds, namely, the borrower
     * @param amount the amount of the dispersement
     */
    function disperseRemainingFunds(address receiver, uint256 amount) internal {
        poolToken.safeTransfer(receiver, amount);
    }
}
