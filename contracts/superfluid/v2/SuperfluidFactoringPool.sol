// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {ISuperToken} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import "./StreamFactoringPool.sol";
import "./TradableStream.sol";

contract SuperfluidFactoringPool is StreamFactoringPoolV2 {
    function getReceivableData(
        address receivableAsset,
        uint256 receivableTokenId,
        uint256 interval
    )
        internal
        view
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
        ) = TradableStreamV2(receivableAsset).getTradableStreamData(receivableTokenId);

        require(started == 0, "This TradableStream is transferred");
        require(duration <= interval, "This TradableStream duration is too long");

        receivableParam = uint256(keccak256(abi.encodePacked(token, origin, receiver)));
        (, receivableAmount) = TradableStreamV2(receivableAsset).remainingValue(receivableTokenId);
        streamInfo.lastStartTime = block.timestamp;
        streamInfo.endTime = block.timestamp + duration;
        streamInfo.flowrate = uint96(flowrate);
    }

    function payOwner(
        address receivableAsset,
        uint256 receivableTokenId,
        StreamInfo memory sr
    ) internal override {
        (, , , , , ISuperToken token, ) = TradableStreamV2(receivableAsset).getTradableStreamData(
            receivableTokenId
        );
        uint256 amount = sr.receivedAmount;
        if (sr.endTime > sr.lastStartTime) {
            amount += (sr.endTime - sr.lastStartTime) * sr.flowrate;
        }

        token.downgrade(amount);
    }

    function burn(address receivableAsset, uint256 receivableTokenId) internal override {
        (
            ,
            address receiver,
            uint256 duration,
            uint256 started,
            ,
            ISuperToken token,
            int96 flowrate
        ) = TradableStreamV2(receivableAsset).getTradableStreamData(receivableTokenId);

        // Refund the extra amount to receiver

        uint256 refundAmount = (block.timestamp - (started + duration)) *
            uint256(uint96(flowrate));
        uint256 balance = token.balanceOf(address(this));
        uint256 sendAmount = balance < refundAmount ? balance : refundAmount;

        if (sendAmount > 0) {
            token.transfer(receiver, sendAmount);
        }

        // check isMature?

        TradableStreamV2(receivableAsset).burn(receivableTokenId);
    }
}
