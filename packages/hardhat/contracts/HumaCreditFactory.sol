//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./HumaInvoiceFactoring.sol";
import "./HumaLoan.sol";
import "./HumaPool.sol";
import "./interfaces/IHumaCredit.sol";

contract HumaCreditFactory {
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
        uint256 _collateralAmt,
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
                _collateralAmt,
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
                _collateralAmt,
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
        uint256 _collateralAmt,
        uint256[] memory terms
    ) internal returns (address) {
        HumaLoan humaLoan = new HumaLoan();
        humaLoan.initiate(
            _pool,
            _poolLocker,
            _humaConfig,
            _treasury,
            _borrower,
            _poolToken,
            _amount,
            _collateralAsset,
            _collateralAmt,
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
        uint256 _collateralAmt,
        uint256[] memory terms
    ) internal returns (address) {
        HumaInvoiceFactoring humaInvoice = new HumaInvoiceFactoring();
        humaInvoice.initiate(
            _pool,
            _poolLocker,
            _humaConfig,
            _treasury,
            _borrower,
            _poolToken,
            _amount,
            _collateralAsset,
            _collateralAmt,
            terms
        );

        return address(humaInvoice);
    }
}
