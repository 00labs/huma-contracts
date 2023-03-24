// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

import "./StreamFactoringPoolStorage.sol";
import "../BaseCreditPool.sol";
import "./SuperfluidFeeManager.sol";
import "../Errors.sol";

abstract contract StreamFactoringPool is
    BaseCreditPool,
    StreamFactoringPoolStorage,
    IERC721Receiver
{
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

    function _parseReceivableData(bytes memory data)
        internal
        view
        virtual
        returns (
            address receiver,
            address token,
            address origin,
            uint256 flowrate,
            uint256 durationInSeconds
        );

    /**
     * @notice Withdraw underlying token from receivable nft
     * @param receivableAsset the address of receivable nft contract
     * @param receivableTokenId the receivable nft id
     * @param si the stored stream information of this receivable nft
     */
    function _withdrawFromNFT(
        address receivableAsset,
        uint256 receivableTokenId,
        StreamInfo memory si
    ) internal virtual;

    function _burnNFT(address receivableAsset, uint256 receivableTokenId) internal virtual;

    function _mintNFT(address receivableAsset, bytes calldata data)
        internal
        virtual
        returns (uint256 tokenId);

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

    function drawdownWithAuthorization(
        uint256 borrowAmount,
        address receivableAsset,
        bytes calldata data
    ) external virtual {
        if (receivableAsset == address(0)) revert Errors.zeroAddressProvided();

        (address borrower, uint256 flowrate, uint256 duration) = _validateReceivableAsset(
            borrowAmount,
            receivableAsset,
            data
        );

        BS.CreditRecord memory cr = _getCreditRecord(borrower);
        super._checkDrawdownEligibility(borrower, cr, borrowAmount);

        BS.CreditRecordStatic memory crs = _getCreditRecordStatic(borrower);
        if (duration > crs.intervalInDays * SECONDS_IN_A_DAY) revert Errors.durationTooLong();

        uint256 receivableTokenId = _mintNFT(receivableAsset, data);

        StreamInfo memory streamInfo;
        streamInfo.lastStartTime = block.timestamp;
        streamInfo.endTime = block.timestamp + duration;
        streamInfo.flowrate = flowrate;
        streamInfo.borrower = borrower;

        // Store a keccak256 hash of the receivableAsset and receivableParam on-chain
        _streamInfoMapping[keccak256(abi.encode(receivableAsset, receivableTokenId))] = streamInfo;

        uint256 allowance = _underlyingToken.allowance(borrower, address(this));
        if (allowance < borrowAmount) revert Errors.allowanceTooLow();

        SuperfluidFeeManager(address(_feeManager)).setTempCreditRecordStatic(crs);
        //_creditRecordStaticMapping[borrower].aprInBps = 0;
        uint256 netAmountToBorrower = super._drawdown(borrower, cr, borrowAmount);
        SuperfluidFeeManager(address(_feeManager)).deleteTempCreditRecordStatic();

        emit DrawdownMadeWithReceivable(
            borrower,
            borrowAmount,
            netAmountToBorrower,
            receivableAsset,
            receivableTokenId
        );
    }

    function payoff(address receivableAsset, uint256 receivableTokenId) external virtual {
        StreamInfo memory si = _streamInfoMapping[
            keccak256(abi.encode(receivableAsset, receivableTokenId))
        ];
        if (si.borrower == address(0)) revert Errors.receivableAssetParamMismatch();
        BS.CreditRecord memory cr = _getCreditRecord(si.borrower);

        if (block.timestamp < cr.dueDate) revert Errors.payoffTooSoon();

        uint256 beforeAmount = _underlyingToken.balanceOf(address(this));
        _withdrawFromNFT(receivableAsset, receivableTokenId, si);
        uint256 amountReceived = _underlyingToken.balanceOf(address(this)) - beforeAmount;

        if (amountReceived < cr.unbilledPrincipal) {
            uint256 difference = cr.unbilledPrincipal - amountReceived;
            uint256 allowance = _underlyingToken.allowance(si.borrower, address(this));
            if (allowance > difference) {
                _underlyingToken.safeTransferFrom(si.borrower, address(this), difference);
                amountReceived = cr.unbilledPrincipal;
            } else {
                _underlyingToken.safeTransferFrom(si.borrower, address(this), allowance);
                amountReceived += allowance;
            }
        }

        (uint256 amountPaid, bool paidoff, ) = _makePayment(
            si.borrower,
            amountReceived,
            BS.PaymentStatus.ReceivedAndVerified
        );

        // TODO If paidoff is false, need to transferFrom borrower's allowance or continue to lock NFT?

        _burnNFT(receivableAsset, receivableTokenId);

        delete _receivableInfoMapping[si.borrower];

        if (amountReceived > amountPaid)
            _disburseRemainingFunds(si.borrower, amountReceived - amountPaid);
    }

    function receivableInfoMapping(address account)
        external
        view
        returns (BS.ReceivableInfo memory)
    {
        return _receivableInfoMapping[account];
    }

    function streamInfoMapping(address receivableAsset, uint256 receivableTokenId)
        external
        view
        returns (StreamInfo memory)
    {
        return _streamInfoMapping[keccak256(abi.encode(receivableAsset, receivableTokenId))];
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
        _receivableInfoMapping[borrower] = ri;
    }

    /**
     * @notice Convert amount from tokenIn unit to tokenOut unit, e.g. from usdcx to usdc
     * @param amountIn the amount value expressed in tokenIn unit
     * @param tokenIn the address of tokenIn
     * @param tokenOut the address of tokenOut
     * @return amountOut the amount value expressed in tokenOut unit
     */
    function _convertAmount(
        uint256 amountIn,
        address tokenIn,
        address tokenOut
    ) internal view returns (uint256 amountOut) {
        uint256 decimalsIn = IERC20Metadata(tokenIn).decimals();
        uint256 decimalsOut = IERC20Metadata(tokenOut).decimals();
        if (decimalsIn == decimalsOut) {
            amountOut = amountIn;
        } else {
            amountOut = (amountIn * decimalsOut) / decimalsIn;
        }
    }

    function _validateReceivableAsset(
        uint256 borrowAmount,
        address receivableAsset,
        bytes memory data
    )
        internal
        virtual
        returns (
            address borrower,
            uint256 flowrate,
            uint256 duration
        )
    {
        address token;
        address origin;
        (borrower, token, origin, flowrate, duration) = _parseReceivableData(data);

        BS.ReceivableInfo memory ri = _receivableInfoMapping[borrower];
        assert(ri.receivableAsset != address(0));
        if (receivableAsset != ri.receivableAsset) revert Errors.receivableAssetMismatch();

        uint256 receivableParam = uint256(keccak256(abi.encodePacked(token, origin, borrower)));
        if (ri.receivableParam != receivableParam) revert Errors.receivableAssetParamMismatch();

        uint256 receivableAmount = flowrate * duration;
        receivableAmount = _convertAmount(
            receivableAmount,
            address(token),
            address(_underlyingToken)
        );
        if (receivableAmount < borrowAmount) revert Errors.insufficientReceivableAmount();
    }
}
