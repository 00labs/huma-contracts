//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ISuperfluid, ISuperApp, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

contract MockSuperAppRegister {
    ISuperfluid public host;

    constructor(ISuperfluid _host) {
        host = _host;
    }

    function register(ISuperApp app) external {
        host.registerAppByFactory(
            app,
            SuperAppDefinitions.APP_LEVEL_FINAL |
                SuperAppDefinitions.BEFORE_AGREEMENT_CREATED_NOOP |
                SuperAppDefinitions.BEFORE_AGREEMENT_UPDATED_NOOP |
                SuperAppDefinitions.BEFORE_AGREEMENT_TERMINATED_NOOP
        );
    }
}
