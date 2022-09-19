//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./BaseCreditPool.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IResolver {
    function checker() external view returns (bool canExec, bytes memory execPayload);
}

contract BaseCreditPoolDefaultingResolver is IResolver, Ownable {
    // A listing of all BaseCreditPools this resolver should maintain
    address[] internal pools;

    function getPools() external view returns (address[] memory) {
        return pools;
    }

    function push(address _pool) external onlyOwner {
        pools.push(_pool);
    }

    function remove(uint256 index) external onlyOwner {
        delete pools[index];
    }

    function checker() external view override returns (bool canExec, bytes memory execPayload) {
        for (uint256 i = 0; i < pools.length; i++) {
            BaseCreditPool pool = BaseCreditPool(pools[i]);

            // Iterate over all active loans in a pool
            address[] memory creditLines = pool.creditLines();
            for (uint256 j = 0; j < creditLines.length; j++) {
                if (pool.isLate(creditLines[j])) {
                    execPayload = abi.encodeWithSelector(
                        BaseCreditPool.updateDueInfo.selector,
                        creditLines[j]
                    );

                    return (true, execPayload);
                }
            }
        }

        return (false, bytes("No late active loans found"));
    }
}
