// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./ReceivableFactoringPoolProcessorStorage.sol";

abstract contract ReceivableFactoringPoolProcessor is
    Initializable,
    ReceivableFactoringPoolProcessorStorage
{
    uint256 internal constant SECONDS_IN_A_DAY = 1 days;

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

    function initialize(address poolAddr) public initializer {
        pool = IReceivablePool(poolAddr);
    }

    // function _onlyPool() internal view {
    //     if (msg.sender != address(pool)) revert();
    // }
}
