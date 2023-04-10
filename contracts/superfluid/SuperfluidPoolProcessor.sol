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

    event ReadyToSettlement(address receivableAsset, uint256 receivableId, uint256 readyTime);
    event NotGettingEnoughAllowance(
        address receivableAsset,
        uint256 receivableId,
        address borrower
    );

    function initialize(
        address _pool,
        address _host,
        address _cfa,
        address _tradableStream
    ) public initializer {
        super._baseInitialize(_pool);
        host = _host;
        cfa = _cfa;
        tradableStream = _tradableStream;
    }

    /**
     * @notice Mint a new NFT representing a receivable asset, and drawdown funds from the pool to the borrower's account
     * @dev The `receivableAsset` must be the same as the `tradableStream` address stored in the contract
     * @param borrower The address of the borrower who will receive the funds
     * @param borrowAmount The amount of funds to be drawn down from the pool
     * @param receivableAsset The address of the receivable asset used as collateral
     * @param dataForMintTo Additional data to be passed to the `mintTo` function when minting the NFT
     */
    function mintAndDrawdown(
        address borrower,
        uint256 borrowAmount,
        address receivableAsset,
        bytes calldata dataForMintTo
    ) external virtual {
        if (receivableAsset != tradableStream) revert Errors.receivableAssetMismatch();
        (address underlyingToken, , , address feeManager) = pool.getCoreData();
        BS.CreditRecordStatic memory crs = _validateReceivableAsset(
            borrower,
            borrowAmount,
            receivableAsset,
            dataForMintTo,
            underlyingToken
        );

        uint256 allowance = IERC20(underlyingToken).allowance(borrower, address(this));
        if (allowance < borrowAmount) revert Errors.allowanceTooLow();

        uint256 receivableId = _mintNFT(receivableAsset, dataForMintTo);

        uint256 interest = (borrowAmount * crs.aprInBps * crs.intervalInDays * SECONDS_IN_A_DAY) /
            SECONDS_IN_A_YEAR /
            HUNDRED_PERCENT_IN_BPS;
        SuperfluidFeeManager(feeManager).setTempInterest(interest);
        uint256 netAmountToBorrower = pool.drawdown4Processor(borrower, borrowAmount);
        SuperfluidFeeManager(feeManager).deleteTempInterest();

        emit DrawdownMadeWithReceivable(
            borrower,
            borrowAmount,
            netAmountToBorrower,
            receivableAsset,
            receivableId
        );
    }

    /**
     * @notice Withdraws funds from the NFT and settles the receivable asset.
     * @dev It can be called for the first time only when
     *          a. Flow is terminated(flow rate is 0) and the credit line can be paid off
     *          b. The first due date has expired.
     *      It should pay off the credit line or change its state to delayed. It can be called repeatedly
     *      in the latter case(delayed state).
     *      It should be called to delete streamInfo and burn TradableStream NFT if the borrower paid off
     *      a credit line manually by calling makePaymenet function.
     * @param receivableAsset The address of the receivable asset used as collateral.
     * @param receivableId The ID of the NFT representing the receivable asset.
     */
    function settlement(address receivableAsset, uint256 receivableId) external virtual {
        if (receivableAsset != tradableStream) revert Errors.receivableAssetMismatch();

        StreamInfo memory si = _streamInfoMapping[receivableId];
        if (si.borrower == address(0)) revert Errors.receivableAssetParamMismatch();
        if (block.timestamp <= si.endTime && si.flowrate > 0) revert Errors.settlementTooSoon();
        BS.CreditRecord memory cr = pool.creditRecordMapping(si.borrower);

        (address underlyingTokenAddr, , , ) = pool.getCoreData();
        IERC20 underlyingToken = IERC20(underlyingTokenAddr);

        address poolAddr = address(pool);
        uint256 beforeAmount = underlyingToken.balanceOf(poolAddr);
        _withdrawFromNFT(receivableAsset, receivableId, si);
        uint256 amountReceived = underlyingToken.balanceOf(poolAddr) - beforeAmount;

        if (amountReceived < cr.totalDue) {
            uint256 difference = cr.totalDue - amountReceived;
            uint256 received = _transferFromAccount(
                underlyingToken,
                si.borrower,
                poolAddr,
                difference
            );
            amountReceived += received;
        }

        bool paidoff;
        if (amountReceived > 0) {
            (, paidoff) = pool.settlement4Processor(si.borrower, amountReceived);
        }

        if (cr.totalDue == 0) {
            // This branch is only for the case when user paid off by pool.makePayment function manually
            // after the loan is delayed
            paidoff = true;
        }

        if (paidoff) {
            delete _streamInfoMapping[receivableId];
            _burnNFT(receivableAsset, receivableId);
        }
    }

    /**
     * @notice Try to transfer the borrower's allowance and make payment
     * @dev It can be called only when
     *          a. Flow is terminated(flow rate is 0)
     *          b. The settlement function has not be called(credit line state is GoodStanding)
     * @param receivableAsset The address of the receivable asset used as collateral.
     * @param receivableId The ID of the NFT representing the receivable asset.
     */
    function tryTransferAllowance(address receivableAsset, uint256 receivableId) external {
        if (receivableAsset != tradableStream) revert Errors.receivableAssetMismatch();
        StreamInfo memory si = _streamInfoMapping[receivableId];
        if (si.flowrate != 0) revert Errors.invalidFlowrate();
        BS.CreditRecord memory cr = pool.creditRecordMapping(si.borrower);
        if (cr.state > BS.CreditState.GoodStanding)
            revert Errors.creditLineNotInGoodStandingState();

        uint256 amount = si.receivedFlowAmount;
        (address underlyingTokenAddr, , , ) = pool.getCoreData();
        IERC20 underlyingToken = IERC20(underlyingTokenAddr);
        if (amount < cr.totalDue) {
            uint256 diff = cr.totalDue - amount;
            uint256 received = _transferFromAccount(
                underlyingToken,
                si.borrower,
                address(pool),
                diff
            );

            if (received > 0) {
                pool.makePayment4Processor(si.borrower, received);
                if (received >= diff) {
                    emit ReadyToSettlement(tradableStream, receivableId, block.timestamp);
                }
            }
        }
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
        _handleFlowChange(_superToken, _agreementId, uint96(rate));
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

    function streamInfoMapping(uint256 receivableId) external view returns (StreamInfo memory) {
        return _streamInfoMapping[receivableId];
    }

    function _burnNFT(address receivableAsset, uint256 receivableId) internal virtual {
        (
            ,
            address receiver,
            uint256 duration,
            uint256 started,
            ,
            ISuperToken token,
            int96 flowrate
        ) = TradableStream(receivableAsset).getTradableStreamData(receivableId);

        if (block.timestamp > started + duration && flowrate > 0) {
            // Refund the extra amount to receiver
            // TODO move this logic to TradableStream

            uint256 refundAmount = (block.timestamp - (started + duration)) *
                uint256(uint96(flowrate));
            uint256 balance = token.balanceOf(address(this));
            uint256 sendAmount = balance < refundAmount ? balance : refundAmount;
            if (sendAmount > 0) {
                token.transfer(receiver, sendAmount);
            }
        }

        TradableStream(receivableAsset).burn(receivableId);
    }

    function _withdrawFromNFT(
        address receivableAsset,
        uint256 receivableId,
        StreamInfo memory si
    ) internal virtual {
        (, , , , , ISuperToken token, ) = TradableStream(receivableAsset).getTradableStreamData(
            receivableId
        );
        uint256 amount = si.receivedFlowAmount;
        if (si.endTime > si.lastStartTime) {
            amount += (si.endTime - si.lastStartTime) * si.flowrate;
        }

        if (amount > 0) {
            token.downgradeTo(address(pool), amount);

            si.lastStartTime = si.endTime;
            si.receivedFlowAmount = 0;
            _streamInfoMapping[receivableId] = si;
        }
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
        bytes memory dataForMintTo,
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
                dataForMintTo,
                (address, address, address, int96, uint256, uint256, uint8, bytes32, bytes32)
            );

        if (borrower != receiver) revert Errors.borrowerMismatch();

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

        bytes32 flowId = keccak256(abi.encode(origin, address(this)));
        bytes32 key = keccak256(abi.encode(superToken, flowId));
        _flowMapping[key] = receivableId;

        StreamInfo memory streamInfo;
        streamInfo.lastStartTime = uint64(block.timestamp);
        streamInfo.endTime = uint64(block.timestamp + duration);
        streamInfo.flowrate = uint96(flowrate);
        streamInfo.borrower = receiver;
        // Store a keccak256 hash of the receivableAsset and receivableParam on-chain
        _streamInfoMapping[receivableId] = streamInfo;
    }

    function _transferFromAccount(
        IERC20 token,
        address from,
        address to,
        uint256 amount
    ) internal returns (uint256 transferredAmount) {
        uint256 allowance = token.allowance(from, address(this));
        uint256 balance = token.balanceOf(from);
        transferredAmount = amount;
        if (transferredAmount > allowance) transferredAmount = allowance;
        if (transferredAmount > balance) transferredAmount = balance;
        if (transferredAmount > 0) token.safeTransferFrom(from, to, transferredAmount);
    }

    function _handleFlowChange(
        ISuperToken superToken,
        bytes32 flowId,
        uint96 newFlowrate
    ) internal {
        bytes32 key = keccak256(abi.encode(superToken, flowId));
        uint256 receivableId = _flowMapping[key];
        StreamInfo memory si = _streamInfoMapping[receivableId];
        uint96 flowrate = si.flowrate;
        if (newFlowrate == flowrate) return;

        si.receivedFlowAmount = (block.timestamp - si.lastStartTime) * flowrate;
        si.lastStartTime = uint64(block.timestamp);

        if (newFlowrate < flowrate) {
            (address underlyingTokenAddr, , , ) = pool.getCoreData();
            IERC20 underlyingToken = IERC20(underlyingTokenAddr);
            uint256 difference = (flowrate - newFlowrate) * (si.endTime - block.timestamp);
            uint256 received = _transferFromAccount(
                underlyingToken,
                si.borrower,
                address(pool),
                difference
            );

            if (received > 0) {
                pool.makePayment4Processor(si.borrower, received);
            }

            if (newFlowrate == 0) {
                // flow is terminated
                if (received < difference) {
                    // didn't receive enough amount
                    // send a event to trigger tryTransferFromBorrower function periodically

                    emit NotGettingEnoughAllowance(tradableStream, receivableId, si.borrower);
                } else {
                    // received enough amount from borrower's allowance
                    // TODO call settlement
                    // option1 update cr.dueDate to block.timestamp + 1, but it can't refund the interest of flowed amount
                    // option2 send a event to notify payoff is ready to be called
                    // option3 call payoff here, but it is heavy and there is a limit to burn NFT}

                    emit ReadyToSettlement(tradableStream, receivableId, block.timestamp);
                }
            } else {
                // flow is decreased
                // revert();
                // if (received < difference) {
                //     // didin't receive enough amount
                //     uint256 diff = difference - received;
                //     // TODO increase duration
                //     // option1
                //     //   a. calculate new extended seconds(Xd), Xd * flowrate = Xd * interest_rate + diff
                //     //      interest_rate = loan amount * apr / SECONDS_IN_A_YEAR / HUNDRED_PERCENT_IN_BPS
                //     //      Xd = diff / (flowrate - interest_rate)
                //     //   b. TradableStream(tradableStream).increaseDuration(Xd)
                //     //   c. update cr.dueDate and si.endTime
                //     // option2
                //     //   extend duration in payoff function, treat it as a kind of delay and charge interest
                //     //   this way will only extend duration of TradableStream, and keep a fixed interval of loan
                // }
            }
        } else {
            // flow is increased
            // revert();
            // TODO decrease duration
            // option1
            //   calculate shortened seconds, and do the opposited actions of above
            // option2
            //   send a event and notify the new trigger time of payoff, payoff function handles correction and burn
            //   this way doesn't need to call TradableStream.decreaseDuration and update cr.dueDate
        }

        si.flowrate = newFlowrate;
        _streamInfoMapping[receivableId] = si;
    }

    // function _extendTradableStreamDuration(StreamInfo memory si, uint256 receivableId) internal {
    //     BS.CreditRecord memory cr = pool.creditRecordMapping(si.borrower);
    //     uint256 dueDate = cr.dueDate;
    //     uint256 endTime = si.endTime;
    //     uint256 flowrate = si.flowrate;
    //     uint256 totalDue = cr.totalDue;
    //     if (dueDate > endTime) {
    //         uint256 newEndTime = dueDate;
    //         if ((dueDate - endTime) * flowrate <= totalDue) {
    //             newEndTime = dueDate;
    //         } else {
    //             newEndTime = endTime + totalDue / flowrate + 1;
    //             emit ReadyToSettlement(tradableStream, receivableId, newEndTime);
    //         }
    //         TradableStream(tradableStream).increaseDuration(receivableId, newEndTime - endTime);
    //         si.lastStartTime = endTime;
    //         si.endTime = newEndTime;
    //         si.receivedFlowAmount = 0;
    //         _streamInfoMapping[receivableId] = si;
    //     }
    // }

    function _onlySuperfluid(address hostValue, address cfaValue) internal view {
        if (host != hostValue || cfa != cfaValue) revert Errors.invalidFlowrate();
    }
}
