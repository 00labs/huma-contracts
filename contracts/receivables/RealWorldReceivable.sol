// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/CountersUpgradeable.sol";
import "../Errors.sol";
import "./RealWorldReceivableStorage.sol";

/**
 * @title RealWorldReceivable
 * @dev ERC721 tokens that represent off-chain payable receivables
 */
contract RealWorldReceivable is
    RealWorldReceivableStorage,
    Initializable,
    ERC721Upgradeable,
    ERC721EnumerableUpgradeable,
    ERC721URIStorageUpgradeable,
    ERC721BurnableUpgradeable,
    AccessControlUpgradeable
{
    using CountersUpgradeable for CountersUpgradeable.Counter;

    // The status of the receivable.
    enum Status {
        Unpaid,
        Paid,
        PartiallyPaid
    }

    /**
     * @dev Emitted when the owner of a receivable calls the declarePayment function
     * @param from The address of the owner of the receivable
     * @param to The address of the Pool that's paid by the receivable
     * @param tokenId The ID of the receivable token
     * @param paymentToken The ERC20 token used to settle the receivable
     * @param currencyCode The ISO 4217 currency code of the receivable, if paid in fiat
     * @param amount The amount that was declared paid
     */
    event PaymentDeclared(
        address indexed from,
        address indexed to,
        uint256 indexed tokenId,
        address paymentToken,
        uint16 currencyCode,
        uint256 amount
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializer that sets the default admin and minter roles
     */
    function initialize() public initializer {
        __ERC721_init("RealWorldReceivable", "RWR");
        __ERC721Enumerable_init();
        __ERC721URIStorage_init();
        __ERC721Burnable_init();
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    /**
     * @dev Creates a new receivable token and assigns it to the recipient address
     * @param poolAddress The address that's expected to be paid for this receivable
     * @param paymentToken The ERC20 token used to pay the receivable
     * @param currencyCode The ISO 4217 currency code of the receivable, if paid in fiat
     * @param receivableAmount The total amount of the receivable
     * @param maturityDate The date at which the receivable becomes due
     * @param uri The URI of the metadata associated with the receivable
     */
    function createRealWorldReceivable(
        address poolAddress,
        address paymentToken,
        uint16 currencyCode,
        uint96 receivableAmount,
        uint64 maturityDate,
        string memory uri
    ) public onlyRole(MINTER_ROLE) {
        if (paymentToken == address(0) && currencyCode == 0) revert Errors.noReceivableCurrency();
        if (paymentToken != address(0) && currencyCode != 0)
            revert Errors.multipleCurrenciesGiven();

        uint256 tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();
        _safeMint(msg.sender, tokenId);

        RealWorldReceivableInfo memory receivableInfo = RealWorldReceivableInfo(
            poolAddress,
            paymentToken,
            receivableAmount,
            0, // paidAmount
            maturityDate,
            uint64(block.timestamp),
            currencyCode
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
        if (msg.sender != ownerOf(tokenId)) revert Errors.notNFTOwner();
        RealWorldReceivableInfo storage receivableInfo = receivableInfoMapping[tokenId];
        receivableInfo.paidAmount += paymentAmount;

        emit PaymentDeclared(
            msg.sender,
            receivableInfo.poolAddress,
            tokenId,
            receivableInfo.paymentToken,
            receivableInfo.currencyCode,
            uint256(paymentAmount)
        );
    }

    /**
     * @dev Gets the payment status of a receivable.
     * Returns `Status.Paid` if the receivable has been paid in full.
     * Returns `Status.PartiallyPaid` if the receivable has been paid partially.
     * Returns `Status.Unpaid` if the receivable has not been paid at all.
     * @param tokenId The ID of the receivable token.
     * @return The payment status of the receivable.
     */
    function getStatus(uint256 tokenId) public view returns (Status) {
        RealWorldReceivableInfo memory receivableInfo = receivableInfoMapping[tokenId];
        if (receivableInfo.paidAmount >= receivableInfo.receivableAmount) {
            return Status.Paid;
        } else if (receivableInfo.paidAmount > 0) {
            return Status.PartiallyPaid;
        } else {
            return Status.Unpaid;
        }
    }

    // The following functions are overrides required by Solidity.
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override(ERC721Upgradeable, ERC721EnumerableUpgradeable) {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }

    function _burn(uint256 tokenId)
        internal
        override(ERC721Upgradeable, ERC721URIStorageUpgradeable)
    {
        super._burn(tokenId);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721Upgradeable, ERC721URIStorageUpgradeable)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Upgradeable, ERC721EnumerableUpgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
