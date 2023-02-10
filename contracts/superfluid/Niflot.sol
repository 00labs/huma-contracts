// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ISuperfluid, ISuperToken, ISuperApp} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {CFAv1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/CFAv1Library.sol";
import {IncDec} from "./IncDec.sol";
import "../interfaces/IReceivableAsset.sol";
import "hardhat/console.sol";

struct NiflotMetadata {
    uint256 duration;
    uint256 started;
    address origin;
    address receiver;
    ISuperToken token;
    int96 flowrate;
}

// A Niflot's maximum duration is one month.
uint256 constant MAX_DURATION_SECONDS = 60 * 60 * 24 * 30;

contract Niflot is ERC721, Ownable, IReceivableAsset {
    using CFAv1Library for CFAv1Library.InitData;
    using IncDec for CFAv1Library.InitData;
    CFAv1Library.InitData public cfaV1;

    /// @dev when a NIFLOT is transferred for the first time and engaged
    event NiflotStarted(
        // token id of the NIFLOT
        uint256 tokenId,
        // original sender of tokenized stream
        address indexed origin,
        // the original receiver of the tokenized stream
        address indexed receiver,
        // the timestamp where the NIFLOT will become burnable
        uint256 matureAt
    );

    /// @dev when a NIFLOT is burned
    event NiflotTerminated(
        // token id of the NIFLOT
        uint256 tokenId,
        // original sender of tokenized stream
        address indexed origin,
        // the original receiver of the tokenized stream
        address indexed receiver
    );

    // /// @dev Super Token => acceptance for NIFLOT creation
    // mapping(ISuperToken => bool) private _acceptedTokens;

    /// @notice token ids => metadata
    mapping(uint256 => NiflotMetadata) public niflots;

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

    // /// @dev set a Super Token to accepted or not
    // /// @param token Super Token whose acceptance status is being changed
    // /// @param accept New acceptance status
    // function toggleAcceptToken(ISuperToken token, bool accept)
    //     public
    //     onlyOwner
    // {
    //     _acceptedTokens[token] = accept;
    // }

    /// @notice Burns a mature NIFLOT, restoring the original stream from origin to receiver
    /// @dev Anyone can call this method at any time
    /// @dev  Will revert if niflot is not mature
    /// @dev See `_beforeTokenTransfer` for the handover process.
    /// @param tokenId The token ID of the NIFLOT that is being burned
    function burn(uint256 tokenId) external override {
        require(
            niflots[tokenId].started == 0 || isMature(tokenId),
            "cant burn a non mature niflot"
        );

        _burn(tokenId);

        emit NiflotTerminated(tokenId, niflots[tokenId].origin, niflots[tokenId].receiver);
    }

    /// @notice Lets an origin cancel a stream and burns associated NIFLOT
    /// @notice Employer may circumvent by manually canceling stream on their end
    /// @param tokenId The NIFLOT token ID pertaining to the stream that is being cancelled
    function cancelByOrigin(uint256 tokenId) external exists(tokenId) {
        NiflotMetadata memory meta = niflots[tokenId];

        require(msg.sender == meta.origin, "only origin can call this");
        _burn(tokenId);

        emit NiflotTerminated(tokenId, niflots[tokenId].origin, niflots[tokenId].receiver);
    }

    // TODO: potentially add a dedicated flowrate so don't have to sell everything at once.
    /// @notice Mint a NIFLOT against a stream you're receiving
    /// @param token the currency this Niflot is based on
    /// @param origin the source that streams `token` to your account
    /// @param flowrate how much flowrate will be moved out
    /// @param durationInSeconds how long this Niflot will run after it's been transferred for the first time
    function mint(
        ISuperToken token,
        address origin,
        int96 flowrate,
        uint256 durationInSeconds
    ) external {
        // Accepted token toggle?

        require(MAX_DURATION_SECONDS >= durationInSeconds, "niflot duration exceeds one month");

        // Get flow from origin to receiver
        (, int96 allFlowrate, , ) = cfaV1.cfa.getFlow(token, origin, msg.sender);

        // Get investments
        int96 alreadyInvested = _investments[origin][msg.sender];
        require(allFlowrate > alreadyInvested, "you don't have any available flowrate");
        int96 availableFlowrate = allFlowrate - alreadyInvested;

        require(flowrate < availableFlowrate, "you don't have enough available flowrate");

        niflots[nextId] = NiflotMetadata({
            origin: origin,
            receiver: msg.sender,
            flowrate: flowrate,
            token: token,
            duration: durationInSeconds,
            started: 0
        });

        //will start streaming from niflot to msg.sender / receiver
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

        NiflotMetadata memory meta = niflots[tokenId];

        require(newReceiver != meta.origin, "can't transfer a niflot to its origin");

        if (oldReceiver == address(0)) {
            //minted
            _investments[meta.origin][newReceiver] += meta.flowrate;
        } else if (newReceiver == address(0)) {
            //burnt
            _investments[meta.origin][oldReceiver] -= meta.flowrate;
            delete niflots[tokenId];

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
            if (meta.started == 0) {
                niflots[tokenId].started = block.timestamp;
                emit NiflotStarted(
                    tokenId,
                    meta.origin,
                    meta.receiver,
                    block.timestamp + meta.duration
                );
            } else {
                if (isMature(tokenId)) {
                    revert("this niflot is mature and can only be burnt");
                }
            }

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
        if (niflots[tokenId].started == 0) return 0;

        return niflots[tokenId].started + niflots[tokenId].duration;
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
        NiflotMetadata memory meta = niflots[tokenId];
        assert(meta.flowrate > 0);

        token = meta.token;
        value = _remainingValue(meta, meta.flowrate);
    }

    function _remainingValue(NiflotMetadata memory meta, int96 flowrate)
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

    function getNiflotData(uint256 tokenId)
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
        NiflotMetadata memory meta = niflots[tokenId];
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

    function payOwner(uint256 tokenId, uint256 amount) external override {}

    function getReceivableData(uint256 tokenId)
        external
        view
        override
        exists(tokenId)
        returns (uint256 receivableParam, uint256 receivableAmount)
    {
        NiflotMetadata memory meta = niflots[tokenId];
        address owner = ownerOf(tokenId);
        receivableParam = uint256(keccak256(abi.encodePacked(meta.token, meta.origin, owner)));
        (, int96 flowrate, , ) = cfaV1.cfa.getFlow(meta.token, meta.origin, owner);
        if (flowrate > meta.flowrate) {
            flowrate = meta.flowrate;
        } else if (flowrate < 0) {
            flowrate = 0;
        }
        receivableAmount = _remainingValue(meta, flowrate);
    }

    // function metadata(uint256 tokenId)
    //     public
    //     view
    //     exists(tokenId)
    //     returns (
    //         int96 nftFlowrate,
    //         uint256 dueValue,
    //         uint256 until
    //     )
    // {
    //     (, nftFlowrate, , ) = cfaV1.cfa.getFlow(
    //         _acceptedToken,
    //         address(this),
    //         ownerOf(tokenId)
    //     );

    //     uint256 secondsToGo = salaryPledges[tokenId].untilTs - block.timestamp;
    //     dueValue = uint256(int256(nftFlowrate)) * secondsToGo;
    //     until = salaryPledges[tokenId].untilTs;
    // }

    // function tokenURI(uint256 tokenId)
    //     public
    //     view
    //     override
    //     exists(tokenId)
    //     returns (string memory)
    // {
    //     (int96 nftFlowrate, uint256 dueValue, uint256 until) = metadata(
    //         tokenId
    //     );
    //     return
    //         _sellaryRenderer.metadata(
    //             tokenId,
    //             _acceptedToken.symbol(),
    //             nftFlowrate,
    //             dueValue,
    //             until
    //         );
    // }
}
