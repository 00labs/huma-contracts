//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import "./interfaces/ICredit.sol";
import "./libraries/BaseStructs.sol";

import "./BaseFeeManager.sol";
import "./BasePool.sol";

import "hardhat/console.sol";

contract BaseCreditPool is ICredit, BasePool {
    // Divider to get monthly interest rate from APR BPS. 10000 * 12
    uint256 public constant BPS_DIVIDER = 120000;
    uint256 public constant HUNDRED_PERCENT_IN_BPS = 10000;

    using SafeERC20 for IERC20;
    using ERC165Checker for address;
    using BaseStructs for BaseCreditPool;

    // mapping from wallet address to the credit record
    mapping(address => BaseStructs.CreditRecord) public creditRecordMapping;
    // mapping from wallet address to the collateral supplied by this wallet
    mapping(address => BaseStructs.CollateralInfo)
        internal collateralInfoMapping;
    // mapping from wallet address to the last late fee charged date
    mapping(address => uint256) public lastLateFeeDateMapping;

    constructor(
        address _poolToken,
        address _humaConfig,
        address _poolLockerAddress,
        address _feeManagerAddress,
        string memory _poolName,
        string memory _hdtName,
        string memory _hdtSymbol
    )
        BasePool(
            _poolToken,
            _humaConfig,
            _poolLockerAddress,
            _feeManagerAddress,
            _poolName,
            _hdtName,
            _hdtSymbol
        )
    {}

    /**
     * @notice accepts a credit request from msg.sender
     */
    function requestCredit(
        uint256 _borrowAmount,
        uint256 _paymentIntervalInDays,
        uint256 _numOfPayments
    ) external virtual override {
        // Open access to the borrower
        // Parameter and condition validation happens in initiate()
        initiate(
            msg.sender,
            _borrowAmount,
            address(0),
            0,
            0,
            poolAprInBps,
            interestOnly,
            _paymentIntervalInDays,
            _numOfPayments
        );
    }

    /**
     * @notice the initiation of a loan
     * @param _borrower the address of the borrower
     * @param _borrowAmount the amount of the liquidity asset that the borrower obtains
     * @param _collateralAsset the address of the collateral asset.
     * @param _collateralAmount the amount of the collateral asset
     * todo remove dynamic array, need to coordinate with client for that change.
     */
    function initiate(
        address _borrower,
        uint256 _borrowAmount,
        address _collateralAsset,
        uint256 _collateralParam,
        uint256 _collateralAmount,
        uint256 _aprInBps,
        bool _interestOnly,
        uint256 _paymentIntervalInDays,
        uint256 _remainingPayments
    ) internal virtual {
        protocolAndpoolOn();
        // Borrowers must not have existing loans from this pool
        require(
            creditRecordMapping[msg.sender].state ==
                BaseStructs.CreditState.Deleted,
            "DENY_EXISTING_LOAN"
        );

        // Borrowing amount needs to be higher than min for the pool.
        require(_borrowAmount >= minBorrowAmount, "SMALLER_THAN_LIMIT");

        // Borrowing amount needs to be lower than max for the pool.
        require(maxBorrowAmount >= _borrowAmount, "GREATER_THAN_LIMIT");

        // Populates basic credit info fields
        BaseStructs.CreditRecord memory cr;
        cr.loanAmount = uint96(_borrowAmount);
        cr.remainingPrincipal = uint96(_borrowAmount);
        cr.aprInBps = uint16(_aprInBps);
        cr.interestOnly = _interestOnly;
        cr.paymentIntervalInDays = uint16(_paymentIntervalInDays);
        cr.remainingPayments = uint16(_remainingPayments);
        cr.state = BaseStructs.CreditState.Requested;
        creditRecordMapping[_borrower] = cr;

        // Populates fields related to collateral
        if (_collateralAsset != address(0)) {
            BaseStructs.CollateralInfo memory ci;
            ci.collateralAsset = _collateralAsset;
            ci.collateralParam = _collateralParam;
            ci.collateralAmount = uint88(_collateralAmount);
            collateralInfoMapping[_borrower] = ci;
        }
    }

    /**
     * Approves the loan request with the terms on record.
     */
    function approveCredit(address _borrower) public virtual override {
        protocolAndpoolOn();
        onlyApprovers();
        creditRecordMapping[_borrower].state = BaseStructs.CreditState.Approved;
    }

    function invalidateApprovedCredit(address _borrower)
        public
        virtual
        override
    {
        protocolAndpoolOn();
        onlyApprovers();
        creditRecordMapping[_borrower].deleted = true;
    }

    function isApproved(address _borrower)
        public
        view
        virtual
        override
        returns (bool)
    {
        if (
            (!creditRecordMapping[_borrower].deleted) &&
            (creditRecordMapping[_borrower].state >=
                BaseStructs.CreditState.Approved)
        ) return true;
        else return false;
    }

    function originateCredit(uint256 borrowAmount) external virtual override {
        // Open access to the borrower
        // Condition validation happens in originateCollateralizedCredit()
        return
            originateCollateralizedCredit(
                msg.sender,
                borrowAmount,
                address(0),
                0,
                0
            );
    }

    function originateCollateralizedCredit(
        address _borrower,
        uint256 _borrowAmount,
        address _collateralAsset,
        uint256 _collateralParam,
        uint256 _collateralCount
    ) public virtual override {
        protocolAndpoolOn();

        // msg.sender needs to be the borrower themselvers or the approver.
        if (msg.sender != _borrower) onlyApprovers();

        require(isApproved(_borrower), "CREDIT_NOT_APPROVED");

        // Critical to update cr.loanAmount since _borrowAmount
        // might be lowered than the approved loan amount
        BaseStructs.CreditRecord memory cr = creditRecordMapping[_borrower];
        cr.loanAmount = uint32(_borrowAmount);
        // // Calculates next payment amount and due date
        cr.nextDueDate = uint64(
            block.timestamp +
                uint256(cr.paymentIntervalInDays) *
                SECONDS_IN_A_DAY
        );
        // Calculate the monthly payment (except the final payment)
        if (interestOnly) {
            cr.nextAmountDue = uint32(
                (_borrowAmount * cr.aprInBps) / BPS_DIVIDER
            );
        } else {
            cr.nextAmountDue = uint96(
                IFeeManager(feeManagerAddress).getFixedPaymentAmount(
                    _borrowAmount,
                    cr.aprInBps,
                    cr.remainingPayments
                )
            );
        }
        creditRecordMapping[_borrower] = cr;

        (
            uint256 amtToBorrower,
            uint256 protocolFee,
            uint256 poolIncome
        ) = IFeeManager(feeManagerAddress).distBorrowingAmount(
                _borrowAmount,
                humaConfig
            );

        if (poolIncome > 0) distributeIncome(poolIncome);

        // Record the collateral info.
        if (_collateralAsset != address(0)) {
            BaseStructs.CollateralInfo memory ci = collateralInfoMapping[
                _borrower
            ];
            if (ci.collateralAsset != address(0)) {
                require(
                    _collateralAsset == ci.collateralAsset,
                    "COLLATERAL_MISMATCH"
                );
            }
            // todo check to make sure the collateral amount meets the requirements
            ci.collateralAmount = uint88(_collateralCount);
            ci.collateralParam = _collateralParam;
            collateralInfoMapping[_borrower] = ci;
        }

        // // Transfers collateral asset
        if (_collateralAsset != address(0)) {
            if (_collateralAsset.supportsInterface(type(IERC721).interfaceId)) {
                IERC721(_collateralAsset).safeTransferFrom(
                    _borrower,
                    poolLockerAddress,
                    _collateralParam
                );
            } else if (
                _collateralAsset.supportsInterface(type(IERC20).interfaceId)
            ) {
                IERC20(_collateralAsset).safeTransferFrom(
                    msg.sender,
                    poolLockerAddress,
                    _collateralCount
                );
            } else {
                revert("COLLATERAL_ASSET_NOT_SUPPORTED");
            }
        }

        // Transfer protocole fee and funds the _borrower
        address treasuryAddress = HumaConfig(humaConfig).humaTreasury();
        PoolLocker locker = PoolLocker(poolLockerAddress);
        locker.transfer(treasuryAddress, protocolFee);
        locker.transfer(_borrower, amtToBorrower);
    }

    /**
     * @notice Borrower makes one payment. If this is the final payment,
     * it automatically triggers the payoff process.
     * @dev "WRONG_ASSET" reverted when asset address does not match
     * @dev "AMOUNT_TOO_LOW" reverted when the asset is short of the scheduled payment and fees
     */
    function makePayment(address _asset, uint256 _amount)
        external
        virtual
        override
    {
        console.log("Entering makePayment()");
        protocolAndpoolOn();

        BaseStructs.CreditRecord memory cr = creditRecordMapping[msg.sender];

        require(_asset == address(poolToken), "WRONG_ASSET");
        require(cr.remainingPayments > 0, "LOAN_PAID_OFF_ALREADY");

        uint256 principal;
        uint256 interest;
        uint256 fees;
        bool isLate;
        bool goodPay;
        bool paidOff;

        (principal, interest, fees, isLate, goodPay, paidOff) = IFeeManager(
            feeManagerAddress
        ).getNextPayment(cr, lastLateFeeDateMapping[msg.sender], _amount);

        console.log("in makePayment, principal=", principal);
        console.log("interest=", interest);
        console.log("fees=", fees);
        console.log("isLate=", isLate);
        console.log("goodPay=", goodPay);
        console.log("paidOff=", paidOff);

        // Do not accept partial payments. Requires _amount to be able to cover
        // the next payment and all the outstanding fees.
        require(goodPay, "AMOUNT_TOO_LOW");

        // Reset the cycle that late fee has been charged.
        if (isLate) lastLateFeeDateMapping[msg.sender] = cr.nextDueDate;

        if (paidOff) {
            cr.nextAmountDue = 0;
            cr.nextDueDate = 0;
            cr.remainingPrincipal = 0;
            cr.feesAccrued = 0;
            cr.remainingPayments = 0;
            cr.deleted = true;
        } else {
            cr.remainingPrincipal = uint96(cr.remainingPrincipal - principal);
            cr.remainingPayments -= 1;
            cr.nextDueDate =
                cr.nextDueDate +
                uint64(cr.paymentIntervalInDays * SECONDS_IN_A_DAY);
            if (cr.remainingPayments == 1) {
                if (cr.interestOnly) cr.nextAmountDue += cr.remainingPrincipal;
                else {
                    cr.nextAmountDue =
                        cr.remainingPrincipal *
                        (1 + cr.aprInBps / 120000);
                }
            }
        }
        creditRecordMapping[msg.sender] = cr;

        // Distribute income
        uint256 poolIncome = interest + fees;
        distributeIncome(poolIncome);

        uint256 amountToCollect = principal + interest + fees;
        console.log("amountToCollect=", amountToCollect);
        console.log(
            "cr.nextDueDate=",
            creditRecordMapping[msg.sender].nextDueDate
        );
        console.log("block.timestamp=", block.timestamp);
        console.log(
            "remainingPayments=",
            creditRecordMapping[msg.sender].remainingPayments
        );

        // amountToCollect is different from _amount in two scenarios:
        // 1) when _amount is smaller than the amount due, we do not support
        // partial payment and only collect $0 2) when _amount is more than pay
        //  off, we only collect the dues and the remaining principal.
        if (amountToCollect > 0) {
            // Transfer assets from the _borrower to pool locker
            IERC20 token = IERC20(poolToken);
            console.log("balance=", token.balanceOf(msg.sender));
            token.transferFrom(msg.sender, poolLockerAddress, amountToCollect);
        }
    }

    /**
     * @notice Borrower requests to payoff the credit
     */
    function payoff(
        address borrower,
        address asset,
        uint256 amount
    ) external virtual override {
        //todo to implement
    }

    /**
     * @notice Triggers the default process
     * @return losses the amount of remaining losses to the pool after collateral
     * liquidation, pool cover, and staking.
     */
    function triggerDefault(address borrower)
        external
        virtual
        override
        returns (uint256 losses)
    {
        protocolAndpoolOn();

        // check to make sure the default grace period has passed.
        require(
            block.timestamp >
                creditRecordMapping[borrower].nextDueDate +
                    poolDefaultGracePeriodInSeconds,
            "DEFAULT_TRIGGERED_TOO_EARLY"
        );

        // FeatureRequest: add pool cover logic

        // FeatureRequest: add staking logic

        // Trigger loss process
        losses = creditRecordMapping[borrower].remainingPrincipal;
        distributeLosses(losses);

        return losses;
    }

    /**
     * @notice Gets high-level information about the loan.
     */
    function getCreditInformation(address borrower)
        external
        view
        returns (
            uint96 loanAmount,
            uint96 nextAmountDue,
            uint64 paymentIntervalInDays,
            uint16 aprInBps,
            uint64 nextDueDate,
            uint96 remainingPrincipal,
            uint16 remainingPayments,
            bool deleted
        )
    {
        BaseStructs.CreditRecord memory cr = creditRecordMapping[borrower];
        return (
            cr.loanAmount,
            cr.nextAmountDue,
            cr.paymentIntervalInDays,
            cr.aprInBps,
            cr.nextDueDate,
            cr.remainingPrincipal,
            cr.remainingPayments,
            cr.deleted
        );
    }

    function getApprovalStatusForBorrower(address borrower)
        external
        view
        returns (bool)
    {
        return
            creditRecordMapping[borrower].state >=
            BaseStructs.CreditState.Approved;
    }

    function onlyApprovers() internal view {
        require(creditApprovers[msg.sender] == true, "APPROVER_REQUIRED");
    }
}
