//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "hardhat/console.sol";

enum CreditType {
    Loan,
    InvoiceFactoring,
    XToOwn
}

/** @notice HumaConfig maintains all the global configurations supported by Huma protocol.
 */
contract HumaConfig is Ownable {
    /// Lower bound of protocol default grace period.
    uint32 private constant MIN_DEFAULT_GRACE_PERIOD = 1 days;

    /// The initial value for default grace period.
    uint32 private constant PROTOCOL_DEFAULT_GRACE_PERIOD = 5 days;

    /// The default treasury fee in bps.
    uint16 private constant DEFAULT_TREASURY_FEE = 50; // 0.5%

    /// The default treasury fee in bps.
    uint16 private constant TREASURY_FEE_UPPER_BOUND = 5000; // 0.5%

    /// Expect to pack the next five fields in one storage slot.
    /// Flag that shows whether the protocol is paused or not
    bool public protocolPaused;

    /// Seconds passed the due date before trigging a default.
    uint32 public protocolDefaultGracePeriod;

    /// Protocol fee of the loan origination (in bps). Other fees are defined at pool level.
    uint16 public treasuryFee;

    /// humaTreasury is the protocol treasury
    address public humaTreasury;

    /// pausers can pause the pool.
    mapping(address => bool) private pausers;

    // poolAdmins has the list of approved pool admins / pool owners.
    mapping(address => bool) private poolAdmins;

    /// List of assets supported by the protocol for investing and borrowing
    mapping(address => bool) private validLiquidityAssets;

    event ProtocolInitialized(address by);

    event ProtocolPaused(address by);
    event ProtocolUnpaused(address by);

    event PauserAdded(address indexed pauser, address by);
    event PauserRemoved(address indexed pauser, address by);

    event PoolAdminAdded(address indexed pauser, address by);
    event PoolAdminRemoved(address indexed pauser, address by);

    event LiquidityAssetAdded(address asset, address by);
    event LiquidityAssetRemoved(address asset, address by);

    event HumaTreasuryChanged(address indexed newTreasuryAddress);
    event TreasuryFeeChanged(uint256 oldFee, uint256 newFee);

    event ProtocolDefaultGracePeriodChanged(uint256 gracePeriod);

    /**
     * @notice Initiates the config. Only owner can appoint set the treasury
     * address, add pausers and pool admins, change the default grace period,
     * treasury fee, add or remove assets to be supported by the protocol.
     * @param treasury the address to be used as Huma treasury
     * @dev Emits an ProtocolInitialized event.
     */
    constructor(address treasury) {
        humaTreasury = treasury;

        // Add protocol owner as a pauser.
        pausers[msg.sender] = true;
        poolAdmins[msg.sender] = true;

        protocolDefaultGracePeriod = PROTOCOL_DEFAULT_GRACE_PERIOD;

        treasuryFee = DEFAULT_TREASURY_FEE;

        emit ProtocolInitialized(msg.sender);
        emit HumaTreasuryChanged(treasury);
    }

    /**
     * @notice Pauses the entire protocol. Used in extreme cases by the pausers.
     * @dev Emits a ProtocolPausedChanged event.
     */
    function pauseProtocol() external onlyPausers {
        protocolPaused = true;
        emit ProtocolPaused(msg.sender);
    }

    /**
     * @notice Unpause the entire protocol.
     * @dev Emits a ProtocolPausedChanged event.
     */
    function unpauseProtocol() external onlyOwner {
        protocolPaused = false;
        emit ProtocolUnpaused(msg.sender);
    }

    /**
     * @notice Sets the default grace period at the protocol level. Only proto admin can do so.
     * @param gracePeriod new default grace period in seconds
     * @dev Rejects any grace period shorter than 1 day to guard against fat finger or attack.
     * @dev Emits ProtocolDefaultGracePeriodChanged(uint256 newGracePeriod) event
     */
    function setProtocolDefaultGracePeriod(uint256 gracePeriod)
        external
        onlyOwner
    {
        require(
            gracePeriod >= MIN_DEFAULT_GRACE_PERIOD,
            "HumaConfig:GRACE_PERIOD_TOO_SHORT"
        );
        protocolDefaultGracePeriod = uint32(gracePeriod);
        emit ProtocolDefaultGracePeriodChanged(gracePeriod);
    }

    /**
     * @notice Sets the treasury fee (in basis points). Only proto admin can do so.
     * @param fee the new treasury fee (in bps)
     * @dev Treasury fee cannot exceed 5000 bps, i.e. 50%
     * @dev Emits a TreasuryFeeChanged(uint256 fee) event
     */
    function setTreasuryFee(uint256 fee) external onlyOwner {
        require(
            fee <= TREASURY_FEE_UPPER_BOUND,
            "HumaConfig:TREASURY_FEE_TOO_HIGH"
        );
        uint256 oldFee = treasuryFee;
        treasuryFee = uint16(fee);
        emit TreasuryFeeChanged(oldFee, fee);
    }

    /**
     * @notice Sets the address of Huma Treasury. Only superAdmin can make the change.
     * @param treasury the new Huma Treasury address
     * @dev If address(0) is provided, revert with "HumaConfig:TREASURY_ADDRESS_ZERO"
     * @dev If the current treasury address is provided, revert w/ "HumaConfig:TREASURY_ADDRESS_UNCHANGED"
     * @dev emit HumaTreasuryChanged(address newTreasury) event
     */
    function setHumaTreasury(address treasury) external onlyOwner {
        require(treasury != address(0), "HumaConfig:TREASURY_ADDRESS_ZERO");
        if (treasury != humaTreasury) {
            humaTreasury = treasury;
            emit HumaTreasuryChanged(treasury);
        }
    }

    /**
     * @notice Adds a pauser.
     * @param _pauser Address to be added to the pauser list
     * @dev If address(0) is provided, revert with "HumaConfig:PAUSER_ADDRESS_ZERO"
     * @dev If the address is already a pauser, revert w/ "HumaConfig:ALREADY_A_PAUSER"
     * @dev Emits a PauserAdded event.
     */
    function addPauser(address _pauser) external onlyOwner {
        require(_pauser != address(0), "HumaConfig:PAUSER_ADDRESS_ZERO");
        require(!pausers[_pauser], "HumaConfig:ALREADY_A_PAUSER");

        pausers[_pauser] = true;

        emit PauserAdded(_pauser, owner());
    }

    /**
     * @notice Removes a pauser.
     * @param _pauser Address to be removed from the pauser list
     * @dev If address(0) is provided, revert with "HumaConfig:PAUSER_ADDRESS_ZERO"
     * @dev If the address is not currently a pauser, revert w/ "HumaConfig:NOT_A_PAUSER"
     * @dev Emits a PauserRemoved event.
     */
    function removePauser(address _pauser) external onlyOwner {
        require(_pauser != address(0), "HumaConfig:PAUSER_ADDRESS_ZERO");
        require(pausers[_pauser], "HumaConfig:NOT_A_PAUSER");

        pausers[_pauser] = false;

        emit PauserRemoved(_pauser, owner());
    }

    /**
     * @notice Adds a pool admin.
     * @param _poolAdmin Address to be added as a pool admin
     * @dev If address(0) is provided, revert with "HumaConfig:POOL_ADMIN_ADDRESS_ZERO"
     * @dev If the address is already a poolAdmin, revert w/ "HumaConfig:ALREADY_A_POOL_ADMIN"
     * @dev Emits a PauserAdded event.
     */
    function addPoolAdmin(address _poolAdmin) external onlyOwner {
        require(_poolAdmin != address(0), "HumaConfig:POOL_ADMIN_ADDRESS_ZERO");
        require(!poolAdmins[_poolAdmin], "HumaConfig:ALREADY_A_POOL_ADMIN");

        poolAdmins[_poolAdmin] = true;

        emit PoolAdminAdded(_poolAdmin, owner());
    }

    /**
     * @notice Removes a poolAdmin.
     * @param _poolAdmin Address to be removed from the poolAdmin list
     * @dev If address(0) is provided, revert with "HumaConfig:POOL_ADMIN_ADDRESS_ZERO"
     * @dev If the address is not currently a poolAdmin, revert w/ "HumaConfig:NOT_A_POOL_ADMIN"
     * @dev Emits a PauserRemoved event.
     */
    function removePoolAdmin(address _poolAdmin) external onlyOwner {
        require(_poolAdmin != address(0), "HumaConfig:POOL_ADMIN_ADDRESS_ZERO");
        require(poolAdmins[_poolAdmin], "HumaConfig:NOT_A_POOL_ADMIN");

        poolAdmins[_poolAdmin] = false;

        emit PoolAdminRemoved(_poolAdmin, owner());
    }

    /**
     * @notice Sets the validity of an asset for liquidity in Huma. Only owner can do so.
     * @param asset Address of the valid asset.
     * @param valid The new validity status a Liquidity Asset in Pools.
     * @dev Emits a LiquidityAssetSet event.
     */
    function setLiquidityAsset(address asset, bool valid) external onlyOwner {
        if (valid) {
            validLiquidityAssets[asset] = true;
            emit LiquidityAssetAdded(asset, owner());
        } else {
            validLiquidityAssets[asset] = false;
            emit LiquidityAssetRemoved(asset, owner());
        }
    }

    function isAssetValid(address asset) public view returns (bool) {
        return validLiquidityAssets[asset];
    }

    function isPauser(address account) external view returns (bool) {
        return pausers[account];
    }

    function isPoolAdmin(address account) external view returns (bool) {
        return poolAdmins[account];
    }

    function isProtocolPaused() public view returns (bool) {
        return protocolPaused;
    }

    /// Makes sure the msg.sender is one of the pausers
    modifier onlyPausers() {
        require(pausers[msg.sender] == true, "HumaConfig:PAUSERS_REQUIRED");
        _;
    }
}
