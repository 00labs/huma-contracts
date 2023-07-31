// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import "./LibPoolConfig.sol";
import "./LibFeeManager.sol";
import "./LibHDT.sol";
import "./LibPool.sol";

contract PoolFactory is AccessControl {
    bytes32 public constant DEPLOYER_ROLE = keccak256("DEPLOYER_ROLE");
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    address public HUMA_CONFIG_ADDRESS;
    address public hdtImplAddress;
    address public baseCreditPoolImplAddress;
    address public receivableFactoringPoolImplAddress;

    mapping(address => PoolRecord) private pools;

    enum PoolStatus {
        Created,
        Initialized,
        Deleted
    }

    struct PoolRecord {
        string poolName;
        PoolStatus poolStatus;
        address poolTimeLock;
        address hdt;
        address feeManager;
        address poolConfig;
    }

    event HDTImplChanged(address oldAddress, address newAddress);
    event BaseCredtiPoolImplChanged(address oldAddress, address newAddress);
    event ReceivableFactoringPoolImplChanged(address oldAddress, address newAddress);

    event PoolDeleted(address poolAddress);
    event DeployerAdded(address deployerAddress);
    event DeployerRemoved(address deployerAddress);

    event PoolCreated(address poolAddress, string poolName);

    constructor(
        address _protocolOwner,
        address _humaConfigAddress,
        address _hdtImplAddress,
        address _baseCreditPoolImplAddress,
        address _receivableFactoringPoolImplAddress
    ) {
        _grantRole(OWNER_ROLE, _protocolOwner);
        HUMA_CONFIG_ADDRESS = _humaConfigAddress;
        hdtImplAddress = _hdtImplAddress;
        baseCreditPoolImplAddress = _baseCreditPoolImplAddress;
        receivableFactoringPoolImplAddress = _receivableFactoringPoolImplAddress;
    }

    function addDeployer(address account) external onlyRole(OWNER_ROLE) {
        _grantRole(DEPLOYER_ROLE, account);
    }

    function removeDeployer(address account) external onlyRole(OWNER_ROLE) {
        _revokeRole(DEPLOYER_ROLE, account);
    }

    function createBaseCreditPool(
        string memory _poolName,
        address[] memory _poolOwner,
        address[] memory _poolExecutors
    ) external onlyRole(DEPLOYER_ROLE) {
        address feeManagerAddress = LibFeeManager.addFeeManager();
        address hdt = LibHDT.addHDT(hdtImplAddress);
        address poolConfigAddress = LibPoolConfig.addPoolConfig();
        address timeLockAddress = addTimeLock(_poolOwner, _poolExecutors);
        address pool = LibPool.addPool(baseCreditPoolImplAddress);
        pools[pool] = PoolRecord(
            _poolName,
            PoolStatus.Created,
            timeLockAddress,
            address(hdt),
            feeManagerAddress,
            poolConfigAddress
        );
        emit PoolCreated(pool, _poolName);
    }

    function initializePoolFeeManager(
        address _poolAddress,
        uint256 _frontLoadingFeeFlat,
        uint256 _frontLoadingFeeBps,
        uint256 _lateFeeFlat,
        uint256 _lateFeeBps,
        uint256 _membershipFee,
        uint256 _minPrincipalRateInBps
    ) external onlyRole(DEPLOYER_ROLE) {
        LibFeeManager.initializeFeeManager(
            pools[_poolAddress].feeManager,
            _frontLoadingFeeFlat,
            _frontLoadingFeeBps,
            _lateFeeFlat,
            _lateFeeBps,
            _membershipFee,
            _minPrincipalRateInBps
        );
        LibFeeManager.transferOwnership(
            pools[_poolAddress].feeManager,
            pools[_poolAddress].poolTimeLock
        );
    }

    function initializeHDT(
        address _poolAddress,
        string memory name,
        string memory symbol,
        address underlyingToken
    ) external onlyRole(DEPLOYER_ROLE) {
        LibHDT.initializeHDT(pools[_poolAddress].hdt, name, symbol, underlyingToken);
        LibHDT.transferOwnership(pools[_poolAddress].hdt, pools[_poolAddress].poolTimeLock);
    }

    function initializePoolConfigTwo(
        address _poolAddress,
        uint256 liquidityCap,
        uint256 poolOwnerRewards,
        uint256 poolOwnerLiquidity,
        uint256 EARewards,
        uint256 EALiquidity,
        uint256 maxCreditLine,
        uint256 _apr,
        uint256 receivableRequiredInBps
    ) external onlyRole(DEPLOYER_ROLE) {
        LibPoolConfig.initializePoolLiquidityConfig(
            pools[_poolAddress].poolConfig,
            liquidityCap,
            poolOwnerRewards,
            poolOwnerLiquidity,
            EARewards,
            EALiquidity,
            maxCreditLine,
            _apr,
            receivableRequiredInBps
        );
        LibPoolConfig.transferOwnership(
            pools[_poolAddress].poolConfig,
            pools[_poolAddress].poolTimeLock
        );
    }

    function initializePoolConfigOne(
        address _poolAddress,
        address _poolOwnerTreasury,
        uint256 _poolPayPeriod,
        uint256 withdrawalLockoutPeriod
    ) external onlyRole(DEPLOYER_ROLE) {
        LibPoolConfig.initializePoolBasicConfig(
            pools[_poolAddress].poolConfig,
            pools[_poolAddress].poolName,
            _poolAddress,
            pools[_poolAddress].hdt,
            HUMA_CONFIG_ADDRESS,
            pools[_poolAddress].feeManager,
            _poolOwnerTreasury,
            _poolPayPeriod,
            withdrawalLockoutPeriod
        );
    }

    function initializeBaseCreditPool(address _poolAddress) external onlyRole(DEPLOYER_ROLE) {
        LibPool.initializeBaseCreditPool(_poolAddress, pools[_poolAddress].poolConfig);
    }

    function createReceivableFactoringPool(
        string memory _poolName,
        address[] memory _poolOwner,
        address[] memory _poolExecutors
    ) external onlyRole(DEPLOYER_ROLE) {
        address feeManagerAddress = LibFeeManager.addFeeManager();
        address hdt = LibHDT.addHDT(hdtImplAddress);
        address poolConfigAddress = LibPoolConfig.addPoolConfig();
        address timeLockAddress = addTimeLock(_poolOwner, _poolExecutors);
        address pool = LibPool.addPool(receivableFactoringPoolImplAddress);
        pools[pool] = PoolRecord(
            _poolName,
            PoolStatus.Created,
            timeLockAddress,
            address(hdt),
            feeManagerAddress,
            poolConfigAddress
        );
        emit PoolCreated(pool, _poolName);
    }

    function initializeReceivableFactoringPool(address _poolAddress)
        external
        onlyRole(DEPLOYER_ROLE)
    {
        LibPool.initializeReceivableFactoringPool(_poolAddress, pools[_poolAddress].poolConfig);
    }

    function setHDTImplAddress(address newAddress) external onlyRole(OWNER_ROLE) {
        address oldAddress = hdtImplAddress;
        hdtImplAddress = newAddress;
        emit HDTImplChanged(oldAddress, newAddress);
    }

    function setBaseCredtiPoolImplAddress(address newAddress) external onlyRole(OWNER_ROLE) {
        address oldAddress = hdtImplAddress;
        baseCreditPoolImplAddress = newAddress;
        emit BaseCredtiPoolImplChanged(oldAddress, newAddress);
    }

    function setReceivableFactoringPoolImplAddress(address newAddress)
        external
        onlyRole(OWNER_ROLE)
    {
        address oldAddress = hdtImplAddress;
        receivableFactoringPoolImplAddress = newAddress;
        emit ReceivableFactoringPoolImplChanged(oldAddress, newAddress);
    }

    function checkPool(address _poolAddress) external view returns (PoolRecord memory) {
        if (_poolAddress == address(0)) {
            revert("ZERO_ADDRESS");
        }
        return pools[_poolAddress];
    }

    function deletePool(address _poolAddress) external onlyRole(OWNER_ROLE) {
        if (
            pools[_poolAddress].poolStatus != PoolStatus.Created ||
            pools[_poolAddress].poolStatus != PoolStatus.Initialized
        ) {
            revert("NOT_VALID_POOL");
        }
        pools[_poolAddress].poolStatus = PoolStatus.Deleted;

        emit PoolDeleted(_poolAddress);
    }

    function addTimeLock(address[] memory poolAdmins, address[] memory poolExecutors)
        internal
        // only one account can be pool admin
        onlyRole(DEPLOYER_ROLE)
        returns (address)
    {
        TimelockController timeLock = new TimelockController(0, poolAdmins, poolExecutors);
        return address(timeLock);
    }
}
