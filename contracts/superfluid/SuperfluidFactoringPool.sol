// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {ISuperToken} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {SuperAppBase} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperAppBase.sol";

import "./StreamFactoringPool.sol";
import "./TradableStream.sol";
import "./SuperfluidPoolConfig.sol";
import "./SuperfluidFactoringPoolStorage.sol";

contract SuperfluidFactoringPool is
    StreamFactoringPool,
    SuperfluidFactoringPoolStorage,
    SuperAppBase
{
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

        si.receivedAmount = (block.timestamp - si.lastStartTime) * flowrate;
        si.lastStartTime = block.timestamp;
        si.flowrate = newFlowrate;
        _streamInfoMapping[key] = si;

        if (newFlowrate < si.flowrate) {
            // TODO deduct some money from allowance
        }
    }

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

    function _withdrawFromNFT(
        address receivableAsset,
        uint256 receivableTokenId,
        StreamInfo memory si
    ) internal virtual override {
        (, , , , , ISuperToken token, ) = TradableStream(receivableAsset).getTradableStreamData(
            receivableTokenId
        );
        uint256 amount = si.receivedAmount;
        if (si.endTime > si.lastStartTime) {
            amount += (si.endTime - si.lastStartTime) * si.flowrate;
        }

        token.downgrade(amount);
    }

    function _burnNFT(address receivableAsset, uint256 receivableTokenId)
        internal
        virtual
        override
    {
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
            address superToken,
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
            superToken,
            origin,
            flowrate,
            durationInSeconds,
            expiry,
            v,
            r,
            s
        );

        bytes32 flowId = keccak256(abi.encode(origin, address(this)));
        bytes32 key = keccak256(abi.encode(superToken, flowId));
        _flowMapping[key] = keccak256(abi.encode(receivableAsset, tokenId));
    }

    function _onlySuperfluid(address host, address cfa) internal view {
        (address hostValue, address cfaValue) = SuperfluidPoolConfig(address(_poolConfig))
            .getSuperfluidConfig();
        if (host != hostValue || cfa != cfaValue) {
            revert();
        }
    }
}
