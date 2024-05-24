// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "../BaseFeeManager.sol";

library LibFeeManager {
    function addFeeManager() public returns (address) {
        BaseFeeManager feeManager = new BaseFeeManager();
        return address(feeManager);
    }

    function initializeFeeManager(
        address _feeManagerAddress,
        uint256 _frontLoadingFeeFlat,
        uint256 _frontLoadingFeeBps,
        uint256 _lateFeeFlat,
        uint256 _lateFeeBps,
        uint256 _membershipFee,
        uint256 _minPrincipalRateInBps
    ) public {
        BaseFeeManager feeManager = BaseFeeManager(_feeManagerAddress);
        feeManager.setFees(
            _frontLoadingFeeFlat,
            _frontLoadingFeeBps,
            _lateFeeFlat,
            _lateFeeBps,
            _membershipFee
        );
        feeManager.setMinPrincipalRateInBps(_minPrincipalRateInBps);
    }

    function transferOwnership(address _feeManagerAddress, address newOwner) public {
        BaseFeeManager feeManager = BaseFeeManager(_feeManagerAddress);
        feeManager.transferOwnership(newOwner);
    }

    function owner(address _feeManagerAddress) public view returns (address) {
        BaseFeeManager feeManager = BaseFeeManager(_feeManagerAddress);
        return feeManager.owner();
    }
}
