// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ISuperfluid, ISuperToken, ISuperApp} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {CFAv1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/CFAv1Library.sol";
import {CFALib} from "./CFALib.sol";
import "../interfaces/IReceivableAsset.sol";
import "hardhat/console.sol";

struct TradableStreamMetadata {
    uint256 duration;
    uint256 started;
    address origin;
    address receiver;
    ISuperToken token;
    int96 flowrate;
}

// A TradableStream's maximum duration is one month.
uint256 constant MAX_DURATION_SECONDS = 60 * 60 * 24 * 30;

contract TradableStream is ERC721, Ownable, IReceivableAsset {
    using CFAv1Library for CFAv1Library.InitData;
    using CFALib for CFAv1Library.InitData;
    CFAv1Library.InitData public cfaV1;

    /// @dev when a TradableStream is transferred for the first time and engaged
    event TradableStreamStarted(
        // token id of the TradableStream
        uint256 tokenId,
        // original sender of tokenized stream
        address indexed origin,
        // the original receiver of the tokenized stream
        address indexed receiver,
        // the timestamp where the TradableStream will become burnable
        uint256 matureAt
    );

    /// @dev when a TradableStream is burned
    event TradableStreamTerminated(
        // token id of the TradableStream
        uint256 tokenId,
        // original sender of tokenized stream
        address indexed origin,
        // the original receiver of the tokenized stream
        address indexed receiver
    );

    event RefundExtraToken(
        address receiver,
        address owner,
        uint256 refundAmount,
        uint256 sendAmount
    );

    /// @notice token ids => metadata
    mapping(uint256 => TradableStreamMetadata) public metadatas;

    /// @notice origin => investor => total acquired flowrate
    mapping(address => mapping(address => int96)) private _investments;

    /// @notice current token id
    uint256 public nextId;

    constructor(ISuperfluid host) payable Ownable() ERC721("Niflot", "NIFLOT") {
        IConstantFlowAgreementV1 cfa = IConstantFlowAgreementV1(
            address(
                host.getAgreementClass(
                    keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1")
                )
            )
        );

        cfaV1 = CFAv1Library.InitData(host, cfa);
    }

    /// @dev require that tokenId exists (minted and not burnt)
    /// @param tokenId Token ID whose existance is being checked
    modifier exists(uint256 tokenId) {
        require(_exists(tokenId), "token doesn't exist or has been burnt");
        _;
    }

    /// @notice Burns a mature TradableStream, restoring the original stream from origin to receiver
    /// @dev Anyone can call this method at any time
    /// @dev  Will revert if TradableStream is not mature
    /// @dev See `_beforeTokenTransfer` for the handover process.
    /// @param tokenId The token ID of the TradableStream that is being burned
    function burn(uint256 tokenId) external override onlyOwner {
        TradableStreamMetadata memory meta = metadatas[tokenId];
        require(meta.started == 0 || isMature(tokenId), "cant burn a non mature TradableStream");

        _burn(tokenId);

        // Refund the extra amount to receiver

        uint256 refundAmount = (block.timestamp - (meta.started + meta.duration)) *
            uint256(uint96(meta.flowrate));
        address owner = ownerOf(tokenId);
        uint256 balance = meta.token.balanceOf(owner);
        uint256 allownance = meta.token.allowance(owner, address(this));
        uint256 sendAmount = balance < allownance ? balance : allownance;
        sendAmount = sendAmount < refundAmount ? sendAmount : refundAmount;

        if (sendAmount > 0) {
            meta.token.transferFrom(owner, meta.receiver, sendAmount);
            emit RefundExtraToken(meta.receiver, owner, refundAmount, sendAmount);
        }

        emit TradableStreamTerminated(tokenId, meta.origin, meta.receiver);
    }

    // TODO: potentially add a dedicated flowrate so don't have to sell everything at once.
    /// @notice Mint a TradableStream against a stream you're receiving
    /// @param token the currency this TradableStream is based on
    /// @param origin the source that streams `token` to your account
    /// @param flowrate how much flowrate will be moved out
    /// @param durationInSeconds how long this TradableStream will run after it's been transferred for the first time
    function mint(
        ISuperToken token,
        address origin,
        int96 flowrate,
        uint256 durationInSeconds
    ) external {
        // Accepted token toggle?

        require(
            MAX_DURATION_SECONDS >= durationInSeconds,
            "TradableStream duration exceeds one month"
        );

        // Get flow from origin to receiver
        (, int96 allFlowrate, , ) = cfaV1.cfa.getFlow(token, origin, msg.sender);

        // Get investments
        int96 alreadyInvested = _investments[origin][msg.sender];
        require(allFlowrate > alreadyInvested, "you don't have any available flowrate");
        int96 availableFlowrate = allFlowrate - alreadyInvested;

        require(flowrate < availableFlowrate, "you don't have enough available flowrate");

        metadatas[nextId] = TradableStreamMetadata({
            origin: origin,
            receiver: msg.sender,
            flowrate: flowrate,
            token: token,
            duration: durationInSeconds,
            started: 0
        });

        //will start streaming from TradableStream to msg.sender / receiver
        _mint(msg.sender, nextId);
        nextId += 1;
    }

    function _beforeTokenTransfer(
        address oldReceiver,
        address newReceiver,
        uint256 tokenId
    ) internal override {
        //blocks transfers to superApps - done for simplicity, but you could support super apps in a new version!
        require(
            !cfaV1.host.isApp(ISuperApp(newReceiver)) || newReceiver == address(this),
            "New receiver cannot be a superApp"
        );

        TradableStreamMetadata memory meta = metadatas[tokenId];

        require(newReceiver != meta.origin, "can't transfer a TradableStream to its origin");

        if (oldReceiver == address(0)) {
            //minted
            _investments[meta.origin][newReceiver] += meta.flowrate;
        } else if (newReceiver == address(0)) {
            //burnt
            _investments[meta.origin][oldReceiver] -= meta.flowrate;
            delete metadatas[tokenId];

            //burnt
            cfaV1._decreaseFlowByOperator(
                cfaV1.cfa,
                meta.token,
                meta.origin,
                oldReceiver,
                meta.flowrate
            );
            cfaV1._increaseFlowByOperator(
                cfaV1.cfa,
                meta.token,
                meta.origin,
                meta.receiver,
                meta.flowrate
            );
        } else {
            //transfer
            require(meta.started == 0, "TradableStream can't be transferred multiple times");
            metadatas[tokenId].started = block.timestamp;
            emit TradableStreamStarted(
                tokenId,
                meta.origin,
                meta.receiver,
                block.timestamp + meta.duration
            );

            _investments[meta.origin][oldReceiver] -= meta.flowrate;
            _investments[meta.origin][newReceiver] += meta.flowrate;

            //handover flow
            cfaV1._decreaseFlowByOperator(
                cfaV1.cfa,
                meta.token,
                meta.origin,
                oldReceiver,
                meta.flowrate
            );
            cfaV1._increaseFlowByOperator(
                cfaV1.cfa,
                meta.token,
                meta.origin,
                newReceiver,
                meta.flowrate
            );
        }
    }

    function endsAt(uint256 tokenId) public view exists(tokenId) returns (uint256) {
        if (metadatas[tokenId].started == 0) return 0;

        return metadatas[tokenId].started + metadatas[tokenId].duration;
    }

    function isMature(uint256 tokenId) public view exists(tokenId) returns (bool) {
        uint256 _endsAt = endsAt(tokenId);
        if (_endsAt == 0) return false;
        return (_endsAt < block.timestamp);
    }

    function remainingValue(uint256 tokenId)
        public
        view
        exists(tokenId)
        returns (ISuperToken token, uint256 value)
    {
        TradableStreamMetadata memory meta = metadatas[tokenId];
        assert(meta.flowrate > 0);

        token = meta.token;
        value = _remainingValue(meta, meta.flowrate);
    }

    function _remainingValue(TradableStreamMetadata memory meta, int96 flowrate)
        internal
        view
        returns (uint256 value)
    {
        int256 remainingSeconds;
        if (meta.started == 0) {
            remainingSeconds = int256(meta.duration);
        } else {
            remainingSeconds =
                int256(meta.started) +
                int256(meta.duration) -
                int256(block.timestamp);
        }

        if (remainingSeconds <= 0) {
            value = 0;
        } else {
            value = uint256(remainingSeconds) * uint256(uint96(flowrate));
        }
    }

    function getTradableStreamData(uint256 tokenId)
        public
        view
        exists(tokenId)
        returns (
            address origin,
            address receiver,
            uint256 duration,
            uint256 started,
            uint256 until,
            ISuperToken token,
            int96 flowrate
        )
    {
        TradableStreamMetadata memory meta = metadatas[tokenId];
        return (
            meta.origin,
            meta.receiver,
            meta.duration,
            meta.started,
            endsAt(tokenId),
            meta.token,
            meta.flowrate
        );
    }

    function payOwner(uint256 tokenId, uint256 amount) external override onlyOwner {
        require(isMature(tokenId), "this TradableStream is not mature");
        TradableStreamMetadata memory meta = metadatas[tokenId];
        assert(meta.flowrate > 0);
        uint256 availableAmount = meta.duration * uint256(uint96(meta.flowrate));
        if (amount > availableAmount) {
            amount = availableAmount;
        }
        address owner = ownerOf(tokenId);

        meta.token.transferFrom(owner, address(this), amount);
        meta.token.downgradeTo(owner, amount);
    }

    function getReceivableData(uint256 tokenId)
        external
        view
        override
        exists(tokenId)
        returns (
            uint256 receivableParam,
            uint256 receivableAmount,
            address token
        )
    {
        TradableStreamMetadata memory meta = metadatas[tokenId];
        address owner = ownerOf(tokenId);
        receivableParam = uint256(keccak256(abi.encodePacked(meta.token, meta.origin, owner)));
        (, int96 flowrate, , ) = cfaV1.cfa.getFlow(meta.token, meta.origin, owner);
        if (flowrate < 0) {
            flowrate = 0;
        } else if (flowrate > meta.flowrate) {
            flowrate = meta.flowrate;
        }
        receivableAmount = _remainingValue(meta, flowrate);
        token = address(meta.token);
    }
}
