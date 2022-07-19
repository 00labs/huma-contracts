//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./HumaLoan.sol";
import "./HumaPool.sol";

contract HumaLoanFactory {
    // Helper counter used to ensure every loan has a unique ID
    uint256 humaLoanUniqueIdCounter;

    constructor() {}

    // Create a new loan. Refer to HumaLoan.initiate for parameter details
    function deployNewLoan(
        address _poolLocker,
        address _treasury,
        address _borrower,
        address _poolToken,
        uint256 _amount,
        address _collateralAsset,
        uint256 _collateralAmount,
        uint256[] memory terms
    ) external returns (address) {
        humaLoanUniqueIdCounter += 1;
        HumaLoan humaLoan = new HumaLoan();
        humaLoan.initiate(
            humaLoanUniqueIdCounter,
            _poolLocker,
            _treasury,
            _borrower,
            _poolToken,
            _amount,
            _collateralAsset,
            _collateralAmount,
            terms
        );
    }
}
