//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./HumaInvoiceFactoring.sol";
import "./HumaLoan.sol";
import "./HumaPool.sol";
import "./interfaces/IHumaCredit.sol";

contract HumaCreditFactory {
    // Helper counter used to ensure every loan has a unique ID
    uint256 humaLoanUniqueIdCounter;

    constructor() {}

    function deployNewCredit(
        address payable _pool,
        CreditType _type,
        address _poolLocker,
        address _humaConfig,
        address _treasury,
        address _borrower,
        address _poolToken,
        uint256 _amount,
        address _collateralAsset,
        uint256 _collateralAmount,
        uint256[] memory terms
    ) external returns (address credit) {
        if (_type == CreditType.Loan)
            credit = deployNewLoan(
                _pool,
                _poolLocker,
                _humaConfig,
                _treasury,
                _borrower,
                _poolToken,
                _amount,
                _collateralAsset,
                _collateralAmount,
                terms
            );
        else if (_type == CreditType.InvoiceFactoring)
            credit = deployNewInvoiceFactoring(
                _pool,
                _poolLocker,
                _humaConfig,
                _treasury,
                _borrower,
                _poolToken,
                _amount,
                _collateralAsset,
                _collateralAmount,
                terms
            );
    }

    // Create a new loan. Refer to HumaLoan.initiate for parameter details
    function deployNewLoan(
        address payable _pool,
        address _poolLocker,
        address _humaConfig,
        address _treasury,
        address _borrower,
        address _poolToken,
        uint256 _amount,
        address _collateralAsset,
        uint256 _collateralAmount,
        uint256[] memory terms
    ) internal returns (address) {
        humaLoanUniqueIdCounter += 1;

        HumaLoan humaLoan = new HumaLoan();
        humaLoan.initiate(
            _pool,
            humaLoanUniqueIdCounter,
            _poolLocker,
            _humaConfig,
            _treasury,
            _borrower,
            _poolToken,
            _amount,
            _collateralAsset,
            _collateralAmount,
            terms
        );

        return address(humaLoan);
    }

    // Create a new loan. Refer to HumaLoan.initiate for parameter details
    function deployNewInvoiceFactoring(
        address payable _pool,
        address _poolLocker,
        address _humaConfig,
        address _treasury,
        address _borrower,
        address _poolToken,
        uint256 _amount,
        address _collateralAsset,
        uint256 _collateralAmount,
        uint256[] memory terms
    ) internal returns (address) {
        humaLoanUniqueIdCounter += 1;

        HumaInvoiceFactoring humaInvoice = new HumaInvoiceFactoring();
        humaInvoice.initiate(
            _pool,
            humaLoanUniqueIdCounter,
            _poolLocker,
            _humaConfig,
            _treasury,
            _borrower,
            _poolToken,
            _amount,
            _collateralAsset,
            _collateralAmount,
            terms
        );

        return address(humaInvoice);
    }
}
