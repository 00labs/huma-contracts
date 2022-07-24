//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

enum CreditType {
    Loan,
    InvoiceFactoring,
    X_to_own
}

/** @notice HumaConfig maintains all the global configurations supported by Huma protocol.
 */
contract HumaConfig {
    /// The default value for default grace period.
    uint256 private constant DEFAULT_DEFAULT_GRACE_PERIOD = 5 days;

    /// The default treasury fee in bps.
    uint256 private constant DEFAULT_TREASURY_FEE = 50; // 0.5%

    // The network the pools in this config are under (e.g. mainnet, rinkeby)
    // Used for risk API integration
    string public network;

    /// The Governor is repsonsible for managing all protocol-level configs.
    address private governor;

    /// pendingGovernor is set to become the new governor after accepting the transfer.
    address private pendingGovernor;

    /// The protocol admin operate the protocol, incl. turning it on or off.
    address private protoAdmin;

    /// Flag that shows whether the protocol is paused or not
    bool private protocolPaused;

    /// List of assets supported by the protocol for investing and borrowing
    mapping(address => bool) private validLiquidityAsset;

    /// Seconds passed the due date before trigging a default
    uint256 private defaultGracePeriod;

    /// Protocol fee of the loan origination (in bps). Other fees are defined at pool level.
    uint256 private treasuryFee;

    /// humaTreasury is the protocol treasury
    address private humaTreasury;

    //TODO: Add configs related to staking
    //TODO: Add configs related to collateral
    //TODO: Gas optimization of the storage variables after finaling the variables

    event ProtocolInitialized();
    event NewGovernorNominated(address indexed newGovernor);
    event NewGovernorAccepted(address indexed newGovernor);
    event ProtoAdminSet(address indexed newprotoAdmin);
    event ProtocolPausedChanged(bool pause);

    event LiquidityAssetSet(
        address asset,
        uint256 decimals,
        string symbol,
        bool valid
    );
    event TreasuryFeeChanged(uint256 newFee);
    event DefaultGracePeriodChanged(uint256 gracePeriod);

    event HumaTreasuryChanged(address indexed newTreasuryAddress);

    /// Makes sure the msg.sender is the governor
    modifier isGovernor() {
        require(msg.sender == governor, "HumaConfig:GOVERNOR_REQUIRED");
        _;
    }

    /// Makes sure the msg.sender is the protocol admin
    modifier isprotoAdmin() {
        require(msg.sender == protoAdmin, "HumaConfig:PROTO_ADMIN_REQUIRED");
        _;
    }

    /**
     * @notice Initiates the config with the provided governor and proto admin addresses.
     * Only governor can appoint new governor, proto admin, or change the treasury address
     * Only proto admin can turn on or off the proto after initiation.
     * Only proto admin can change the default grace period, treasury fee, add or remove
     * assets to be supported by the protocol.
     * Set the default grace period and treasury fee to the default values.
     * Set the default Huma Tresury to the governor. It is expected to be changed immediately after.
     * @param _governor address of Governor
     * @param _protoAdmin address the Protocol Admin
     * @dev Reverts w/ msg "HumaConfig:ZERO_ADDRESS_GOVERNOR" for address(0) for governor
     * @dev Reverts w/ msg "HumaConfig:ZERO_ADDRESS_PROTO_ADMIN" for address(0) for admin
     * @dev Emits an ProtocolInitialized event.
     */
    constructor(address _governor, address _protoAdmin) {
        require(_governor != address(0), "HumaConfig:ZERO_ADDRESS_GOVERNOR");
        require(
            _protoAdmin != address(0),
            "HumaConfig:ZERO_ADDRESS_PROTO_ADMIN"
        );
        governor = _governor;
        protoAdmin = _protoAdmin;
        defaultGracePeriod = DEFAULT_DEFAULT_GRACE_PERIOD;

        // Set governor as default treasury, which can be changed via setHumaTreasury().
        humaTreasury = _governor;
        treasuryFee = DEFAULT_TREASURY_FEE;

        emit ProtocolInitialized();
    }

    // ********************************************
    // Configs related to protocol management roles
    // ********************************************

    /**
     * @notice Nominates a new Governor. This address can become Governor if they accept.
     * Only the Governor can call this function.
     * @param newGovernor Address of the newly nominated Governor.
     * @dev If the nominee is address(0), revert with message "HumaConfig:GOVERNOR_ZERO_ADDR"
     * @dev if the nominee is the governor, revert w/ msg "HumaConfig:NOMINEE_CANNOT_BE_GOVERNOR"
     * @dev Emits a NewGovernorNominated event.
     */
    function nominateNewGovernor(address newGovernor) external isGovernor {
        require(newGovernor != address(0), "HumaConfig:GOVERNOR_ZERO_ADDR");
        require(
            newGovernor != governor,
            "HumaConfig:NOMINEE_CANNOT_BE_GOVERNOR"
        );
        pendingGovernor = newGovernor;
        emit NewGovernorNominated(newGovernor);
    }

    /**
     * @notice Accepts the Governor position. Only the nominated governor can call this function.
     * Otherwise, reverts w/ msg "HumaConfig:GOVERNOR_NOMINEE_NEEDED".
     * @dev Emits a NewGovernorAccepted(addreww newGovernor) event.
     */
    function acceptGovernor() external {
        require(
            msg.sender == pendingGovernor,
            "HumaConfig:GOVERNOR_NOMINEE_NEEDED"
        );
        governor = msg.sender;
        pendingGovernor = address(0);
        emit NewGovernorAccepted(msg.sender);
    }

    /**
     * @notice Sets the address of Huma Treasury. Only governor can make the change.
     * @param treasury the new Huma Treasury address
     * @dev If address(0) is provided, revert with "HumaConfig:TREASURY_ADDRESS_ZERO"
     * @dev If the current treasury address is provided, revert w/ "HumaConfig:TREASURY_ADDRESS_UNCHANGED"
     * @dev emit HumaTreasuryChanged(address newTreasury) event
     */
    function setHumaTreasury(address treasury) external isGovernor {
        require(treasury != address(0), "HumaConfig:TREASURY_ADDRESS_ZERO");
        require(
            treasury != humaTreasury,
            "HumaConfig:TREASURY_ADDRESS_UNCHANGED"
        );
        humaTreasury = treasury;

        emit HumaTreasuryChanged(treasury);
    }

    /**
     * @notice Sets the Protocol Admin. Only Governor can do so.
     * @param _protoAdmin Address of the new protocol admin
     * @dev If address(0) is provided, revert with "HumaConfig:ADMIN_ADDRESS_ZERO"
     * @dev If the current admin address is provided, revert w/ "HumaConfig:PROTOADMIN_ADDRESS_UNCHANGED"
     * @dev Emits a protoAdminSet event.
     */
    function setProtoAdmin(address _protoAdmin) external isGovernor {
        require(_protoAdmin != address(0), "HumaConfig:ADMIN_ADDRESS_ZERO");
        require(
            protoAdmin != _protoAdmin,
            "HumaConfig:PROTOADMIN_ADDRESS_UNCHANGED"
        );

        protoAdmin = _protoAdmin;

        emit ProtoAdminSet(protoAdmin);
    }

    /**
     * @notice Flips the pause state of the protocol. Only the protocol Admin can do so.
     * @param pause the new pause state
     * @dev Emits a ProtocolPausedChanged event.
     */
    function setProtocolPaused(bool pause) external isprotoAdmin {
        protocolPaused = pause;
        emit ProtocolPausedChanged(pause);
    }

    /**
     * @notice Sets the validity of an asset for liquidity in Huma. Only the proto admin can do so.
     * @param asset Address of the valid asset.
     * @param valid The new validity status a Liquidity Asset in Pools.
     * @dev Emits a LiquidityAssetSet event.
     */
    function setLiquidityAsset(address asset, bool valid)
        external
        isprotoAdmin
    {
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
     * @notice Sets the treasury fee (in basis points). Only proto admin can do so.
     * @param fee the new treasury fee (in bps)
     * @dev Treasury fee cannot exceed 5000 bps, i.e. 50%
     * @dev Emits a TreasuryFeeChanged(uint256 fee) event
     */
    function setTreasuryFee(uint256 fee) external isprotoAdmin {
        require(fee <= 5000, "HumaConfig:TREASURY_FEE_TOO_HIGH");
        treasuryFee = fee;
        emit TreasuryFeeChanged(fee);
    }

    /**
     * @notice Sets the default grace period. Only proto admin can do so.
     * @param gracePeriod new default grace period in seconds
     * @dev Rejects any grace period shorter than 1 day to guard against fat finger or attack.
     * @dev Emits DefaultGracePeriodChanged(uint256 newGracePeriod) event
     */
    function setDefaultGracePeriod(uint256 gracePeriod) external isprotoAdmin {
        require(gracePeriod >= 24 * 3600, "HumaConfig:GRACE_PERIOD_TOO_SHORT");
        defaultGracePeriod = gracePeriod;
        emit DefaultGracePeriodChanged(gracePeriod);
    }

    function getGovernor() public view returns (address) {
        return governor;
    }

    function getProtoAdmin() public view returns (address) {
        return protoAdmin;
    }

    function getHumaTreasury() public view returns (address) {
        return humaTreasury;
    }

    function isProtocolPaused() public view returns (bool) {
        return protocolPaused;
    }

    function isAssetValid(address asset) public view returns (bool) {
        return validLiquidityAsset[asset];
    }

    function getDefaultGracePeriod() public view returns (uint256) {
        return defaultGracePeriod;
    }

    function getTreasuryFee() public view returns (uint256) {
        return treasuryFee;
    }

    function setNetwork(string memory newNetwork) external isGovernor {
        network = newNetwork;
    }
}
