//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @notice HumaPaybackSBT (Huma Payback Soul-bound Token) is a non-transferrable token
 * that is issued to the borrower after they paid off the loan. This token can be used for
 * credit building. The receivers cannot transfer away or change this token.
 * Only the issuer can update or revoke the token.
 *
 * @dev Right now, we only give a SBT to the user without more detail info on the loan.
 * In the future, we will allow more detail about the loan.
 */
contract HumaPaybackSBT is ERC20 {
    address issuer;

    //TODO(richard): Need to find way to 1) allow the SBT to capture multiple loan payoff info
    //2) High-level info on the loan: amount, # of on-time payments, # of late payments, payoff date

    /**
     * @param _issuer the contract that issues the SBT. Only it can update or remove it.
     */
    constructor(address _issuer) ERC20("Huma Payback SBT", "HumaPaybackSBT") {
        issuer = _issuer;
    }

    function issueTo(address borrower, uint256 amount) public returns (bool) {
        return transfer(borrower, amount);
    }

    function revoke(address borrower, uint256 amount)
        public
        view
        returns (bool)
    {
        return transferFrom(borrower, msg.sender, amount);
    }

    /**
     * @notice Overrides the default behavior. The token is NOT transferred away
     * from the "from" address to achieve "soul-bound token" effect
     * unless msg.sender is the token issuer itself.
     *
     * @dev This is a hack before SBT standard is established.
     */
    function transferFrom(
        address,
        address,
        uint256
    ) public view override returns (bool) {
        require(
            msg.sender == issuer,
            "Only the issuer can revoke HumaBorrowingSBT"
        );

        return true;
    }
}
