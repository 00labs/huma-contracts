//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @dev Math operations with safety checks that revert on error
 * @dev SafeMath adapted for int256
 * Based on code of https://github.com/atpar/funds-distribution-token/blob/master/contracts/external/math/SafeMathInt.sol
 */
library SafeMathInt {
    function mul(int256 a, int256 b) internal pure returns (int256 c) {
        // Prevent overflow when multiplying INT256_MIN with -1
        // https://github.com/RequestNetwork/requestNetwork/issues/43
        require(!(a == -2**255 && b == -1) && !(b == -2**255 && a == -1));

        c = a * b;
        require((b == 0) || (c / b == a));
    }

    function div(int256 a, int256 b) internal pure returns (int256) {
        // Prevent overflow when dividing INT256_MIN by -1
        // https://github.com/RequestNetwork/requestNetwork/issues/43
        require(!(a == -2**255 && b == -1) && (b > 0));

        return a / b;
    }

    function sub(int256 a, int256 b) internal pure returns (int256) {
        require((b >= 0 && a - b <= a) || (b < 0 && a - b > a));

        return a - b;
    }

    function add(int256 a, int256 b) internal pure returns (int256 c) {
        c = a + b;
        require((b >= 0 && c >= a) || (b < 0 && c < a));
    }

    function toUint256Safe(int256 a) internal pure returns (uint256) {
        require(a >= 0);
        return uint256(a);
    }
}
