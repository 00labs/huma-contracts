//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./BaseCredit.sol";
import "./PoolLocker.sol";
import "./interfaces/ICredit.sol";
import "./interfaces/IPreapprovedCredit.sol";
import "./interfaces/IPoolLocker.sol";
import "./interfaces/IReputationTracker.sol";
import "./libraries/SafeMathInt.sol";
import "./libraries/SafeMathUint.sol";

import "hardhat/console.sol";

/**
 * @notice Invoice Financing
 * @dev please note abbreviation HumaIF is used in error messages to shorten the length of error msg.
 */
contract HumaInvoiceFactoring is IPreapprovedCredit, BaseCredit {
    constructor(
        address _poolToken,
        address _humaConfig,
        address _reputationTrackerFactory
    ) BaseCredit(_poolToken, _humaConfig, _reputationTrackerFactory) {}

    function postPreapprovedCreditRequest(
        address borrower,
        uint256 borrowAmt,
        address collateralAsset,
        uint256 collateralAmt,
        uint256[] memory terms
    ) public virtual override {
        poolOn();
        require(
            creditApprovers[msg.sender] == true,
            "HumaIF:ILLEGAL_CREDIT_POSTER"
        );

        // Borrowers must not have existing loans from this pool
        require(
            creditStateMapping[msg.sender].state == CreditState.Deleted,
            "HumaIF:DENY_EXISTING_LOAN"
        );

        // Borrowing amount needs to be higher than min for the pool.
        require(borrowAmt >= minBorrowAmt, "HumaIF:SMALLER_THAN_LIMIT");

        // Borrowing amount needs to be lower than max for the pool.
        require(maxBorrowAmt >= borrowAmt, "HumaIF:GREATER_THAN_LIMIT");

        initiate(borrower, borrowAmt, address(0), 0, terms);
        approveCredit(borrower);
    }

    function processRefund(address receiver, uint256 amount)
        internal
        returns (bool)
    {
        PoolLocker locker = PoolLocker(poolLocker);
        locker.transfer(receiver, amount);

        return true;
    }
}
