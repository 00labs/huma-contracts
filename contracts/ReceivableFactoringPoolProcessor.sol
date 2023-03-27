// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./ReceivableFactoringPoolProcessorStorage.sol";

abstract contract ReceivableFactoringPoolProcessor is
    Initializable,
    ReceivableFactoringPoolProcessorStorage
{
    uint256 internal constant HUNDRED_PERCENT_IN_BPS = 10000;
    uint256 internal constant SECONDS_IN_A_DAY = 1 days;
    uint256 internal constant SECONDS_IN_A_YEAR = 365 days;

    event DrawdownMadeWithReceivable(
        address indexed borrower,
        uint256 borrowAmount,
        uint256 netAmountToBorrower,
        address receivableAsset,
        uint256 receivableTokenId
    );

    constructor() {
        _disableInitializers();
    }

    function _baseInitialize(address poolAddr) internal onlyInitializing {
        pool = IReceivablePool(poolAddr);
    }
}
