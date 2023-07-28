// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "../BaseFeeManager.sol";

library LibDeployFeeManager {
    function addFeeManager() public returns (address) {
        BaseFeeManager feeManager = new BaseFeeManager();
        return address(feeManager);
    }
}
