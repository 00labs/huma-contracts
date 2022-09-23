//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Errors {
    error creditExpiredDueToFirstDrawdownTooLate();
    error creditExpiredDueToMaturity();
    error evaluationAgentServiceAccountRequired();
    error creditLineNotInApprovedOrGoodStandingState();
    error creditLineExceeded();
    error creditLineAlreadyExists();
    error greaterThanMaxCreditLine();
    error zeroAddressProvided();
    error paymentDetectionServiceAccountRequired();
    error defaultTriggeredTooEarly();
    error receivableAssetMismatch();
    error unsupportedReceivableAsset();
    error receivableAssetParamMismatch();
    error insufficientReceivableAmount();
    error maxCreditLimitExceeded();
    error borrowingAmountLessThanPlatformFees();
}
