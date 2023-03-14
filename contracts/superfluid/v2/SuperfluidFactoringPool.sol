// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {ISuperToken} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import "./StreamFactoringPool.sol";
import "./TradableStream.sol";

contract SuperfluidFactoringPool is StreamFactoringPool {
    function _parseReceivableData(bytes memory data)
        internal
        view
        virtual
        override
        returns (
            address receiver,
            address token,
            address origin,
            uint256 flowrate,
            uint256 durationInSeconds
        )
    {
        int96 _flowrate;
        (receiver, token, origin, _flowrate, durationInSeconds, , , , ) = abi.decode(
            data,
            (address, address, address, int96, uint256, uint256, uint8, bytes32, bytes32)
        );
        if (_flowrate <= 0) revert Errors.invalidFlowrate();
        flowrate = uint256(uint96(_flowrate));
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
        returns (uint256 tokenId)
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
    }
}
