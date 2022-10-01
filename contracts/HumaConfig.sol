// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "./Errors.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "hardhat/console.sol";

enum CreditType {
    Loan,
    ReceivableFactoringPool,
    XToOwn
}

/** @notice HumaConfig maintains all the global configurations supported by Huma protocol.
 */
contract HumaConfig is Ownable {
    /// Lower bound of protocol default grace period.
    uint32 private constant MIN_DEFAULT_GRACE_PERIOD = 1 days;

    /// The initial value for default grace period.
    uint32 private constant PROTOCOL_DEFAULT_GRACE_PERIOD = 60 days;

    /// The default treasury fee in bps.
    uint16 private constant DEFAULT_TREASURY_FEE = 1000; // 10%

    /// The treasury fee upper bound in bps.
    uint16 private constant TREASURY_FEE_UPPER_BOUND = 5000; // 0.5%

    /// Expect to pack the next five fields in one storage slot.
    /// Flag that shows whether the protocol is paused or not
    bool public protocolPaused;

    /// Seconds passed the due date before trigging a default.
    uint32 public protocolDefaultGracePeriodInSeconds;

    /// Protocol fee of the loan origination (in bps). Other fees are defined at pool level.
    uint16 public protocolFee;

    /// humaTreasury is the protocol treasury
    address public humaTreasury;

    /// address of EvaluationAgentNFT contract
    address public eaNFTContractAddress;

    /// pausers can pause the pool.
    mapping(address => bool) private pausers;

    // poolAdmins has the list of approved pool admins / pool owners.
    mapping(address => bool) private poolAdmins;

    /// List of assets supported by the protocol for investing and borrowing
    mapping(address => bool) private validLiquidityAssets;

    /// service account for Huma's evaluation agent hosting service
    address public eaServiceAccount;

    /// service account for Huma's payment detection service
    address public pdsServiceAccount;

    event ProtocolInitialized(address by);
    event HumaTreasuryChanged(address indexed newTreasuryAddress);
    event ProtocolPaused(address by);
    event ProtocolUnpaused(address by);
    event ProtocolDefaultGracePeriodChanged(uint256 gracePeriod);
    event TreasuryFeeChanged(uint256 oldFee, uint256 newFee);
    event PauserAdded(address indexed pauser, address by);
    event PauserRemoved(address indexed pauser, address by);
    event PoolAdminAdded(address indexed poolAdmin, address by);
    event PoolAdminRemoved(address indexed poolAdmin, address by);
    event EANFTContractAddressChanged(address eaNFT);
    event EAServiceAccount(address eaService);
    event PDSServiceAccount(address pdsService);

    event LiquidityAssetAdded(address asset, address by);
    event LiquidityAssetRemoved(address asset, address by);

    /**
     * @notice Initiates the config. Only owner can appoint set the treasury
     * address, add pausers and pool admins, change the default grace period,
     * treasury fee, add or remove assets to be supported by the protocol.
     * @param treasury the address to be used as Huma treasury
     * @dev Emits an ProtocolInitialized event.
     */
    constructor(address treasury) {
        if (treasury == address(0)) revert Errors.zeroAddressProvided();
        humaTreasury = treasury;

        // Add protocol owner as a pauser.
        pausers[msg.sender] = true;
        poolAdmins[msg.sender] = true;

        protocolDefaultGracePeriodInSeconds = PROTOCOL_DEFAULT_GRACE_PERIOD;

        protocolFee = DEFAULT_TREASURY_FEE;

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
    function setProtocolDefaultGracePeriod(uint256 gracePeriod) external onlyOwner {
        if (gracePeriod < MIN_DEFAULT_GRACE_PERIOD)
            revert Errors.defaultGracePeriodLessThanMinAllowed();
        protocolDefaultGracePeriodInSeconds = uint32(gracePeriod);
        emit ProtocolDefaultGracePeriodChanged(gracePeriod);
    }

    /**
     * @notice Sets the treasury fee (in basis points). Only proto admin can do so.
     * @param fee the new treasury fee (in bps)
     * @dev Treasury fee cannot exceed 5000 bps, i.e. 50%
     * @dev Emits a TreasuryFeeChanged(uint256 fee) event
     */
    function setTreasuryFee(uint256 fee) external onlyOwner {
        if (fee > TREASURY_FEE_UPPER_BOUND) revert Errors.treasuryFeeHighThanUpperLimit();
        uint256 oldFee = protocolFee;
        protocolFee = uint16(fee);
        emit TreasuryFeeChanged(oldFee, fee);
    }

    /**
     * @notice Sets the address of Huma Treasury. Only superAdmin can make the change.
     * @param treasury the new Huma Treasury address
     * @dev If address(0) is provided, revert with "zeroAddressProvided()"
     * @dev If the current treasury address is provided, revert w/ "TREASURY_ADDRESS_UNCHANGED"
     * @dev emit HumaTreasuryChanged(address newTreasury) event
     */
    function setHumaTreasury(address treasury) external onlyOwner {
        if (treasury == address(0)) revert Errors.zeroAddressProvided();
        if (treasury != humaTreasury) {
            humaTreasury = treasury;
            emit HumaTreasuryChanged(treasury);
        }
    }

    /**
     * @notice Adds a pauser.
     * @param _pauser Address to be added to the pauser list
     * @dev If address(0) is provided, revert with "zeroAddressProvided()"
     * @dev If the address is already a pauser, revert w/ "alreayAPauser"
     * @dev Emits a PauserAdded event.
     */
    function addPauser(address _pauser) external onlyOwner {
        if (_pauser == address(0)) revert Errors.zeroAddressProvided();
        if (pausers[_pauser]) revert Errors.alreayAPauser();

        pausers[_pauser] = true;

        emit PauserAdded(_pauser, msg.sender);
    }

    /**
     * @notice Removes a pauser.
     * @param _pauser Address to be removed from the pauser list
     * @dev If address(0) is provided, revert with "zeroAddressProvided()"
     * @dev If the address is not currently a pauser, revert w/ "notPauser()"
     * @dev Emits a PauserRemoved event.
     */
    function removePauser(address _pauser) external onlyOwner {
        if (_pauser == address(0)) revert Errors.zeroAddressProvided();
        if (pausers[_pauser] == false) revert Errors.notPauser();

        pausers[_pauser] = false;

        emit PauserRemoved(_pauser, msg.sender);
    }

    /**
     * @notice Adds a pool admin.
     * @param _poolAdmin Address to be added as a pool admin
     * @dev If address(0) is provided, revert with "zeroAddressProvided()"
     * @dev If the address is already a poolAdmin, revert w/ "ALREADY_A_POOL_ADMIN"
     * @dev Emits a PauserAdded event.
     */
    function addPoolAdmin(address _poolAdmin) external onlyOwner {
        if (_poolAdmin == address(0)) revert Errors.zeroAddressProvided();
        if (poolAdmins[_poolAdmin]) revert Errors.alreadyPoolAdmin();

        poolAdmins[_poolAdmin] = true;

        emit PoolAdminAdded(_poolAdmin, msg.sender);
    }

    /**
     * @notice Removes a poolAdmin.
     * @param _poolAdmin Address to be removed from the poolAdmin list
     * @dev If address(0) is provided, revert with "zeroAddressProvided()"
     * @dev If the address is not currently a poolAdmin, revert w/ "notPoolOwner()"
     * @dev Emits a PauserRemoved event.
     */
    function removePoolAdmin(address _poolAdmin) external onlyOwner {
        if (_poolAdmin == address(0)) revert Errors.zeroAddressProvided();
        if (poolAdmins[_poolAdmin] == false) revert Errors.notPoolOwner();

        poolAdmins[_poolAdmin] = false;

        emit PoolAdminRemoved(_poolAdmin, msg.sender);
    }

    function setEANFTContractAddress(address contractAddress) external onlyOwner {
        // todo need to add a test against zero address
        if (contractAddress == address(0)) revert Errors.zeroAddressProvided();
        eaNFTContractAddress = contractAddress;
        emit EANFTContractAddressChanged(contractAddress);
    }

    function setEAServiceAccount(address accountAddress) external onlyOwner {
        if (accountAddress == address(0)) revert Errors.zeroAddressProvided();
        eaServiceAccount = accountAddress;
        emit EAServiceAccount(accountAddress);
    }

    function setPDSServiceAccount(address accountAddress) external onlyOwner {
        if (accountAddress == address(0)) revert Errors.zeroAddressProvided();
        pdsServiceAccount = accountAddress;
        emit PDSServiceAccount(accountAddress);
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
            emit LiquidityAssetAdded(asset, msg.sender);
        } else {
            validLiquidityAssets[asset] = false;
            emit LiquidityAssetRemoved(asset, msg.sender);
        }
    }

    function isAssetValid(address asset) external view returns (bool) {
        return validLiquidityAssets[asset];
    }

    function isPauser(address account) external view returns (bool) {
        return pausers[account];
    }

    function isPoolAdmin(address account) external view returns (bool) {
        return poolAdmins[account];
    }

    function isProtocolPaused() external view returns (bool) {
        return protocolPaused;
    }

    /// Makes sure the msg.sender is one of the pausers
    modifier onlyPausers() {
        if (pausers[msg.sender] == false) revert Errors.notPauser();
        _;
    }
}
