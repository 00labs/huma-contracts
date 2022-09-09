//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {BaseStructs as BS} from "./libraries/BaseStructs.sol";

contract BaseCreditPoolStorage {
    // Divider to get monthly interest rate from APR BPS. 10000 * 12
    uint256 private constant BPS_DIVIDER = 120000;
    uint256 private constant HUNDRED_PERCENT_IN_BPS = 10000;
    uint256 private constant SECONDS_IN_A_YEAR = 31536000;

    /// mapping from wallet address to the credit record
    mapping(address => BS.CreditRecord) internal _creditRecordMapping;
    /// mapping from wallet address to the receivable supplied by this wallet
    mapping(address => BS.ReceivableInfo) internal _receivableInfoMapping;
}
