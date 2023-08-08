// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "../BaseCreditPool.sol";
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

    function initializeBaseCreditPool(address _poolAddress, address _poolConfigAddress) public {
        BaseCreditPool pool = BaseCreditPool(_poolAddress);
        pool.initialize(_poolConfigAddress);
    }

    function initializeReceivableFactoringPool(address _poolAddress, address _poolConfigAddress)
        public
    {
        ReceivableFactoringPool pool = ReceivableFactoringPool(_poolAddress);
        pool.initialize(_poolConfigAddress);
    }
}
