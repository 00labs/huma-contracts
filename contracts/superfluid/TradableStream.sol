// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ISuperfluid, ISuperToken, ISuperApp} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {CFAv1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/CFAv1Library.sol";
import {CFALib} from "./CFALib.sol";

import {Errors} from "../Errors.sol";

struct TradableStreamMetadata {
    uint256 duration;
    uint256 started;
    address origin;
    address receiver;
    ISuperToken token;
    int96 flowrate;
}

/**
 * TradableStream uses an NFT to make a Superfluid stream tradable.
 */
contract TradableStream is ERC721, Ownable {
    string public constant version = "1";

    using CFAv1Library for CFAv1Library.InitData;
    using CFALib for CFAv1Library.InitData;
    CFAv1Library.InitData public cfaV1;

    /// @dev emitted when a TradableStream is minted and transferred ownership
    event TradableStreamStarted(
        // token id of the TradableStream
        uint256 tokenId,
        // original sender of the tokenized stream
        address indexed origin,
        // the original receiver of the tokenized stream
        address indexed receiver,
        // the timestamp where the TradableStream will become burnable
        uint256 matureAt
    );

    /// @dev emitted when a TradableStream is burned
    event TradableStreamTerminated(
        // token id of the TradableStream
        uint256 tokenId,
        // original sender of the tokenized stream
        address indexed origin,
        // the original receiver of the tokenized stream
        address indexed receiver
    );

    /**
     * @notice Refund the excessive token received (e.g. Flowrate increased during
     * the period when the token was traded)
     */
    event RefundExtraToken(
        address receiver,
        address owner,
        uint256 refundAmount,
        uint256 sendAmount
    );

    /// @notice token ids => metadata
    mapping(uint256 => TradableStreamMetadata) public metadatas;

    /// @notice origin => currentReceiver => flowrate in the tradableStream
    mapping(address => mapping(address => int96)) public _tradedStream;

    /// @notice current token id
    uint256 public nextId;

    bytes32 public immutable domainSeparator;
    bytes32 public constant MINTTO_WITH_AUTHORIZATION_TYPEHASH =
        keccak256(
            "MintToWithAuthorization(address receiver,address token,address origin,address owner,int96 flowrate,uint256 durationInSeconds,uint256 nonce,uint256 expiry)"
        );
    mapping(address => uint256) public nonces;

    constructor(ISuperfluid host) payable Ownable() ERC721("TradableStream", "TSTRM") {
        IConstantFlowAgreementV1 cfa = IConstantFlowAgreementV1(
            address(
                host.getAgreementClass(
                    keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1")
                )
            )
        );

        cfaV1 = CFAv1Library.InitData(host, cfa);

        domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("TradableStream")),
                keccak256(bytes(version)),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice require that tokenId exists (minted and not burnt)
    /// @param tokenId ID of token to be checked
    modifier exists(uint256 tokenId) {
        if (!_exists(tokenId)) {
            revert Errors.tradableStreamNotExisting();
        }
        _;
    }

    /// @notice Burns an expired TradableStream, resture the stream back to the original receiver
    /// @dev Anyone can call this method to burn the tradableStream at any time,
    /// will revert if it is not expired and its flow is not zero yet
    /// @dev See `_beforeTokenTransfer` for the handover process.
    /// @param tokenId The token ID of the TradableStream to be burned
    function burn(uint256 tokenId) external {
        TradableStreamMetadata memory meta = metadatas[tokenId];

        address owner = ownerOf(tokenId);
        (, int96 flowrate, , ) = cfaV1.cfa.getFlow(meta.token, meta.origin, owner);
        if (meta.started == 0 && msg.sender != owner) {
            revert Errors.notTradableStreamOwner();
        }
        if (!hasMatured(tokenId) && flowrate > 0) {
            revert Errors.tradableStreamNotMatured();
        }
        _burn(tokenId);

        emit TradableStreamTerminated(tokenId, meta.origin, meta.receiver);
    }

    /// @notice Mint a TradableStream from an existing stream
    /// @param token the super token
    /// @param origin the payer of the stream
    /// @param flowrate the flowrate that will be traded. It can be part of the entire steam.
    /// @param durationInSeconds the duration for the stream to be traded and owned by the a new receiver
    function mint(
        ISuperToken token,
        address origin,
        int96 flowrate,
        uint256 durationInSeconds
    ) external {
        _mintTo(msg.sender, token, origin, msg.sender, flowrate, durationInSeconds);
    }

    function _mintTo(
        address receiver,
        ISuperToken token,
        address origin,
        address newOwner,
        int96 flowrate,
        uint256 durationInSeconds
    ) internal returns (uint256 tokenId) {
        if (
            receiver == address(0) ||
            address(token) == address(0) ||
            origin == address(0) ||
            newOwner == address(0)
        ) revert Errors.zeroAddressProvided();

        if (flowrate <= 0) revert Errors.invalidFlowrate();

        // Get flow from origin to receiver
        (, int96 allFlowrate, , ) = cfaV1.cfa.getFlow(token, origin, receiver);

        // Get investments
        int96 alreadyTraded = _tradedStream[origin][receiver];
        if (alreadyTraded >= allFlowrate) revert Errors.notEnoughAvailableFlowrate();
        int96 availableFlowrate = allFlowrate - alreadyTraded;
        if (flowrate > availableFlowrate) revert Errors.notEnoughAvailableFlowrate();

        tokenId = nextId;

        metadatas[tokenId] = TradableStreamMetadata({
            origin: origin,
            receiver: receiver,
            flowrate: flowrate,
            token: token,
            duration: durationInSeconds,
            started: 0
        });

        //will start streaming from TradableStream to msg.sender / receiver
        _mint(receiver, tokenId);
        nextId += 1;

        if (newOwner != receiver) {
            _transfer(receiver, newOwner, tokenId);
        }
    }

    /// @notice Mint a TradableStream to msg.sender based on receiver's authorization
    /// @dev This function is to combine mint, approve and transfer in one function.
    ///      The receiver generates authorization proof(
    ///      the format is 'MintToWithAuthorization(address receiver,address token,address origin,address owner,int96 flowrate,uint256 durationInSeconds,uint256 nonce,uint256 expiry)'
    ///      ). The owner(who will receive this TradableStream) can call this function with the signature(v, r, s).
    /// @param currentOwner the flow's current receiver who creates the proof
    /// @param token the supertoken
    /// @param origin the payer of the stream
    /// @param flowrate the flowrate that will be traded. It can be part of the entire steam.
    /// @param durationInSeconds the duration for the stream to be traded and owned by the a new receiver
    /// @param expiry the expiration timestamp(second) of the proof
    /// @param v v of the signature
    /// @param r r of the signature
    /// @param s s of the signature
    function mintToWithAuthorization(
        address currentOwner,
        address token,
        address origin,
        int96 flowrate,
        uint256 durationInSeconds,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256) {
        if (expiry > 0 && block.timestamp > expiry) revert Errors.AuthorizationExpired();

        uint256 nonce = nonces[currentOwner]++;

        bytes32 data = keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator,
                keccak256(
                    abi.encode(
                        MINTTO_WITH_AUTHORIZATION_TYPEHASH,
                        currentOwner,
                        token,
                        origin,
                        msg.sender,
                        flowrate,
                        durationInSeconds,
                        nonce,
                        expiry
                    )
                )
            )
        );

        if (currentOwner != ecrecover(data, v, r, s)) revert Errors.InvalidAuthorization();
        return
            _mintTo(
                currentOwner,
                ISuperToken(token),
                origin,
                msg.sender,
                flowrate,
                durationInSeconds
            );
    }

    function _beforeTokenTransfer(
        address oldReceiver,
        address newReceiver,
        uint256 tokenId
    ) internal override {
        TradableStreamMetadata memory meta = metadatas[tokenId];

        if (newReceiver == meta.origin) revert Errors.newReceiverSameToOrigin();

        if (oldReceiver == address(0)) {
            //to mint
            _tradedStream[meta.origin][newReceiver] += meta.flowrate;
        } else if (newReceiver == address(0)) {
            //to burn
            _tradedStream[meta.origin][oldReceiver] -= meta.flowrate;
            delete metadatas[tokenId];

            (, int96 flowrate, , ) = cfaV1.cfa.getFlow(meta.token, meta.origin, oldReceiver);
            if (flowrate > 0) {
                // If the flowrate has been changed after the TradableStream was transferred,
                // the current flowrate can be different from the initial flowrate.

                // todo This seems to be broken. meta.flowrate may not equal to the flowrate from the statement below.
                // check if meta.flowrate should be used in the next two statements instead of flowrate

                // decrease the current flowrate from oldReceiver
                cfaV1._decreaseFlowByOperator(
                    cfaV1.cfa,
                    meta.token,
                    meta.origin,
                    oldReceiver,
                    flowrate
                );

                // increase current flowrate to the initial receiver
                cfaV1._increaseFlowByOperator(
                    cfaV1.cfa,
                    meta.token,
                    meta.origin,
                    meta.receiver,
                    flowrate
                );
            }
            // If the flow has been terminated, do nothing.
        } else {
            //transfer
            if (meta.started == 0) {
                metadatas[tokenId].started = block.timestamp;
                emit TradableStreamStarted(
                    tokenId,
                    meta.origin,
                    meta.receiver,
                    block.timestamp + meta.duration
                );
            } else {
                if (hasMatured(tokenId)) {
                    revert("this tradableStream has expired");
                }
            }

            _tradedStream[meta.origin][oldReceiver] -= meta.flowrate;
            _tradedStream[meta.origin][newReceiver] += meta.flowrate;

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

    function maturesAt(uint256 tokenId) public view exists(tokenId) returns (uint256) {
        if (metadatas[tokenId].started == 0) return 0;

        return metadatas[tokenId].started + metadatas[tokenId].duration;
    }

    function hasMatured(uint256 tokenId) public view exists(tokenId) returns (bool) {
        uint256 _maturesAt = maturesAt(tokenId);
        if (_maturesAt == 0) return false;
        return (_maturesAt < block.timestamp);
    }

    /**
     * @notice Gets the remaining value in the TradableStream.
     */
    function remainingValue(uint256 tokenId)
        public
        view
        exists(tokenId)
        returns (ISuperToken token, uint256 value)
    {
        TradableStreamMetadata memory meta = metadatas[tokenId];
        assert(meta.flowrate > 0);

        token = meta.token;
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
            value = uint256(remainingSeconds) * uint256(uint96(meta.flowrate));
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
            maturesAt(tokenId),
            meta.token,
            meta.flowrate
        );
    }
}
