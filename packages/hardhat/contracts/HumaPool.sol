//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

import "./interfaces/IHumaPoolLocker.sol";
import "./interfaces/IHumaCredit.sol";
import "./HumaPoolLocker.sol";
import "./HDT/HDT.sol";
import "./HumaConfig.sol";
import "./HumaCreditFactory.sol";
import "./ReputationTrackerFactory.sol";
import "./ReputationTracker.sol";
import "./interfaces/IReputationTracker.sol";

contract HumaPool is HDT, Ownable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using ERC165Checker for address;

    // HumaConfig. Removed immutable since Solidity disallow reference it in the constructor,
    // but we need to retrieve the poolDefaultGracePeriod in the constructor.
    address public humaConfig;

    // Liquidity holder proxy contract for this pool
    address public poolLocker;

    // HumaLoanFactory
    address internal humaCreditFactory;

    // Tracks the amount of liquidity in poolTokens provided to this pool by an address
    mapping(address => LenderInfo) internal lenderInfo;

    // Tracks currently issued loans from this pool
    // Maps from wallet adress to Loan address
    // todo need to change to internal
    mapping(address => address) public creditMapping;

    // The ERC20 token this pool manages
    IERC20 public immutable poolToken;

    // The max liquidity allowed for the pool.
    uint256 internal liquidityCap;

    // the min amount each loan/credit.
    uint256 internal minBorrowAmt;

    // The maximum amount of poolTokens that this pool allows in a single loan
    uint256 maxBorrowAmt;

    // The interest rate this pool charges for loans
    uint256 interestRateBasis;

    // The collateral basis percentage required from lenders
    uint256 collateralRequired;

    // Platform fee, charged when a loan is originated
    uint256 platform_fee_flat;
    uint256 platform_fee_bps;
    // Late fee, charged when the borrow is late for a pyament.
    uint256 late_fee_flat;
    uint256 late_fee_bps;

    PoolStatus public status = PoolStatus.Off;

    // List of credit approvers who can approve credit requests.
    mapping(address => bool) public creditApprovers;

    // How long after the last deposit that a lender needs to wait
    // before they can withdraw their capital
    uint256 loanWithdrawalLockoutPeriod = 2630000;

    CreditType poolCreditType;

    uint256 public poolDefaultGracePeriod;

    // reputationTrackerFactory
    address public reputationTrackerFactory;

    address public reputationTrackerContractAddress;

    // todo (by RL) Need to use uint32 and uint48 for diff fields to take advantage of packing
    struct LenderInfo {
        uint256 amount;
        uint256 weightedDepositDate; // weighted average deposit date
        uint256 mostRecentLoanTimestamp;
    }

    enum PoolStatus {
        On,
        Off
    }

    event LiquidityDeposited(address by, uint256 principal);
    event LiquidityWithdrawn(address by, uint256 principal, uint256 netAmt);

    constructor(
        address _poolToken,
        address _humaConfig,
        address _humaCreditFactory,
        address _reputationTrackerFactory,
        CreditType _poolCreditType
    ) HDT("Huma", "Huma", _poolToken) {
        poolToken = IERC20(_poolToken);
        humaConfig = _humaConfig;
        humaCreditFactory = _humaCreditFactory;
        reputationTrackerFactory = _reputationTrackerFactory;
        poolCreditType = _poolCreditType;
        poolDefaultGracePeriod = HumaConfig(humaConfig)
            .protocolDefaultGracePeriod();
        reputationTrackerContractAddress = ReputationTrackerFactory(
            reputationTrackerFactory
        ).deployReputationTracker("Huma Pool", "HumaRTT");
    }

    modifier onlyHumaMasterAdmin() {
        require(
            msg.sender == HumaConfig(humaConfig).owner(),
            "HumaPool:PERMISSION_DENIED_NOT_MASTER_ADMIN"
        );
        _;
    }

    //********************************************/
    //               LP Functions                //
    //********************************************/

    /**
     * @notice LP deposits to the pool to earn interest, and share losses
     * @param amount the number of `poolToken` to be deposited
     */
    function makeInitialDeposit(uint256 amount) external returns (bool) {
        return _deposit(msg.sender, amount);
    }

    function deposit(uint256 amount) external returns (bool) {
        poolOn();
        // todo (by RL) Need to check if the pool is open to msg.sender to deposit
        // todo (by RL) Need to add maximal pool size support and check if it has reached the size
        return _deposit(msg.sender, amount);
    }

    function _deposit(address lender, uint256 amount) internal returns (bool) {
        // Update weighted deposit date:
        // prevDate + (now - prevDate) * (amount / (balance + amount))
        // NOTE: prevDate = 0 implies balance = 0, and equation reduces to now
        uint256 prevDate = lenderInfo[lender].weightedDepositDate;
        uint256 balance = lenderInfo[lender].amount;
        uint256 newDate = (balance + amount) > 0
            ? prevDate.add(
                block.timestamp.sub(prevDate).mul(amount).div(balance + amount)
            )
            : prevDate;

        lenderInfo[lender].weightedDepositDate = newDate;
        lenderInfo[lender].amount += amount;
        lenderInfo[lender].mostRecentLoanTimestamp = block.timestamp;

        poolToken.safeTransferFrom(lender, poolLocker, amount);

        // Mint HDT for the LP to claim future income and losses
        _mint(lender, amount);

        emit LiquidityDeposited(lender, amount);

        return true;
    }

    /**
     * @notice Withdraw principal that was deposited into the pool before in the unit of `poolTokens`
     * @dev Withdrawals are not allowed when 1) the pool withdraw is paused or
     *      2) the LP has not reached lockout period since their last depisit
     *      3) the requested amount is higher than the LP's remaining principal
     * @dev the `amount` is total amount to withdraw. It will deivided by pointsPerShare to get
     *      the number of HDTs to reduct from msg.sender's account.
     * @dev Error checking sequence: 1) is the pool on 2) is the amount right 3)
     */
    function withdraw(uint256 amount) public returns (bool) {
        poolOn();
        require(
            block.timestamp >=
                lenderInfo[msg.sender].mostRecentLoanTimestamp +
                    loanWithdrawalLockoutPeriod,
            "HumaPool:WITHDRAW_TOO_SOON"
        );
        require(
            amount <= lenderInfo[msg.sender].amount,
            "HumaPool:WITHDRAW_AMT_TOO_GREAT"
        );

        lenderInfo[msg.sender].amount -= amount;

        // Calculate the amount that msg.sender can actually withdraw.
        // withdrawableFundsOf(...) returns everything that msg.sender can claim in terms of
        // number of poolToken, incl. principal,income and losses.
        // then get the portion that msg.sender wants to withdraw (amount / total principal)
        uint256 amountToWithdraw = withdrawableFundsOf(msg.sender)
            .mul(amount)
            .div(balanceOf(msg.sender));

        _burn(msg.sender, amount);

        IHumaPoolLocker(poolLocker).transfer(msg.sender, amountToWithdraw);

        emit LiquidityWithdrawn(msg.sender, amount, amountToWithdraw);

        return true;
    }

    /**
     * @notice Withdraw all balance from the pool.
     */
    function withdrawAll() external returns (bool) {
        return withdraw(lenderInfo[msg.sender].amount);
    }

    //********************************************/
    //         Borrower Functions                //
    //********************************************/
    // Apply to borrow from the pool. Borrowing is subject to interest,
    // collateral, and maximum loan requirements as dictated by the pool
    function requestCredit(
        uint256 _borrowAmt,
        uint256 _paymentInterval,
        uint256 _numOfPayments
    ) external returns (bool) {
        poolOn();
        uint256[] memory terms = getLoanTerms(_paymentInterval, _numOfPayments);
        _requestCredit(msg.sender, _borrowAmt, terms, false);
        return true;
    }

    function postApprovedCreditRequest(
        address borrower,
        uint256 _borrowAmt,
        uint256[] memory _terms
    ) public returns (address) {
        poolOn();
        require(
            creditApprovers[msg.sender] == true,
            "HumaPool:ILLEGAL_CREDIT_POSTER"
        );
        address loanAddress = _requestCredit(
            borrower,
            _borrowAmt,
            _terms,
            true
        );
        IHumaCredit(loanAddress).approve();
        return loanAddress;
    }

    function _requestCredit(
        address borrower,
        uint256 _borrowAmt,
        uint256[] memory terms,
        bool isPreapproved
    ) internal returns (address credit) {
        // Borrowers must not have existing loans from this pool
        require(
            creditMapping[borrower] == address(0),
            "HumaPool:DENY_BORROW_EXISTING_LOAN"
        );

        // Borrowing amount needs to be higher than min for the pool.
        require(
            _borrowAmt >= minBorrowAmt,
            "HumaPool:DENY_BORROW_SMALLER_THAN_LIMIT"
        );

        // Borrowing amount needs to be lower than max for the pool.
        require(
            maxBorrowAmt >= _borrowAmt,
            "HumaPool:DENY_BORROW_GREATER_THAN_LIMIT"
        );

        address treasuryAddress = HumaConfig(humaConfig).humaTreasury();
        //todo Add real collateral info

        credit = HumaCreditFactory(humaCreditFactory).deployNewCredit(
            payable(address(this)),
            poolCreditType,
            poolLocker,
            humaConfig,
            treasuryAddress,
            borrower,
            address(poolToken),
            _borrowAmt,
            address(0),
            0,
            terms,
            isPreapproved
        );
        creditMapping[borrower] = credit;

        return credit;
    }

    function invalidateApprovedCredit(address _borrower) external {
        poolOn();
        require(
            creditApprovers[msg.sender] == true,
            "HumaPool:ILLEGAL_CREDIT_POSTER"
        );

        creditMapping[_borrower] = address(0);
    }

    function originateCredit(uint256 borrowAmt) external returns (bool) {
        return originateCreditWithCollateral(borrowAmt, address(0), 0, 0);
    }

    function originateCreditWithPreapproval(
        address borrower,
        uint256 borrowAmt,
        address collateralAsset,
        uint256 collateralParam,
        uint256 collateralAmount,
        uint256[] memory terms
    ) external {
        poolOn();
        // Limits this function to pre-approved approvers to call.
        require(
            creditApprovers[msg.sender] == true,
            "HumaPool:ILLEGAL_CREDIT_POSTER"
        );
        _requestCredit(borrower, borrowAmt, terms, true);
        _processOriginationWithCollateral(
            borrower,
            borrowAmt,
            collateralAsset,
            collateralParam,
            collateralAmount
        );
    }

    function originateCreditWithCollateral(
        uint256 borrowAmt,
        address collateralAsset,
        uint256 collateralParam,
        uint256 collateralAmount
    ) public returns (bool) {
        poolOn();
        require(
            creditMapping[msg.sender] != address(0),
            "HumaPool:NO_EXISTING_LOAN_REQUESTS"
        );

        _processOriginationWithCollateral(
            msg.sender,
            borrowAmt,
            collateralAsset,
            collateralParam,
            collateralAmount
        );
        return true;
    }

    function _processOriginationWithCollateral(
        address borrower,
        uint256 borrowAmt,
        address collateralAsset,
        uint256 collateralParam,
        uint256 collateralAmount
    ) public returns (bool) {
        IHumaCredit humaCreditContract = IHumaCredit(creditMapping[borrower]);
        require(
            humaCreditContract.isApproved(),
            "HumaPool:CREDIT_NOT_APPROVED"
        );

        (uint256 amtForBorrower, uint256 totalFees) = humaCreditContract
            .originateCredit(borrowAmt);

        // Split the fee between treasury and the pool
        uint256 protocolFee = uint256(HumaConfig(humaConfig).treasuryFee())
            .mul(humaCreditContract.getCreditBalance())
            .div(10000);

        assert(totalFees >= protocolFee);

        uint256 poolIncome = totalFees.sub(protocolFee);

        distributeIncome(poolIncome);

        //CRITICAL: Transfer collateral and funding the loan
        // Transfer collateral
        // InterfaceId_ERC721 = 0x80ac58cd;
        if (collateralAsset != address(0)) {
            if (collateralAsset.supportsInterface(type(IERC721).interfaceId)) {
                IERC721(collateralAsset).safeTransferFrom(
                    borrower,
                    poolLocker,
                    collateralParam
                );
            } else if (
                collateralAsset.supportsInterface(type(IERC20).interfaceId)
            ) {
                IERC20(collateralAsset).safeTransferFrom(
                    borrower,
                    poolLocker,
                    collateralAmount
                );
            } else {
                revert("HumaPool:COLLATERAL_ASSET_NOT_SUPPORTED");
            }
        }
        // Transfer liquidity asset
        address treasuryAddress = HumaConfig(humaConfig).humaTreasury();
        HumaPoolLocker locker = HumaPoolLocker(poolLocker);
        locker.transfer(treasuryAddress, protocolFee);
        locker.transfer(borrower, amtForBorrower);
        return true;
    }

    function processRefund(address receiver, uint256 amount)
        external
        returns (bool)
    {
        require(
            creditMapping[receiver] == msg.sender,
            "HumaPool:ILLEGAL_REFUND_REQUESTER"
        );
        HumaPoolLocker locker = HumaPoolLocker(poolLocker);
        locker.transfer(receiver, amount);

        return true;
    }

    function reportReputationTracking(
        address borrower,
        IReputationTracker.TrackingType trackingType
    ) public {
        // To make sure only IHumaCredit implementors (e.g. HumaLoan) can call this function for reputation tracking.
        require(
            creditMapping[borrower] == msg.sender,
            "HumaPool:ILLEGAL_REPUTATION_TRACKING_REQUESTER"
        );
        IReputationTracker(reputationTrackerContractAddress).report(
            borrower,
            trackingType
        );
        // For payoff, remove the credit record so that the borrower can borrow again.
        if (trackingType == IReputationTracker.TrackingType.Payoff) {
            creditMapping[borrower] = address(0);
        }
    }

    /**
     * Retrieve loan terms from pool config. 
     //todo It is hard-coded right now. Need to call poll config to get the real data
    */
    function getLoanTerms(uint256 _paymentInterval, uint256 _numOfPayments)
        private
        view
        returns (uint256[] memory terms)
    {
        terms = new uint256[](9);
        terms[0] = interestRateBasis; //apr_in_bps
        terms[1] = platform_fee_flat;
        terms[2] = platform_fee_bps;
        terms[3] = late_fee_flat;
        terms[4] = late_fee_bps;
        terms[5] = _paymentInterval; //payment_interval, in days
        terms[6] = _numOfPayments; //numOfPayments
    }

    /********************************************/
    //                Settings                  //
    /********************************************/

    // Allow for sensitive pool functions only to be called by
    // the pool owner and the huma master admin
    function onlyOwnerOrHumaMasterAdmin() private view {
        require(
            (msg.sender == owner() ||
                msg.sender == HumaConfig(humaConfig).owner()),
            "HumaPool:PERMISSION_DENIED_NOT_ADMIN"
        );
    }

    // In order for a pool to issue new loans, it must be turned on by an admin
    // and its custom loan helper must be approved by the Huma team
    function poolOn() private view {
        require(
            HumaConfig(humaConfig).isProtocolPaused() == false,
            "HumaPool:PROTOCOL_PAUSED"
        );
        require(status == PoolStatus.On, "HumaPool:POOL_NOT_ON");
    }

    /**
     * @notice Adds an approver to the list who can approve loans.
     * @param approver the approver to be added
     */
    function addCreditApprover(address approver) external {
        onlyOwnerOrHumaMasterAdmin();
        creditApprovers[approver] = true;
    }

    function setPoolLocker(address _poolLocker) external returns (bool) {
        onlyOwnerOrHumaMasterAdmin();
        poolLocker = _poolLocker;

        return true;
    }

    /**
     * @notice Sets the min and max of each loan/credit allowed by the pool.
     */
    function setMinMaxBorrowAmt(uint256 minAmt, uint256 maxAmt) external {
        onlyOwnerOrHumaMasterAdmin();
        require(minAmt > 0, "HumaPool:MINAMT_IS_ZERO");
        require(maxAmt >= minAmt, "HumaPool:MAXAMIT_LESS_THAN_MINAMT");
        minBorrowAmt = minAmt;
        maxBorrowAmt = maxAmt;
    }

    function setInterestRateBasis(uint256 _interestRateBasis)
        external
        returns (bool)
    {
        onlyOwnerOrHumaMasterAdmin();
        require(_interestRateBasis >= 0);
        interestRateBasis = _interestRateBasis;

        return true;
    }

    function setCollateralRequired(uint256 _collateralRequired)
        external
        returns (bool)
    {
        onlyOwnerOrHumaMasterAdmin();
        require(_collateralRequired >= 0);
        collateralRequired = _collateralRequired;

        return true;
    }

    // Allow borrow applications and loans to be processed by this pool.
    function enablePool() external {
        onlyOwnerOrHumaMasterAdmin();
        status = PoolStatus.On;
    }

    /**
     * Sets the default grace period for this pool.
     * @param gracePeriod the desired grace period in seconds.
     */
    function setPoolDefaultGracePeriod(uint256 gracePeriod) external {
        onlyOwnerOrHumaMasterAdmin();
        poolDefaultGracePeriod = gracePeriod;
    }

    // Reject all future borrow applications and loans. Note that existing
    // loans will still be processed as expected.
    function disablePool() external {
        onlyOwnerOrHumaMasterAdmin();
        status = PoolStatus.Off;
    }

    function getLoanWithdrawalLockoutPeriod() public view returns (uint256) {
        return loanWithdrawalLockoutPeriod;
    }

    function setLoanWithdrawalLockoutPeriod(
        uint256 _loanWithdrawalLockoutPeriod
    ) external {
        onlyOwnerOrHumaMasterAdmin();
        loanWithdrawalLockoutPeriod = _loanWithdrawalLockoutPeriod;
    }

    /**
     * @notice Sets the cap of the pool liquidity.
     */
    function setPoolLiquidityCap(uint256 cap) external {
        onlyOwnerOrHumaMasterAdmin();
        liquidityCap = cap;
    }

    function setFees(
        uint256 _platform_fee_flat,
        uint256 _platform_fee_bps,
        uint256 _late_fee_flat,
        uint256 _late_fee_bps
    ) public {
        onlyOwnerOrHumaMasterAdmin();
        require(
            _platform_fee_bps > HumaConfig(humaConfig).treasuryFee(),
            "HumaPool:PLATFORM_FEE_BPS_LESS_THAN_PROTOCOL_BPS"
        );
        platform_fee_flat = _platform_fee_flat;
        platform_fee_bps = _platform_fee_bps;
        late_fee_flat = _late_fee_flat;
        late_fee_bps = _late_fee_bps;
    }

    function getLenderInfo(address _lender)
        public
        view
        returns (LenderInfo memory)
    {
        return lenderInfo[_lender];
    }

    function getPoolLiquidity() public view returns (uint256) {
        return poolToken.balanceOf(poolLocker);
    }

    // Function to receive Ether. msg.data must be empty
    receive() external payable {}

    // Fallback function is called when msg.data is not empty
    fallback() external payable {}

    function getBalance() public view returns (uint256) {
        return address(this).balance;
    }

    function getPoolSummary()
        public
        view
        returns (
            address token,
            uint256 apr,
            uint256 minCreditAmt,
            uint256 maxCreditAmt,
            uint256 liquiditycap,
            string memory name,
            string memory symbol,
            uint8 decimal
        )
    {
        ERC20 erc20Contract = ERC20(address(poolToken));
        return (
            address(poolToken),
            interestRateBasis,
            minBorrowAmt,
            maxBorrowAmt,
            liquidityCap,
            erc20Contract.name(),
            erc20Contract.symbol(),
            erc20Contract.decimals()
        );
    }

    /// returns (maxLoanAmt, interest, and the 6 fee fields)
    function getPoolFees()
        public
        view
        returns (
            uint256,
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        return (
            interestRateBasis,
            platform_fee_flat,
            platform_fee_bps,
            late_fee_flat,
            late_fee_bps
        );
    }

    function getPoolLockerAddress() external view returns (address) {
        return poolLocker;
    }

    function getPoolDefaultGracePeriod() external view returns (uint256) {
        return poolDefaultGracePeriod;
    }

    function getApprovalStatusForBorrower(address borrower)
        external
        view
        returns (bool)
    {
        if (creditMapping[borrower] == address(0)) return false;
        return IHumaCredit(creditMapping[borrower]).isApproved();
    }
}
