//SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import "./interfaces/ICredit.sol";
import {BaseStructs as BS} from "./libraries/BaseStructs.sol";

import "./BaseFeeManager.sol";
import "./BasePool.sol";

import "hardhat/console.sol";

contract BaseCreditPool is ICredit, BasePool, IERC721Receiver {
    // Divider to get monthly interest rate from APR BPS. 10000 * 12
    uint256 public constant BPS_DIVIDER = 120000;
    uint256 public constant HUNDRED_PERCENT_IN_BPS = 10000;
    uint256 public constant SECONDS_IN_A_YEAR = 31536000;

    using SafeERC20 for IERC20;
    using ERC165Checker for address;
    using BS for BS.CreditRecord;

    // mapping from wallet address to the credit record
    mapping(address => BS.CreditRecord) public creditRecordMapping;
    // mapping from wallet address to the collateral supplied by this wallet
    mapping(address => BS.CollateralInfo) internal collateralInfoMapping;

    constructor(
        address _poolToken,
        address _humaConfig,
        address _feeManagerAddress,
        string memory _poolName,
        string memory _hdtName,
        string memory _hdtSymbol
    )
        BasePool(
            _poolToken,
            _humaConfig,
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
        uint256 _creditLimit,
        uint256 _intervalInDays,
        uint256 _numOfPayments
    ) external virtual override {
        // Open access to the borrower
        // Parameter and condition validation happens in initiate()
        initiate(
            msg.sender,
            _creditLimit,
            address(0),
            0,
            0,
            poolAprInBps,
            _intervalInDays,
            _numOfPayments
        );
    }

    /**
     * @notice initiation of a credit
     * @param _borrower the address of the borrower
     * @param _creditLimit the amount of the liquidity asset that the borrower obtains
     * @param _collateralAsset the address of the collateral asset.
     * @param _collateralAmount the amount of the collateral asset
     */
    function initiate(
        address _borrower,
        uint256 _creditLimit,
        address _collateralAsset,
        uint256 _collateralParam,
        uint256 _collateralAmount,
        uint256 _aprInBps,
        uint256 _intervalInDays,
        uint256 _remainingCycles
    ) internal virtual {
        protocolAndPoolOn();
        // Borrowers cannot have two credit lines in one pool. They can request to increase line.
        // todo add a test for this check
        require(
            creditRecordMapping[_borrower].creditLimit == 0,
            "CREDIT_LINE_ALREADY_EXIST"
        );

        // Borrowing amount needs to be lower than max for the pool.
        require(maxCreditLine >= _creditLimit, "GREATER_THAN_LIMIT");

        // Populates basic credit info fields
        BS.CreditRecord memory cr;
        cr.creditLimit = uint96(_creditLimit);
        // note, leaving balance at the default 0, update balance only after drawdown
        cr.aprInBps = uint16(_aprInBps);
        cr.intervalInDays = uint16(_intervalInDays);
        cr.remainingCycles = uint16(_remainingCycles);
        cr.state = BS.CreditState.Requested;
        creditRecordMapping[_borrower] = cr;

        // Populates fields related to collateral
        if (_collateralAsset != address(0)) {
            BS.CollateralInfo memory ci;
            ci.collateralAsset = _collateralAsset;
            ci.collateralParam = _collateralParam;
            ci.collateralAmount = uint88(_collateralAmount);
            collateralInfoMapping[_borrower] = ci;
        }
    }

    /**
     * Approves the credit request with the terms on record.
     */
    function approveCredit(address _borrower) public virtual override {
        protocolAndPoolOn();
        onlyEvaluationAgents();
        // question shall we check to make sure the credit limit is lowered than the allowed max
        creditRecordMapping[_borrower].state = BS.CreditState.Approved;
    }

    function changeCreditLine(address _borrower, uint256 _newLine) public {
        protocolAndPoolOn();
        onlyEvaluationAgents();
        // Borrowing amount needs to be lower than max for the pool.
        require(maxCreditLine >= _newLine, "GREATER_THAN_LIMIT");
        require(_newLine >= minBorrowAmount, "SMALLER_THAN_LIMIT");

        require(
            creditRecordMapping[_borrower].creditLimit == 0,
            "CREDIT_LINE_NOT_EXIST"
        );
        creditRecordMapping[_borrower].creditLimit = uint96(_newLine);
    }

    function invalidateApprovedCredit(address _borrower)
        public
        virtual
        override
    {
        protocolAndPoolOn();
        onlyEvaluationAgents();
        BS.CreditRecord memory cr = creditRecordMapping[_borrower];
        cr.state = BS.CreditState.Deleted;
        cr.creditLimit = 0;
        creditRecordMapping[_borrower] = cr;
    }

    function isApproved(address _borrower)
        public
        view
        virtual
        override
        returns (bool)
    {
        if ((creditRecordMapping[_borrower].state >= BS.CreditState.Approved))
            return true;
        else return false;
    }

    function drawdown(uint256 borrowAmount) external virtual override {
        // Open access to the borrower
        // Condition validation happens in drawdownWithCollateral()
        return
            drawdownWithCollateral(msg.sender, borrowAmount, address(0), 0, 0);
    }

    function drawdownWithCollateral(
        address _borrower,
        uint256 _borrowAmount,
        address _collateralAsset,
        uint256 _collateralParam,
        uint256 _collateralCount
    ) public virtual override {
        protocolAndPoolOn();

        // msg.sender needs to be the borrower themselvers or the EA.
        if (msg.sender != _borrower) onlyEvaluationAgents();

        // Borrowing amount needs to be higher than min for the pool.
        // todo 8/23 need to move some tests from requestCredit() to drawdown()
        require(_borrowAmount >= minBorrowAmount, "SMALLER_THAN_LIMIT");

        require(isApproved(_borrower), "CREDIT_NOT_APPROVED");

        BS.CreditRecord memory cr = creditRecordMapping[_borrower];
        // console.log("In drawdown...");
        // cr.printCreditInfo();
        // todo 8/23 add a test for this check
        require(
            _borrowAmount <= cr.creditLimit - cr.balance,
            "EXCEEDED_CREDIT_LMIIT"
        );
        // todo 8/23 add a check to make sure the account is in good standing.

        cr.balance = uint96(uint256(cr.balance) + _borrowAmount);

        // todo this logic does not work for credit line.
        cr.dueDate = uint64(
            block.timestamp + uint256(cr.intervalInDays) * SECONDS_IN_A_DAY
        );

        // With drawdown, balance increases, cycle-end interest charge will be higher than
        // it should be, thus record a negative correction to be applied at the end of the cycle
        cr.correction -= int96(uint96(calcCorrection(cr, _borrowAmount)));

        // Set the monthly payment (except the final payment, hook for installment case
        cr.totalDue = uint96(
            IFeeManager(feeManagerAddress).getRecurringPayment(cr)
        );
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
            BS.CollateralInfo memory ci = collateralInfoMapping[_borrower];
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
                    address(this),
                    _collateralParam
                );
            } else if (
                _collateralAsset.supportsInterface(type(IERC20).interfaceId)
            ) {
                IERC20(_collateralAsset).safeTransferFrom(
                    msg.sender,
                    address(this),
                    _collateralCount
                );
            } else {
                revert("COLLATERAL_ASSET_NOT_SUPPORTED");
            }
        }

        // Transfer protocole fee and funds the _borrower
        address treasuryAddress = HumaConfig(humaConfig).humaTreasury();
        poolToken.safeTransfer(treasuryAddress, protocolFee);
        poolToken.safeTransfer(_borrower, amtToBorrower);

        // console.log("At the end of drawdown...");
        // console.log("block.timestamp=", block.timestamp);
        // creditRecordMapping[_borrower].printCreditInfo();
    }

    /**
     * @notice Borrower makes one payment. If this is the final payment,
     * it automatically triggers the payoff process.
     * @dev "WRONG_ASSET" reverted when asset address does not match
     * @dev "AMOUNT_TOO_LOW" reverted when the asset is short of the scheduled payment and fees
     */
    function makePayment(
        address _borrower,
        address _asset,
        uint256 _amount
    ) external virtual override {
        protocolAndPoolOn();

        BS.CreditRecord memory cr = creditRecordMapping[_borrower];

        require(_asset == address(poolToken), "WRONG_ASSET");
        require(_amount > 0, "CANNOT_BE_ZERO_AMOUNT");
        // todo 8/23 check to see if this condition is still needed
        require(
            cr.balance > 0 && cr.remainingCycles > 0,
            "LOAN_PAID_OFF_ALREADY"
        );

        uint96 oldBalance = cr.balance;
        uint256 platformIncome;
        uint256 amountToCollect;
        uint256 cyclesPassed;

        (
            cr.balance,
            cr.dueDate,
            cr.totalDue,
            cr.feesDue,
            cyclesPassed,
            amountToCollect
        ) = IFeeManager(feeManagerAddress).applyPayment(cr, _amount);

        // cr.printCreditInfo();

        if (cr.totalDue > 0)
            cr.missedCycles = uint16(cr.missedCycles + cyclesPassed);
        cr.remainingCycles = uint16(cr.remainingCycles - cyclesPassed);

        // todo payoff bookkeeping

        creditRecordMapping[_borrower] = cr;

        // Distribute income
        // todo 8/23 need to apply logic for protocol fee
        distributeIncome(platformIncome);

        // adjust cr.correction if the borrower has paid principal
        if (oldBalance > cr.balance) {
            cr.correction += int96(
                uint96(calcCorrection(cr, oldBalance - cr.balance))
            );
        }

        if (amountToCollect > 0) {
            // Transfer assets from the _borrower to pool locker
            IERC20 token = IERC20(poolToken);
            token.transferFrom(msg.sender, address(this), amountToCollect);
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
        protocolAndPoolOn();
        // todo add security check

        // check to make sure the default grace period has passed.
        require(
            block.timestamp >
                creditRecordMapping[borrower].dueDate +
                    poolDefaultGracePeriodInSeconds,
            "DEFAULT_TRIGGERED_TOO_EARLY"
        );

        // FeatureRequest: add pool cover logic

        // FeatureRequest: add staking logic

        // Trigger loss process
        // todo double check if we need to include fees into losses
        losses = creditRecordMapping[borrower].balance;
        distributeLosses(losses);

        return losses;
    }

    function calcCorrection(BS.CreditRecord memory _cr, uint256 amount)
        internal
        view
        returns (uint256 correction)
    {
        return
            (amount *
                _cr.aprInBps *
                (block.timestamp -
                    (_cr.dueDate - _cr.intervalInDays * 86400))) /
            SECONDS_IN_A_YEAR /
            10000;
    }

    function onERC721Received(
        address, /*operator*/
        address, /*from*/
        uint256, /*tokenId*/
        bytes calldata /*data*/
    ) external virtual override returns (bytes4) {
        return this.onERC721Received.selector;
    }

    /**
     * @notice Gets high-level information about the loan.
     */
    function getCreditInformation(address borrower)
        external
        view
        returns (
            uint96 creditLimit,
            uint96 totalDue,
            uint64 intervalInDays,
            uint16 aprInBps,
            uint64 dueDate,
            uint96 balance,
            uint16 remainingCycles,
            BS.CreditState state
        )
    {
        BS.CreditRecord memory cr = creditRecordMapping[borrower];
        return (
            cr.creditLimit,
            cr.totalDue,
            cr.intervalInDays,
            cr.aprInBps,
            cr.dueDate,
            cr.balance,
            cr.remainingCycles,
            cr.state
        );
    }

    function getApprovalStatusForBorrower(address borrower)
        external
        view
        returns (bool)
    {
        return creditRecordMapping[borrower].state >= BS.CreditState.Approved;
    }

    function onlyEvaluationAgents() internal view {
        require(evaluationAgents[msg.sender] == true, "APPROVER_REQUIRED");
    }
}
