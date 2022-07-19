//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@chainlink/contracts/src/v0.8/ChainlinkClient.sol";
import "@chainlink/contracts/src/v0.8/ConfirmedOwner.sol";

import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * Request testnet LINK and ETH here: https://faucets.chain.link/
 * Find information on LINK Token Contracts and get the latest ETH and LINK faucets here: https://docs.chain.link/docs/link-token-contracts/
 */
contract HumaAPIClient is ChainlinkClient, ConfirmedOwner {
    using Chainlink for Chainlink.Request;

    bytes32 private jobId;
    uint256 private fee;

    mapping(uint256 => bool) public loanIdApproval;
    mapping(uint256 => bool) public loanIdApprovalFulfilled;

    event RiskRequestSent(
        string network,
        address walletAddress,
        uint256 loanId,
        uint256 amount
    );
    event RiskRequestFulfilled(bytes32 indexed requestId, bytes indexed data);

    /**
     * @notice Initialize the link token and target oracle
     * @dev The oracle address must be an Operator contract for multiword response
     *
     *
     * Rinkeby Testnet details:
     * Link Token: 0x01BE23585060835E02B77ef475b0Cc51aA1e0709
     * Oracle: 0xf3FBB7f3391F62C8fe53f89B41dFC8159EE9653f (Chainlink DevRel)
     * jobId: 7da2702f37fd48e5b1b9a5715e3509b6
     * https://docs.chain.link/docs/any-api-testnet-nodes/
     *
     */
    constructor() ConfirmedOwner(msg.sender) {
        setChainlinkToken(0x01BE23585060835E02B77ef475b0Cc51aA1e0709);
        setChainlinkOracle(0x188b71C9d27cDeE01B9b0dfF5C1aff62E8D6F434);
        jobId = "a84b561bd8f64300a0832682f208321f";
        fee = (1 * LINK_DIVISIBILITY) / 10; // 0,1 * 10**18 (Varies by network and job)
    }

    function toAsciiString(address x) internal pure returns (string memory) {
        bytes memory s = new bytes(40);
        for (uint256 i = 0; i < 20; i++) {
            bytes1 b = bytes1(uint8(uint256(uint160(x)) / (2**(8 * (19 - i)))));
            bytes1 hi = bytes1(uint8(b) / 16);
            bytes1 lo = bytes1(uint8(b) - 16 * uint8(hi));
            s[2 * i] = char(hi);
            s[2 * i + 1] = char(lo);
        }
        return string(s);
    }

    function char(bytes1 b) internal pure returns (bytes1 c) {
        if (uint8(b) < 10) return bytes1(uint8(b) + 0x30);
        else return bytes1(uint8(b) + 0x57);
    }

    /**
     * @notice Request mutiple parameters from the oracle in a single transaction
     */
    function requestRiskApproval(
        string memory _network,
        address _wallet,
        uint256 _loanId,
        uint256 _amount,
        uint256 _interestRate,
        uint256 _paymentInterval,
        string memory term
    ) external {
        emit RiskRequestSent(_network, _wallet, _loanId, _amount);
        Chainlink.Request memory req = buildChainlinkRequest(
            jobId,
            address(this),
            this.fulfillMultipleParameters.selector
        );
        string memory walletString = toAsciiString(_wallet);
        req.add(
            "get",
            string(
                abi.encodePacked(
                    "http://risk.huma.finance/protocolApproval?network=",
                    _network,
                    "&wallet_address=0x",
                    walletString,
                    "&amount=",
                    Strings.toString(_amount),
                    "&loan_id=",
                    Strings.toString(_loanId),
                    "&term=",
                    term,
                    "&interest_rate=",
                    Strings.toString(_interestRate),
                    "&payment_due=",
                    Strings.toString(_paymentInterval)
                )
            )
        );
        req.add("path", "approvalCode");
        sendOperatorRequest(req, fee); // MWR API.
    }

    /**
     * @notice Fulfillment function for multiple parameters in a single request
     * @dev This is called by the oracle. recordChainlinkFulfillment must be used.
     */
    function fulfillMultipleParameters(
        bytes32 _requestId,
        bytes memory _approvalCodeResponse
    ) public recordChainlinkFulfillment(_requestId) {
        emit RiskRequestFulfilled(_requestId, _approvalCodeResponse);
        (uint256 approved, uint256 loanId) = abi.decode(
            _approvalCodeResponse,
            (uint256, uint256)
        );
        loanIdApproval[loanId] = approved == 1;
        loanIdApprovalFulfilled[loanId] = false;
    }

    /**
     * Allow withdraw of Link tokens from the contract
     */
    function withdrawLink() public onlyOwner {
        LinkTokenInterface link = LinkTokenInterface(chainlinkTokenAddress());
        require(
            link.transfer(msg.sender, link.balanceOf(address(this))),
            "Unable to transfer"
        );
    }
}
