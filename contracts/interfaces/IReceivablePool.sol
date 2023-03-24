// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {BaseStructs as BS} from "../libraries/BaseStructs.sol";

/**
 * @notice Interface for contracts that can record pre-approved credit request
 */
interface IReceivablePool {
    function getCoreData()
        external
        view
        returns (
            address underlyingToken_,
            address poolToken_,
            address humaConfig_,
            address feeManager_
        );

    function creditRecordStaticMapping(address account)
        external
        view
        returns (BS.CreditRecordStatic memory);

    function validateReceivableAsset(
        address borrower,
        uint256 borrowAmount,
        address receivableAsset,
        uint256 receivableParam
    ) external;

    function drawdown(address borrower, uint256 borrowAmount)
        external
        returns (uint256 netAmountToBorrower);
}
