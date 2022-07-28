//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./HumaConfig.sol";
import "./HumaPool.sol";
import "./HumaPoolLocker.sol";
import "./interfaces/IHumaCredit.sol";
import "./interfaces/IHumaPoolAdmins.sol";
import "./interfaces/IHumaPoolLocker.sol";
import "./libraries/SafeMathInt.sol";
import "./libraries/SafeMathUint.sol";

import "hardhat/console.sol";

/**
 * @notice Invoice Financing
 * @dev please note abbreviation HumaIF is used in error messages to shorten the length of error msg.
 */
contract HumaInvoiceFactoring is IHumaCredit {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using SafeMath for uint16;
    using SafeMath for uint32;
    using SafeMathUint for uint256;
    using SafeMathUint for uint16;
    using SafeMathUint for uint32;

    address payable private pool;
    address private poolLocker;
    address private humaConfig;
    address public treasury;
    address public borrower;
    bool public approved;
    InvoiceInfo public invoiceInfo;

    /**
     * @notice InvoiceInfo stores the overall info about an invoice.
     * Struct is used to pack the data in 2 storage units (512 bits)
     * @dev amounts are stored in uint32, all counts are stored in uint16
     * @dev all fields in InvoiceInfo will not change after initialization.
     * @dev each struct can have no more than 13 elements. Some fields
     * are stored in IFState because of space limitation.
     */
    struct InvoiceInfo {
        // fields related to the overall picture of the loan
        address liquidityAsset;
        uint32 loanAmt;
        uint16 apr_in_bps; // interest rate in bps, likely be 0.
        uint16 factoring_fee_flat;
        uint16 factoring_fee_bps;
        uint16 late_fee_flat;
        uint16 late_fee_bps;
        uint32 collateralAmt; // likely 1 due to NFT
        address collateralAsset; // paymentNFT
        uint64 dueDate;
        bool paidOff;
    }

    /// Contructor accepts 0 para per FactoryClone requirement.
    constructor() {}

    /**
     * @notice the initiation of a loan
     * @param _poolLocker the address of pool locker that holds the liquidity asset
     * @param _treasury the address of the treasury that accepts fees
     * @param _borrower the address of the borrower
     * @param liquidityAsset the address of the liquidity asset that the borrower obtains
     * @param liquidityAmt the amount of the liquidity asset that the borrower obtains
     * @param collateralAsset the address of the collateral asset.
     * @param collateralAmt the amount of the collateral asset
     * @param terms[] the terms for the loan.
     *                [0] apr_in_bps
     *                [1] factoring_fee_flat
     *                [2] factoring_fee_bps
     *                [3] late_fee_flat
     *                [4] late_fee_bps
     *                [5] dueDate
     */
    function initiate(
        address payable _pool,
        address _poolLocker,
        address _humaConfig,
        address _treasury,
        address _borrower,
        address liquidityAsset,
        uint256 liquidityAmt,
        address collateralAsset,
        uint256 collateralAmt,
        uint256[] memory terms
    ) external virtual override {
        pool = _pool;
        humaConfig = _humaConfig;
        protoNotPaused();
        poolLocker = _poolLocker;
        treasury = _treasury;
        borrower = _borrower;

        // Populate InvoiceInfo object
        InvoiceInfo memory ii;
        ii.liquidityAsset = liquidityAsset;
        ii.apr_in_bps = uint16(terms[0]);
        ii.factoring_fee_flat = uint16(terms[1]);
        ii.factoring_fee_bps = uint16(terms[2]);
        ii.late_fee_flat = uint16(terms[3]);
        ii.late_fee_bps = uint16(terms[4]);
        ii.dueDate = uint64((block.timestamp + uint256(terms[5] * 24 * 3600)));
        ii.loanAmt = uint32(liquidityAmt);
        ii.collateralAsset = collateralAsset;
        ii.collateralAmt = uint32(collateralAmt);
        ii.paidOff = false;

        approved = false;
        invoiceInfo = ii;
    }

    /**
     * Approves the loan request with the terms on record.
     */
    function approve() external virtual override returns (bool) {
        // todo add access control.
        protoNotPaused();
        approved = true;
        return approved;
    }

    function isApproved() external view virtual override returns (bool) {
        return approved;
    }

    /**
     * @notice Takes collateral and transfers funds to the borrower
     */
    function originateCredit(uint256 borrowAmt)
        external
        virtual
        override
        returns (uint256 amtForBorrower, uint256 amtForTreasury)
    {
        protoNotPaused();
        require(approved, "HumaIF:INVOICE_FINANCING_NOT_APPROVED");

        // Calculate platform fee due
        uint256 fees;
        InvoiceInfo storage ii = invoiceInfo;
        ii.loanAmt = uint32(borrowAmt);
        if (ii.factoring_fee_flat != 0) fees = ii.factoring_fee_flat;
        if (ii.factoring_fee_bps != 0)
            fees += ii.loanAmt.mul(ii.factoring_fee_bps).div(10000);

        return (ii.loanAmt - fees, fees);
    }

    /**
     * @notice Borrower makes one payment. If this is the final payment,
     * it automatically triggers the payoff process.
     * @dev "HumaIF:WRONG_ASSET" reverted when asset address does not match
     * @return status if the payment is successful or not
     *
     */
    function makePayment(address asset, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        // todo Need to  discuss more on whether to accept invoice pyaments from RN
        // when the protocol is paused.
        protoNotPaused();
        InvoiceInfo storage ii = invoiceInfo;

        // todo handle multiple payments.

        require(asset == ii.liquidityAsset, "HumaIF:WRONG_ASSET");

        // todo decide what to do if the payment amount is insufficient.
        require(amount >= ii.loanAmt, "HumaIF:AMOUNT_TOO_LOW");

        // todo verify that we have indeeded received the payment.

        // Sends the remainder to the borrower
        ii.paidOff = true;
        uint256 lateFee = assessLateFee();

        HumaPool(pool).processRefund(borrower, amount - ii.loanAmt - lateFee);

        return true;
    }

    function payoff(address asset, uint256 amount)
        external
        virtual
        override
        returns (bool)
    {
        return makePayment(asset, amount);
    }

    /**
     * @notice Checks if a late fee should be charged and charges if needed
     * @return lateFee the amount of fees charged
     */
    function assessLateFee() public view returns (uint256 lateFee) {
        InvoiceInfo storage ii = invoiceInfo;

        // Charge a late fee if passed the due date
        if (block.timestamp > ii.dueDate) {
            if (ii.late_fee_flat > 0) lateFee = ii.late_fee_flat;
            if (ii.late_fee_bps > 0) {
                lateFee += ii.loanAmt.mul(ii.late_fee_bps).div(10000);
            }
        }
        return lateFee;
    }

    /**
     * @notice Triggers the default process
     * @return losses the amount of remaining losses to the pool after collateral
     * liquidation, pool cover, and staking.
     */
    function triggerDefault()
        external
        virtual
        override
        returns (uint256 losses)
    {
        HumaPool poolContract = HumaPool(pool);

        // check to make sure the default grace period has passed.
        uint256 gracePeriod = poolContract.getPoolDefaultGracePeriod();
        require(
            block.timestamp > invoiceInfo.dueDate + gracePeriod,
            "HumaIF:DEFAULT_TRIGGERED_TOO_EARLY"
        );

        // FeatureRequest: add pool cover logic

        // FeatureRequest: add staking logic

        // Trigger loss process
        losses = invoiceInfo.loanAmt;
        poolContract.distributeLosses(losses);

        return losses;
    }

    function getPayoffInfo()
        external
        virtual
        override
        returns (
            uint256 total,
            uint256 principal,
            uint256 interest,
            uint256 fees,
            uint256 duedate
        )
    {
        // todo to add
    }

    function getNextPayment()
        external
        virtual
        override
        returns (
            uint256 total,
            uint256 principal,
            uint256 interest,
            uint256 fees,
            uint256 duedate
        )
    {
        // todo to add
    }

    /**
     * @notice Gets high-level information about the loan.
     */
    function getInvoiceInfo()
        external
        view
        returns (
            address _borrower,
            address _collateralAsset,
            uint32 _amount,
            uint64 _dueDate,
            uint16 _factoring_fee_flat,
            uint16 _factoring_fee_bps,
            uint16 _late_fee_flat,
            uint16 _late_fee_bps
        )
    {
        InvoiceInfo storage ii = invoiceInfo;
        return (
            borrower,
            ii.collateralAsset,
            ii.loanAmt,
            ii.dueDate,
            ii.factoring_fee_flat,
            ii.factoring_fee_bps,
            ii.late_fee_flat,
            ii.late_fee_bps
        );
    }

    /**
     * @notice Gets the balance of principal
     * @return amount the amount of the balance
     */
    function getCreditBalance()
        external
        view
        virtual
        override
        returns (uint256 amount)
    {
        InvoiceInfo storage ii = invoiceInfo;
        amount = ii.loanAmt;
    }

    function protoNotPaused() internal view {
        require(
            HumaConfig(humaConfig).isProtocolPaused() == false,
            "HumaLoan:PROTOCOL_PAUSED"
        );
    }
}
