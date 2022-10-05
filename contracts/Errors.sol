// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

contract Errors {
    error creditExpiredDueToFirstDrawdownTooLate();
    error creditExpiredDueToMaturity();
    error evaluationAgentServiceAccountRequired();
    error creditLineNotInGoodStandingState();
    error creditLineNotInStateForMakingPayment();
    error creditLineNotInStateForDrawdown();
    error creditLineExceeded();
    error creditLineAlreadyExists();
    error greaterThanMaxCreditLine();
    error paymentDetectionServiceAccountRequired();
    error defaultTriggeredTooEarly();
    error defaultHasAlreadyBeenTriggered();

    error zeroAddressProvided();
    error zeroAmountProvided();
    error amountTooLow();
    error creditLineGreatThanUpperLimit();

    error permissionDeniedNotAdmin();
    error permissionDeniedNotLender();

    error callNotFromPool();

    error sameValue();
    error receivableAssetMismatch();
    error unsupportedReceivableAsset();
    error receivableAssetParamMismatch();
    error insufficientReceivableAmount();
    error maxCreditLimitExceeded();
    error borrowingAmountLessThanPlatformFees();
    error poolOwnerNotEnoughLiquidity();
    error evaluationAgentNotEnoughLiquidity();
    error withdrawnAmountHigherThanBalance();
    error withdrawTooSoon();
    error assetNotMatchWithPoolAsset();
    error paymentAlreadyProcessed();
    error exceededPoolLiquidityCap();

    error minPrincipalPaymentRateSettingTooHigh();
    error protocolIsPaused();
    error poolIsNotOn();
    error invalidBasisPointHigherThan10000();

    error notPoolOwner();
    error notProtocolOwner();
    error notEvaluationAgent();
    error notPauser();
    error notPool();

    error alreayAPauser();
    error alreadyPoolAdmin();

    error defaultGracePeriodLessThanMinAllowed();
    error treasuryFeeHighThanUpperLimit();

    error proposedEADoesNotOwnProvidedEANFT();
    error underlyingTokenNotApprovedForHumaProtocol();

    error requestedCreditWithZeroDuration();
}
