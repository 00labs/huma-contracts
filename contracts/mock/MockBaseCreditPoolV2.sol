//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../BasePool.sol";
import "../BaseCreditPoolStorage.sol";

contract MockBaseCreditPoolV2 is BasePool, BaseCreditPoolStorage {
    function changeCreditLine(address borrower, uint256 newLine) external {
        protocolAndPoolOn();
        onlyEvaluationAgents();
        // Borrowing amount needs to be lower than max for the pool.
        require(_poolConfig._maxCreditLine >= newLine, "GREATER_THAN_LIMIT");
        require(newLine >= _poolConfig._minBorrowAmount, "SMALLER_THAN_LIMIT");

        _creditRecordMapping[borrower].creditLimit = uint96(newLine * 2);
    }

    function getCreditLine(address account) external view returns (uint256) {
        return _creditRecordMapping[account].creditLimit;
    }

    function creditRecordMapping(address account) external view returns (BS.CreditRecord memory) {
        return _creditRecordMapping[account];
    }

    function onlyEvaluationAgents() internal view {
        require(_evaluationAgents[msg.sender], "APPROVER_REQUIRED");
    }
}
