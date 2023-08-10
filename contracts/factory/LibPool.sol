// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "../BasePool.sol";
import "../ReceivableFactoringPool.sol";
import "../openzeppelin/TransparentUpgradeableProxy.sol";

library LibPool {
    function addPool(address _poolImplAddress) public returns (address) {
        TransparentUpgradeableProxy pool = new TransparentUpgradeableProxy(
            _poolImplAddress,
            msg.sender, //Todo: make this to be the real proxy admin
            ""
        );
        return address(pool);
    }

    function initializePool(address _poolAddress, address _poolConfigAddress) public {
        BasePool pool = BasePool(_poolAddress);
        pool.initialize(_poolConfigAddress);
    }
}
