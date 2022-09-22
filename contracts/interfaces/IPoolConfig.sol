//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IPoolConfig {
    function setPoolName(string memory newName) external;

    function setEvaluationAgent(uint256 eaId, address agent) external;
}
