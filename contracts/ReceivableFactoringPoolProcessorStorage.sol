// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "./interfaces/IReceivablePool.sol";

contract ReceivableFactoringPoolProcessorStorage {
    IReceivablePool public pool;

    uint256[100] private __gap;
}
