//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./interfaces/IHumaPoolAdmins.sol";
import "./interfaces/IHumaPoolLoanHelper.sol";
import "./interfaces/IHumaPoolLocker.sol";

contract HumaLoan {
  using SafeERC20 for IERC20;

  struct InitialValues {
    uint256 amount;
    uint256 paybackPerInterval;
    uint256 paybackInterval;
    uint256 interestRateBasis;
    address pool;
  }

  uint256 public amount;
  uint256 public amountPaidBack;
  uint256 public issuedTimestamp;
  uint256 public lastPaymentTimestamp;
  uint256 public paybackPerInterval;
  uint256 public paybackInterval;
  uint256 public interestRateBasis; // Represented in percentiles e.g. 5% = 5

  address public immutable pool;

  constructor(InitialValues memory _initialValues) {
    amount = _initialValues.amount;
    amountPaidBack = 0;
    issuedTimestamp = block.timestamp;
    lastPaymentTimestamp = 0;
    paybackPerInterval = _initialValues.paybackPerInterval;
    paybackInterval = _initialValues.paybackInterval;
    interestRateBasis = _initialValues.interestRateBasis;

    pool = _initialValues.pool;
  }

  function markPayment(uint256 _amount) external returns (bool) {
    amountPaidBack += _amount;
    lastPaymentTimestamp = block.timestamp;

    return true;
  }

  function getLoanInformation()
    external
    view
    returns (
      uint256 _amount,
      uint256 _amountPaidBack,
      uint256 _issuedTimestamp,
      uint256 _lastPaymentTimestamp,
      uint256 _paybackPerInterval,
      uint256 _paybackInterval,
      uint256 _interestRateBasis
    )
  {
    return (
      amount,
      amountPaidBack,
      issuedTimestamp,
      lastPaymentTimestamp,
      paybackPerInterval,
      paybackInterval,
      interestRateBasis
    );
  }
}
