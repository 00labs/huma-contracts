// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ISuperToken} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {SuperAppBase} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperAppBase.sol";

import "../ReceivableFactoringPoolProcessor.sol";
import "./SuperfluidPoolProcessorStorage.sol";
import "../Errors.sol";
import "./TradableStream.sol";
import "./SuperfluidFeeManager.sol";

contract SuperfluidPoolProcessor is
    ReceivableFactoringPoolProcessor,
    SuperfluidPoolProcessorStorage,
    SuperAppBase
{
    using SafeERC20 for IERC20;

    function initialize(
        address _pool,
        address _host,
        address _cfa
    ) public initializer {
        super.initialize(_pool);
        host = _host;
        cfa = _cfa;
    }

    function mintAndDrawdown(
        address borrower,
        uint256 borrowAmount,
        address receivableAsset,
        bytes calldata mintToData
    ) external virtual {
        // pool.validateReceivableAsset();
        (address underlyingToken, , , address feeManager) = pool.getCoreData();
        BS.CreditRecordStatic memory crs = _validateReceivableAsset(
            borrower,
            borrowAmount,
            receivableAsset,
            mintToData,
            underlyingToken
        );

        uint256 allowance = IERC20(underlyingToken).allowance(borrower, address(this));
        if (allowance < borrowAmount) revert Errors.allowanceTooLow();

        uint256 receivableId = _mintNFT(receivableAsset, mintToData);

        SuperfluidFeeManager(feeManager).setTempCreditRecordStatic(crs);
        // _creditRecordStaticMapping[borrower].aprInBps = 0;
        uint256 netAmountToBorrower = pool.drawdown4Processor(borrower, borrowAmount);
        SuperfluidFeeManager(feeManager).deleteTempCreditRecordStatic();

        emit DrawdownMadeWithReceivable(
            borrower,
            borrowAmount,
            netAmountToBorrower,
            receivableAsset,
            receivableId
        );
    }

    function payoff(address receivableAsset, uint256 receivableTokenId) external virtual {
        StreamInfo memory si = _streamInfoMapping[
            keccak256(abi.encode(receivableAsset, receivableTokenId))
        ];
        if (si.borrower == address(0)) revert Errors.receivableAssetParamMismatch();
        BS.CreditRecord memory cr = pool.creditRecordMapping(si.borrower);

        if (block.timestamp <= cr.dueDate) revert Errors.payoffTooSoon();

        (address underlyingTokenAddr, , , ) = pool.getCoreData();
        IERC20 underlyingToken = IERC20(underlyingTokenAddr);

        uint256 beforeAmount = underlyingToken.balanceOf(address(this));
        _withdrawFromNFT(receivableAsset, receivableTokenId, si);
        uint256 amountReceived = underlyingToken.balanceOf(address(this)) - beforeAmount;
        amountReceived += si.receivedAllowanceAmount;

        if (amountReceived < cr.unbilledPrincipal) {
            uint256 difference = cr.unbilledPrincipal - amountReceived;
            uint256 allowance = underlyingToken.allowance(si.borrower, address(this));
            if (allowance > difference) {
                underlyingToken.safeTransferFrom(si.borrower, address(this), difference);
                amountReceived = cr.unbilledPrincipal;
            } else {
                underlyingToken.safeTransferFrom(si.borrower, address(this), allowance);
                amountReceived += allowance;
            }
        }

        // TODO If paidoff is false, need to transferFrom borrower's allowance

        (uint256 amountPaid, bool paidoff) = pool.makePayment4Processor(
            si.borrower,
            amountReceived
        );

        _burnNFT(receivableAsset, receivableTokenId);
    }

    function afterAgreementUpdated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32 _agreementId,
        bytes calldata, // _agreementData,
        bytes calldata, // _cbdata,
        bytes calldata _ctx
    ) external virtual override returns (bytes memory newCtx) {
        _onlySuperfluid(msg.sender, _agreementClass);
        (, int96 rate, , ) = IConstantFlowAgreementV1(_agreementClass).getFlowByID(
            _superToken,
            _agreementId
        );
        assert(rate > 0);
        uint256 newFlowrate = uint256(uint96(rate));
        _handleFlowChange(_superToken, _agreementId, newFlowrate);
        newCtx = _ctx;
    }

    function afterAgreementTerminated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32 _agreementId,
        bytes calldata, // _agreementData,
        bytes calldata, // _cbdata,
        bytes calldata _ctx
    ) external virtual override returns (bytes memory newCtx) {
        _onlySuperfluid(msg.sender, _agreementClass);
        _handleFlowChange(_superToken, _agreementId, 0);
        newCtx = _ctx;
    }

    function _burnNFT(address receivableAsset, uint256 receivableTokenId) internal virtual {
        (
            ,
            address receiver,
            uint256 duration,
            uint256 started,
            ,
            ISuperToken token,
            int96 flowrate
        ) = TradableStream(receivableAsset).getTradableStreamData(receivableTokenId);

        // Refund the extra amount to receiver

        uint256 refundAmount = (block.timestamp - (started + duration)) *
            uint256(uint96(flowrate));
        uint256 balance = token.balanceOf(address(this));
        uint256 sendAmount = balance < refundAmount ? balance : refundAmount;

        if (sendAmount > 0) {
            token.transfer(receiver, sendAmount);
        }

        // check isMature?

        TradableStream(receivableAsset).burn(receivableTokenId);
    }

    function _withdrawFromNFT(
        address receivableAsset,
        uint256 receivableTokenId,
        StreamInfo memory si
    ) internal virtual {
        (, , , , , ISuperToken token, ) = TradableStream(receivableAsset).getTradableStreamData(
            receivableTokenId
        );
        uint256 amount = si.receivedFlowAmount;
        if (si.endTime > si.lastStartTime) {
            amount += (si.endTime - si.lastStartTime) * si.flowrate;
        }

        token.downgradeTo(address(pool), amount);
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
        address borrower,
        uint256 borrowAmount,
        address receivableAsset,
        bytes memory mintToData,
        address underlyingToken
    ) internal virtual returns (BS.CreditRecordStatic memory crs) {
        (
            address receiver,
            address superToken,
            address origin,
            int96 _flowrate,
            uint256 duration,
            ,
            ,
            ,

        ) = abi.decode(
                mintToData,
                (address, address, address, int96, uint256, uint256, uint8, bytes32, bytes32)
            );

        if (borrower != receiver) revert();

        pool.validateReceivableAsset(
            receiver,
            borrowAmount,
            receivableAsset,
            uint256(keccak256(abi.encodePacked(superToken, origin, receiver)))
        );

        if (_flowrate <= 0) revert Errors.invalidFlowrate();
        uint256 flowrate = uint256(uint96(_flowrate));

        crs = pool.creditRecordStaticMapping(receiver);
        if (duration > crs.intervalInDays * SECONDS_IN_A_DAY) revert Errors.durationTooLong();

        uint256 receivableAmount = flowrate * duration;
        receivableAmount = _convertAmount(receivableAmount, superToken, underlyingToken);
        if (receivableAmount < borrowAmount) revert Errors.insufficientReceivableAmount();
    }

    function _mintNFT(address receivableAsset, bytes memory data)
        internal
        returns (uint256 receivableId)
    {
        (
            address receiver,
            address superToken,
            address origin,
            int96 flowrate,
            uint256 duration,
            uint256 expiry,
            uint8 v,
            bytes32 r,
            bytes32 s
        ) = abi.decode(
                data,
                (address, address, address, int96, uint256, uint256, uint8, bytes32, bytes32)
            );

        receivableId = TradableStream(receivableAsset).mintToWithAuthorization(
            receiver,
            superToken,
            origin,
            flowrate,
            duration,
            expiry,
            v,
            r,
            s
        );

        bytes32 receivableHash = keccak256(abi.encode(receivableAsset, receivableId));

        bytes32 flowId = keccak256(abi.encode(origin, address(this)));
        bytes32 key = keccak256(abi.encode(superToken, flowId));
        _flowMapping[key] = receivableHash;

        StreamInfo memory streamInfo;
        streamInfo.lastStartTime = block.timestamp;
        streamInfo.endTime = block.timestamp + duration;
        streamInfo.flowrate = uint256(uint96(flowrate));
        streamInfo.borrower = receiver;
        // Store a keccak256 hash of the receivableAsset and receivableParam on-chain
        _streamInfoMapping[receivableHash] = streamInfo;
    }

    function _handleFlowChange(
        ISuperToken superToken,
        bytes32 flowId,
        uint256 newFlowrate
    ) internal {
        bytes32 key = keccak256(abi.encode(superToken, flowId));
        key = _flowMapping[key];
        StreamInfo memory si = _streamInfoMapping[key];
        uint256 flowrate = si.flowrate;
        if (newFlowrate == flowrate) return;

        si.receivedFlowAmount = (block.timestamp - si.lastStartTime) * flowrate;
        si.lastStartTime = block.timestamp;
        si.flowrate = newFlowrate;

        if (newFlowrate < si.flowrate) {
            (address underlyingTokenAddr, , , ) = pool.getCoreData();
            IERC20 underlyingToken = IERC20(underlyingTokenAddr);
            uint256 balance = underlyingToken.balanceOf(si.borrower);
            uint256 allowanceAmount = (si.flowrate - newFlowrate) * (si.endTime - block.timestamp);
            if (allowanceAmount > balance) {
                allowanceAmount = balance;
            }

            address poolAddr = address(pool);
            uint256 beforeAmount = underlyingToken.balanceOf(poolAddr);
            underlyingToken.safeTransferFrom(si.borrower, poolAddr, allowanceAmount);
            uint256 allowanceReceived = underlyingToken.balanceOf(poolAddr) - beforeAmount;

            si.receivedAllowanceAmount = allowanceReceived;
        }
        _streamInfoMapping[key] = si;
    }

    function _onlySuperfluid(address hostValue, address cfaValue) internal view {
        if (host != hostValue || cfa != cfaValue) revert();
    }
}
