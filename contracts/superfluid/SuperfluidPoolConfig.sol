// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {ISuperfluid} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";

import "../BasePoolConfig.sol";

contract SuperfluidPoolConfig is BasePoolConfig {
    address public host;

    address public cfa;

    function initialize(
        string memory _poolName,
        address _poolToken,
        address _humaConfig,
        address _feeManager,
        address _host,
        address _cfa
    ) public onlyOwner initializer {
        super.initialize(_poolName, _poolToken, _humaConfig, _feeManager);
        host = _host;
        cfa = _cfa;
    }

    function getSuperfluidConfig() external view returns (address host_, address cfa_) {
        host_ = host;
        cfa_ = cfa;
    }
}
