//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @dev Math operations with safety checks that revert on error
 * Based on code of https://github.com/atpar/funds-distribution-token/blob/master/contracts/external/math/SafeMathInt.sol
 */
library SafeMathUint {
    function toInt256Safe(uint256 a) internal pure returns (int256 b) {
        b = int256(a);
        require(b >= 0);
    }
}
