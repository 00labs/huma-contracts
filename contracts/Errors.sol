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
    error paymentDetectionServiceAccountRequired();
    error defaultTriggeredTooEarly();

    error zeroAddressProvided();
    error zeroAmountProvided();

    error permissionDeniedNotAdmin();
    error permissionDeniedNotLender();

    error callNotFromPool();

    error sameValue();
}
