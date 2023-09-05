//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ISuperfluid, ISuperApp, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract SuperfluidSuperAppRegister is Ownable {
    ISuperfluid public host;

    event SuperAppRegistered(address superApp);

    constructor(ISuperfluid _host) {
        host = _host;
    }

    function register(ISuperApp superApp) external onlyOwner {
        uint256 configWord = SuperAppDefinitions.APP_LEVEL_FINAL |
            SuperAppDefinitions.BEFORE_AGREEMENT_CREATED_NOOP |
            SuperAppDefinitions.BEFORE_AGREEMENT_UPDATED_NOOP |
            SuperAppDefinitions.BEFORE_AGREEMENT_TERMINATED_NOOP;

        host.registerAppByFactory(superApp, configWord);

        emit SuperAppRegistered(address(superApp));
    }
}
