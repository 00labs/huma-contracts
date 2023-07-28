// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "../BasePoolConfig.sol";

library LibDeployPoolConfig {
    function addPoolConfig() public returns (address) {
        BasePoolConfig poolConfig = new BasePoolConfig();
        return address(poolConfig);
    }
}
