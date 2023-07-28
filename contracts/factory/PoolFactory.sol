// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import "../openzeppelin/TransparentUpgradeableProxy.sol";

import "./LibPoolConfig.sol";
import "./LibFeeManager.sol";

contract PoolFactory is Ownable, AccessControl {
    bytes32 public constant DEPLOYER_ROLE = keccak256("DEPLOYER_ROLE");

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
        address _humaConfigAddress,
        address _hdtImplAddress,
        address _baseCreditPoolImplAddress,
        address _receivableFactoringPoolImplAddress
    ) {
        HUMA_CONFIG_ADDRESS = _humaConfigAddress;
        hdtImplAddress = _hdtImplAddress;
        baseCreditPoolImplAddress = _baseCreditPoolImplAddress;
        receivableFactoringPoolImplAddress = _receivableFactoringPoolImplAddress;
    }

    function addDeployer(address account) external onlyOwner {
        _grantRole(DEPLOYER_ROLE, account);
    }

    function removeDeployer(address account) external onlyOwner {
        _revokeRole(DEPLOYER_ROLE, account);
    }

    function createBaseCreditPool(
        string memory _poolName,
        address[] memory _poolOwner,
        address[] memory _poolExecutors
    ) external onlyRole(DEPLOYER_ROLE) {
        address feeManagerAddress = LibDeployFeeManager.addFeeManager();
        TransparentUpgradeableProxy hdt = new TransparentUpgradeableProxy(
            hdtImplAddress,
            address(this), //Todo: for now proxy is not upgradable
            ""
        );
        address poolConfigAddress = LibDeployPoolConfig.addPoolConfig();
        address timeLockAddress = addTimeLock(_poolOwner, _poolExecutors);
        TransparentUpgradeableProxy pool = new TransparentUpgradeableProxy(
            baseCreditPoolImplAddress,
            address(this), //Todo: for now proxy is not upgradable
            ""
        );
        pools[address(pool)] = PoolRecord(
            _poolName,
            PoolStatus.Created,
            timeLockAddress,
            address(hdt),
            feeManagerAddress,
            poolConfigAddress
        );
        emit PoolCreated(address(pool), _poolName);
    }

    function createReceivableFactoringPool(
        string memory _poolName,
        address[] memory _poolOwner,
        address[] memory _poolExecutors
    ) external onlyRole(DEPLOYER_ROLE) {
        address feeManagerAddress = LibDeployFeeManager.addFeeManager();
        TransparentUpgradeableProxy hdt = new TransparentUpgradeableProxy(
            hdtImplAddress,
            address(this), //Todo: for now proxy is not upgradable
            ""
        );
        address poolConfigAddress = LibDeployPoolConfig.addPoolConfig();
        address timeLockAddress = addTimeLock(_poolOwner, _poolExecutors);
        TransparentUpgradeableProxy pool = new TransparentUpgradeableProxy(
            receivableFactoringPoolImplAddress,
            address(this), //Todo: for now proxy is not upgradable
            ""
        );
        pools[address(pool)] = PoolRecord(
            _poolName,
            PoolStatus.Created,
            timeLockAddress,
            address(hdt),
            feeManagerAddress,
            poolConfigAddress
        );
        emit PoolCreated(address(pool), _poolName);
    }

    function setHDTImplAddress(address newAddress) external onlyOwner {
        address oldAddress = hdtImplAddress;
        hdtImplAddress = newAddress;
        emit HDTImplChanged(oldAddress, newAddress);
    }

    function setBaseCredtiPoolImplAddress(address newAddress) external onlyOwner {
        address oldAddress = hdtImplAddress;
        baseCreditPoolImplAddress = newAddress;
        emit BaseCredtiPoolImplChanged(oldAddress, newAddress);
    }

    function setReceivableFactoringPoolImplAddress(address newAddress) external onlyOwner {
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

    function deletePool(address _poolAddress) external onlyOwner {
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

    // function initializeFeeManager() {}

    // function initializeHDT() {}

    // function initializePoolConfig() {}

    // function initializePool() {}
}
