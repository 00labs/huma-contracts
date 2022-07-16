//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";

/** @notice HumaConfig maintains all the global configurations supported by Huma protocol.
 */
contract HumaConfig {
    using SafeMath for uint256;

    // The network the pools in this config are under (e.g. mainnet, rinkeby)
    // Used for risk API integration
    string public network;

    /// The Governor is repsonsible for managing all protocol-level configs.
    address public governor;

    /// pendingGovernor is set to become the new governor after accepting the transfer.
    address public pendingGovernor;

    /// The protocol admin operate the protocol, incl. turning it on or off.
    address public protocolAdmin;

    /// Flag that shows whether the protocol is paused or not
    bool public protocolPaused;

    /// List of assets supported by the protocol for investing and borrowing
    mapping(address => bool) public validLiquidityAsset;

    /// Seconds passed the due date before trigging a default
    uint256 public defaultGracePeriod;

    /// Protocol fee of the loan origination (in bps). Other fees are defined at pool level.
    uint256 public treasuryFee;

    /// humaTreasury is the protocol treasury
    address public humaTreasury;

    //TODO: Add configs related to staking
    //TODO: Add configs related to collateral
    //TODO: Gas optimization of the storage variables after finaling the variables

    event ProtocolInitialized();
    event NewGovernorNominated(address indexed newGovernor);
    event NewGovernorAccepted(address indexed newGovernor);
    event ProtocolAdminSet(address indexed newProtocolAdmin);
    event ProtocolPausedChanged(bool pause);

    event LiquidityAssetSet(
        address asset,
        uint256 decimals,
        string symbol,
        bool valid
    );
    event TreasuryFeeChanged(uint256 newFee);
    event DefaultGracePeriodChanged(uint256 gracePeriod);

    /// Makes sure the msg.sender is the governor
    modifier isGovernor() {
        require(msg.sender == governor, "ERROR: GOVERNOR_REQUIRED");
        _;
    }

    /**
     @param _governor address of Governor
     @param _protocolAdmin address the Protocol Admin
     @dev Emits an ProtocolInitialized event.
     */
    constructor(address _governor, address _protocolAdmin) {
        governor = _governor;
        protocolAdmin = _protocolAdmin;
        defaultGracePeriod = 5 days;
        // Set governor as default treasury, which can be changed via setHumaTreasury().
        humaTreasury = _governor;
        treasuryFee = 50; // 0.5%
        emit ProtocolInitialized();
    }

    // ***********************************
    // Configs related to protocol management roles
    // ***********************************

    /**
    @notice Nominates a new Governor. This address can become Governor if they accept. 
    Only the Governor can call this function.
    @dev Emits a NewGovernorNominated event.
    @param newGovernor Address of the newly nominated Governor.
    */
    function nominateNewGovernor(address newGovernor) external isGovernor {
        require(newGovernor != address(0), "ERROR: GOVERNOR_ZERO_ADDR");
        require(newGovernor != governor, "ERROR: NOMINATED_THE_SAME_GOVERNOR");
        pendingGovernor = newGovernor;
        emit NewGovernorNominated(newGovernor);
    }

    function getGovernor() external view returns (address) {
        return governor;
    }

    /**
     @notice Accepts the Governor position. Only the nominated governor can call this function.
     @dev Emits a NewGovernorAccepted event.
    */
    function acceptGovernor() external {
        require(
            msg.sender == pendingGovernor,
            "ERROR: PENDING_GOVERNOR_REQUIRED"
        );
        governor = msg.sender;
        pendingGovernor = address(0);
        emit NewGovernorAccepted(msg.sender);
    }

    function setHumaTreasury(address treasury) external isGovernor {
        require(treasury != address(0), "HumaConfig:TREASURY_ADDRESS_ZERO");
        require(!protocolPaused, "HumaConfig:PROTOCOL_PAUSED");
        humaTreasury = treasury;
    }

    /**
     * @notice Sets the Protocol Admin. Only Governor can do so.
     * @dev Emits a ProtocolAdminSet event.
     * @param _protocolAdmin Address of the new protocol admin
     */
    function setProtocolAdmin(address _protocolAdmin) external isGovernor {
        require(_protocolAdmin != address(0), "ERROR: ADMIN_ADDRESS_ZERO");
        require(!protocolPaused, "HC:PROTO_PAUSED");

        protocolAdmin = _protocolAdmin;

        emit ProtocolAdminSet(protocolAdmin);
    }

    // ***********************************
    // Configs related to assets and pricing
    // ***********************************

    /**
     * @notice Flips the pause state of the protocol. Only the protocol Admin can do so.
     * @dev Emits a ProtocolPausedChanged event.
     * @param pause the new pause state
     */
    function setProtocolPaused(bool pause) external {
        require(msg.sender == protocolAdmin, "HC:NOT_ADMIN");
        protocolPaused = pause;
        emit ProtocolPausedChanged(pause);
    }

    /**
     * @notice Sets the validity of an asset for liquidity in Huma. Only the Governor can do so.
     * @dev Emits a LiquidityAssetSet event.
     * @param asset Address of the valid asset.
     * @param valid The new validity status a Liquidity Asset in Pools.
     */
    function setLiquidityAsset(address asset, bool valid) external isGovernor {
        if (valid) validLiquidityAsset[asset] = valid;
        else delete validLiquidityAsset[asset];

        emit LiquidityAssetSet(
            asset,
            uint256(0), // TODO: need to get decimals of asset
            "", // TODO: need to get symbol of asset through IERC20Detailed
            valid
        );
    }

    /** 
      @notice Sets the treasury fee (in basis points).
      @dev Emits a TreasuryFeeChanged event
      @param fee the new treasury fee (in bps)
     */
    function setTreasuryFee(uint256 fee) external isGovernor {
        treasuryFee = fee;
        emit TreasuryFeeChanged(fee);
    }

    function getTreasuryFee() external view isGovernor returns (uint256) {
        return treasuryFee;
    }

    /**
      @notice Sets the default grace period. Governor is required to call. 
      @dev Emits DefaultGracePeriodChanged event
      @param gracePeriod new default grace period in seconds
    */
    function setDefaultGracePeriod(uint256 gracePeriod) external isGovernor {
        defaultGracePeriod = gracePeriod;
        emit DefaultGracePeriodChanged(gracePeriod);
    }

    function getHumaTreasury() external view returns (address) {
        return humaTreasury;
    }

    function setNetwork(string memory newNetwork) external isGovernor returns (uint256) {
        network = newNetwork;
    }
}
