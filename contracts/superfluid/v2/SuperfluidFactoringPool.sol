// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {ISuperToken} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import "./StreamFactoringPool.sol";
import "./TradableStream.sol";

contract SuperfluidFactoringPool is StreamFactoringPool {
    function _getReceivableData(
        address receivableAsset,
        uint256 receivableTokenId,
        uint256 interval
    )
        internal
        view
        virtual
        override
        returns (
            uint256 receivableParam,
            uint256 receivableAmount,
            StreamInfo memory streamInfo
        )
    {
        (
            address origin,
            address receiver,
            uint256 duration,
            uint256 started,
            ,
            ISuperToken token,
            int96 flowrate
        ) = TradableStream(receivableAsset).getTradableStreamData(receivableTokenId);

        // if (started > 0) revert Errors.isTransferred();
        if (duration > interval) revert Errors.durationTooLong();

        receivableParam = uint256(keccak256(abi.encodePacked(token, origin, receiver)));
        (, receivableAmount) = TradableStream(receivableAsset).remainingValue(receivableTokenId);
        receivableAmount = convertAmount(
            receivableAmount,
            address(token),
            address(_underlyingToken)
        );
        streamInfo.lastStartTime = block.timestamp;
        streamInfo.endTime = block.timestamp + duration;
        streamInfo.flowrate = uint96(flowrate);
    }

    function convertAmount(
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

    function _payOwner(
        address receivableAsset,
        uint256 receivableTokenId,
        StreamInfo memory sr
    ) internal virtual override {
        (, , , , , ISuperToken token, ) = TradableStream(receivableAsset).getTradableStreamData(
            receivableTokenId
        );
        uint256 amount = sr.receivedAmount;
        if (sr.endTime > sr.lastStartTime) {
            amount += (sr.endTime - sr.lastStartTime) * sr.flowrate;
        }

        token.downgrade(amount);
    }

    function _burn(address receivableAsset, uint256 receivableTokenId) internal virtual override {
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

    function _mintNFT(address receivableAsset, bytes calldata data)
        internal
        virtual
        override
        returns (uint256 tokenId, address borrower)
    {
        (
            address receiver,
            address token,
            address origin,
            int96 flowrate,
            uint256 durationInSeconds,
            uint256 expiry,
            uint8 v,
            bytes32 r,
            bytes32 s
        ) = abi.decode(
                data,
                (address, address, address, int96, uint256, uint256, uint8, bytes32, bytes32)
            );

        tokenId = TradableStream(receivableAsset).mintToWithAuthorization(
            receiver,
            token,
            origin,
            flowrate,
            durationInSeconds,
            expiry,
            v,
            r,
            s
        );
        borrower = receiver;
    }
}
