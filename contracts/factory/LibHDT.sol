// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "../HDT/HDT.sol";
import "../openzeppelin/TransparentUpgradeableProxy.sol";

library LibHDT {
    function addHDT(address _hdtImplAddress) public returns (address) {
        TransparentUpgradeableProxy hdt = new TransparentUpgradeableProxy(
            _hdtImplAddress,
            msg.sender, //Todo: make this to be the real proxy admin
            ""
        );
        return address(hdt);
    }

    function initializeHDT(
        address _hdtAddress,
        string memory name,
        string memory symbol,
        address underlyingToken
    ) public {
        HDT hdt = HDT(_hdtAddress);
        hdt.initialize(name, symbol, underlyingToken);
    }

    function transferOwnership(address _hdtAddress, address newOwner) public {
        HDT hdt = HDT(_hdtAddress);
        hdt.transferOwnership(newOwner);
    }
}
