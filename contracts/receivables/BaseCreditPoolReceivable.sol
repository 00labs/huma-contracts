// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import {BaseStructs as BS} from "../libraries/BaseStructs.sol";
import "../BaseCreditPool.sol";

/**
 * @title BaseCreditPoolReceivable
 * @dev Contract that represents an ERC721 receivable payable to Huma's BaseCreditPool
 */
contract BaseCreditPoolReceivable is ERC721Enumerable, ERC721URIStorage, AccessControl {
    using Counters for Counters.Counter;
    using BS for BS.CreditRecord;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    Counters.Counter private _tokenIdCounter;

    struct ReceivableInfo {
        // The BaseCreditPool that's paid by the receivable
        BaseCreditPool baseCreditPool;
        // The payment method used to settle the receivable
        PaymentMethod paymentMethod;
        // The ERC20 token used to settle the receivable
        address paymentToken;
        // The total expected payment amount of the receivable
        uint96 receivableAmount;
        // The amount of the receivable that has been paid so far
        uint96 balance;
        // The date at which the receivable becomes due
        uint64 maturityDate;
    }

    // Map tokenId to receivable information
    mapping(uint256 => ReceivableInfo) public receivableInfoMapping;

    // The status of the receivable.
    enum Status {
        Unpaid,
        Paid,
        PartiallyPaid
    }

    // The payment method used to settle the receivable
    enum PaymentMethod {
        // Payment is declared by calling the declarePayment function on this contract.
        // No ERC20 tokens are transferred in this call. The receivable owner is responsible
        // for transferring the ERC20 tokens to the pool on their own.
        Declarative,
        // Payment is made by transferring ERC20 tokens to the pool
        // using the makePayment function on the BaseCreditPool contract.
        Payable
    }

    /**
     * @dev Emitted when the owner of a receivable calls the declarePayment function
     * @param from The address of the owner of the receivable
     * @param to The address of the BaseCreditPool that's paid by the receivable
     * @param tokenId The ID of the receivable token
     * @param amount The amount that was declared paid
     */
    event PaymentDeclared(
        address indexed from,
        address indexed to,
        uint256 indexed tokenId,
        uint256 amount
    );

    /**
     * @dev Constructor that sets the default admin and minter roles
     */
    constructor() ERC721("BaseCreditPoolReceivable", "pREC") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    /**
     * @dev Creates a new receivable token and assigns it to the recipient address
     * @param recipient The address that will receive the new token
     * @param baseCreditPool The address of the BaseCreditPool that's paid by the receivable
     * @param paymentToken The ERC20 token used to pay the receivable
     * @param receivableAmount The total amount of the receivable
     * @param maturityDate The date at which the receivable becomes due
     * @param paymentMethod The payment method used to settle the receivable
     * @param uri The URI of the metadata associated with the receivable
     */
    function safeMint(
        address recipient,
        address baseCreditPool,
        address paymentToken,
        uint96 receivableAmount,
        uint64 maturityDate,
        PaymentMethod paymentMethod,
        string memory uri
    ) public onlyRole(MINTER_ROLE) {
        (address underlyingToken, , , ) = BaseCreditPool(baseCreditPool).getCoreData();
        require(
            underlyingToken == paymentToken,
            "Payment token does not match pool underlying token"
        );

        uint256 tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();
        _safeMint(recipient, tokenId);

        ReceivableInfo memory receivableInfo = ReceivableInfo(
            BaseCreditPool(baseCreditPool),
            paymentMethod,
            paymentToken,
            receivableAmount,
            0, // Balance
            maturityDate
        );
        receivableInfoMapping[tokenId] = receivableInfo;

        _setTokenURI(tokenId, uri);
    }

    /**
     * @dev Declares payment for a receivable.
     * Only the owner of the token can declare a payment.
     * The payment method for the receivable must be Declarative.
     * The receivable must not already be paid in full.
     * Emits a `PaymentDeclared` event.
     * @param tokenId The ID of the receivable token.
     * @param paymentAmount The amount of payment being declared.
     */
    function declarePayment(uint256 tokenId, uint96 paymentAmount) public {
        require(msg.sender == ownerOf(tokenId), "Caller is not token owner");
        ReceivableInfo storage receivableInfo = receivableInfoMapping[tokenId];
        require(
            receivableInfo.paymentMethod == PaymentMethod.Declarative,
            "Unsupported payment method for receivable"
        );
        require(
            receivableInfo.balance < receivableInfo.receivableAmount,
            "Receivable already paid"
        );

        receivableInfo.balance += uint96(paymentAmount);

        emit PaymentDeclared(
            msg.sender,
            address(receivableInfo.baseCreditPool),
            tokenId,
            uint256(paymentAmount)
        );
    }

    /**
     * @dev Makes a payment for a receivable.
     * Only the owner of the token can make a payment.
     * The payment method for the receivable must be Payable.
     * The receivable must not already be paid in full.
     * Calls the `makePayment` function of the corresponding `BaseCreditPool` contract.
     * @param tokenId The ID of the receivable token.
     * @param paymentAmount The amount of payment being made
     *   (denoted in the paymentToken of the receivable).
     */
    function makePayment(uint256 tokenId, uint96 paymentAmount) public {
        require(msg.sender == ownerOf(tokenId), "Caller is not token owner");
        ReceivableInfo storage receivableInfo = receivableInfoMapping[tokenId];
        require(
            receivableInfo.paymentMethod == PaymentMethod.Payable,
            "Unsupported payment method for receivable"
        );
        require(
            receivableInfo.balance < receivableInfo.receivableAmount,
            "Receivable already paid"
        );

        (uint256 amountPaid, ) = receivableInfo.baseCreditPool.makePayment(
            ownerOf(tokenId),
            uint256(paymentAmount)
        );

        require(amountPaid > 0, "makePayment failed");

        receivableInfo.balance += uint96(amountPaid);
    }

    /**
     * @dev Gets the payment status of a receivable.
     * Returns `Status.Paid` if the receivable has been paid in full.
     * Returns `Status.PartiallyPaid` if the receivable has been paid partially.
     * Returns `Status.Unpaid` if the receivable has not been paid at all.
     * @param tokenId The ID of the receivable token.
     * @return The payment status of the receivable.
     */
    function getPaymentStatus(uint256 tokenId) public view returns (Status) {
        ReceivableInfo storage receivableInfo = receivableInfoMapping[tokenId];
        if (receivableInfo.balance == receivableInfo.receivableAmount) {
            return Status.Paid;
        } else if (receivableInfo.balance > 0) {
            return Status.PartiallyPaid;
        } else {
            return Status.Unpaid;
        }
    }

    // The following functions are overrides required by Solidity.
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId
    ) internal override(ERC721, ERC721Enumerable) {
        ERC721Enumerable._beforeTokenTransfer(from, to, tokenId);
    }

    function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
        ERC721URIStorage._burn(tokenId);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return ERC721URIStorage.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable, AccessControl)
        returns (bool)
    {
        return
            ERC721Enumerable.supportsInterface(interfaceId) ||
            AccessControl.supportsInterface(interfaceId);
    }
}
