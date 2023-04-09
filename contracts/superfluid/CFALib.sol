// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ISuperToken} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {CFAv1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/CFAv1Library.sol";

library CFALib {
    using CFAv1Library for CFAv1Library.InitData;

    function _decreaseFlow(
        CFAv1Library.InitData storage cfaV1,
        IConstantFlowAgreementV1 _cfa,
        ISuperToken token,
        address to,
        int96 by
    ) internal {
        (, int96 curRate, , ) = _cfa.getFlow(token, address(this), to);
        int96 newRate = curRate - by;
        require(newRate >= 0, "new rate would be negative");

        if (newRate == 0) {
            cfaV1.deleteFlow(address(this), to, token);
        } else {
            cfaV1.updateFlow(to, token, newRate);
        }
    }

    function _increaseFlow(
        CFAv1Library.InitData storage cfaV1,
        IConstantFlowAgreementV1 _cfa,
        ISuperToken token,
        address to,
        int96 by
    ) internal {
        (, int96 curRate, , ) = _cfa.getFlow(token, address(this), to);
        if (curRate == 0) {
            cfaV1.createFlow(to, token, by);
        } else {
            int96 newRate = curRate + by;
            cfaV1.updateFlow(to, token, newRate);
        }
    }

    /**
     * @notice Increase the rate of the specified flow by authorized operator,
     * if this flow doesn't exist, create it,
     * if this flow exists, update it.
     */
    function _increaseFlowByOperator(
        CFAv1Library.InitData storage cfaV1,
        IConstantFlowAgreementV1 _cfa,
        ISuperToken token,
        address from,
        address to,
        int96 by
    ) internal {
        (, uint8 permissions, int96 allowance) = _cfa.getFlowOperatorData(
            token,
            from,
            address(this)
        );

        //always true when full control has been given
        require(permissions == 7, "origin hasn't permitted Niflot as operator");
        (, int96 curRate, , ) = _cfa.getFlow(token, from, to);

        if (curRate == 0) {
            cfaV1.createFlowByOperator(from, to, token, by);
        } else {
            int96 newRate = curRate + by;
            require(newRate < allowance, "origin doesn't allow us to allocate that flowrate");

            cfaV1.updateFlowByOperator(from, to, token, newRate);
        }
    }

    function _decreaseFlowByOperator(
        CFAv1Library.InitData storage cfaV1,
        IConstantFlowAgreementV1 _cfa,
        ISuperToken token,
        address from,
        address to,
        int96 by
    ) internal {
        (, int96 curRate, , ) = _cfa.getFlow(token, from, to);
        // int96 newRate = curRate - by;
        // require(newRate >= 0, "new rate would be negative");
        if (curRate > 0) {
            if (curRate > by) {
                cfaV1.updateFlowByOperator(from, to, token, curRate - by);
            } else {
                cfaV1.deleteFlowByOperator(from, to, token);
            }
        }
    }
}
