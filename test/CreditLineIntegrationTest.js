/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {expect} = require("chai");
const {
    deployContracts,
    deployAndSetupPool,
    advanceClock,
    checkRecord,
    checkResult,
    checkArruedIncome,
    toToken,
    setNextBlockTimestamp,
    mineNextBlockWithTimestamp,
} = require("./BaseTest");

let poolContract;
let poolConfigContract;
let hdtContract;
let humaConfigContract;
let testTokenContract;
let feeManagerContract;
let defaultDeployer;
let proxyOwner;
let lender;
let borrower;
let borrower2;
let treasury;
let evaluationAgent;
let poolOwner;
let record;
let recordStatic;
let initialTimestamp;
let dueDate, nextDate;
let protocolOwner;
let eaNFTContract;
let eaServiceAccount;
let pdsServiceAccount;
let poolOperator;
let poolOwnerTreasury;

describe("Credit Line Integration Test", async function () {
    before(async function () {
        [
            defaultDeployer,
            proxyOwner,
            lender,
            borrower,
            treasury,
            evaluationAgent,
            poolOwner,
            protocolOwner,
            eaServiceAccount,
            pdsServiceAccount,
            poolOperator,
            poolOwnerTreasury,
        ] = await ethers.getSigners();

        [humaConfigContract, feeManagerContract, testTokenContract, eaNFTContract] =
            await deployContracts(
                poolOwner,
                treasury,
                lender,
                protocolOwner,
                eaServiceAccount,
                pdsServiceAccount
            );

        [hdtContract, poolConfigContract, poolContract] = await deployAndSetupPool(
            poolOwner,
            proxyOwner,
            evaluationAgent,
            lender,
            humaConfigContract,
            feeManagerContract,
            testTokenContract,
            500,
            eaNFTContract,
            false,
            poolOperator,
            poolOwnerTreasury
        );

        await feeManagerContract.connect(poolOwner).setFees(toToken(10), 100, toToken(20), 500, 0);
        await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(500);
        await poolConfigContract.connect(poolOwner).setPoolDefaultGracePeriod(60);
    });

    it("Day 0: Initial drawdown", async function () {
        // Establish credit line
        await poolContract.connect(borrower).requestCredit(toToken(5040), 30, 12);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            0,
            "SKIP",
            0,
            0,
            0,
            0,
            12,
            1217,
            30,
            1,
            0
        );

        await poolContract
            .connect(eaServiceAccount)
            .approveCredit(borrower.address, toToken(5040), 30, 12, 1217);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            0,
            "SKIP",
            0,
            0,
            0,
            0,
            12,
            1217,
            30,
            2,
            0
        );

        await poolContract.connect(borrower).drawdown(toToken(2000));
        let blockBefore = await ethers.provider.getBlock();
        dueDate = blockBefore.timestamp + 2592000;

        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            toToken(1900),
            dueDate,
            0,
            120005479,
            20005479,
            0,
            11,
            1217,
            30,
            3,
            0
        );

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 0, 20005479, 120005479, toToken(1900), 0);
    });

    it("Day 15: Second drawdown (to test offset)", async function () {
        nextDate = dueDate - 15 * 24 * 3600;
        await setNextBlockTimestamp(nextDate);
        await poolContract.connect(borrower).drawdown(toToken(2000));

        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            toToken(3900),
            dueDate,
            10002739,
            120005479,
            20005479,
            0,
            11,
            1217,
            30,
            3,
            0
        );

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 0, 20005479, 120005479, toToken(3900), 0);
    });

    it("Day 18: 1st payment", async function () {
        await testTokenContract.connect(borrower).approve(poolContract.address, toToken(121));

        nextDate = nextDate + 3 * 24 * 3600;
        await setNextBlockTimestamp(nextDate);
        await poolContract.connect(borrower).makePayment(borrower.address, toToken(121));

        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            3899005479,
            dueDate,
            9598651,
            0,
            0,
            0,
            11,
            1217,
            30,
            3,
            0
        );

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 0, 0, 0, 3899005479, 0);
    });

    it("Day 30: 2nd statement", async function () {
        nextDate = dueDate + 1;
        await mineNextBlockWithTimestamp(nextDate);
        dueDate += 2592000;

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 1, 39096749, 234526955, 3713173924, 48695400);
    });

    it("Day 40: 2st payment (pay full amountDue)", async function () {
        await testTokenContract.connect(borrower).approve(poolContract.address, toToken(235));

        nextDate = dueDate - 20 * 24 * 3600;
        await setNextBlockTimestamp(nextDate);
        await poolContract.connect(borrower).makePayment(borrower.address, toToken(235));

        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            3712700879,
            dueDate,
            -1306379,
            0,
            0,
            0,
            10,
            1217,
            30,
            3,
            0
        );
    });

    it("Day 60: 3rd statement", async function () {
        nextDate = dueDate + 1;
        await mineNextBlockWithTimestamp(nextDate);
        dueDate += 2592000;

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 1, 37124113, 222693838, 3525824775, 35817734);
    });

    it("Day 75: 2nd payment (pay partial amountDue incl. all feesAndInterestDue)", async function () {
        await testTokenContract.connect(borrower).approve(poolContract.address, toToken(100));

        // Advance 15 days for a mid-cycle event
        nextDate = dueDate - 15 * 24 * 3600;
        await setNextBlockTimestamp(nextDate);
        await poolContract.connect(borrower).makePayment(borrower.address, toToken(100));

        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            3525824775,
            dueDate,
            -314465,
            122693838,
            0,
            0,
            9,
            1217,
            30,
            3,
            0
        );
    });

    it("Day 90: 4th statement (late due to partial payment", async function () {
        // Advance 15 days to the next cycle
        nextDate = dueDate + 1;
        await mineNextBlockWithTimestamp(nextDate);
        dueDate += 2592000;

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 1, 238917966, 421328173, 3465793941, 238603501);
    });

    it("Day 100: Partial payment (lower than F&I)", async function () {
        await testTokenContract.connect(borrower).approve(poolContract.address, toToken(100));

        nextDate = dueDate - 20 * 24 * 3600;
        await setNextBlockTimestamp(nextDate);
        await poolContract.connect(borrower).makePayment(borrower.address, toToken(100));

        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            3465793941,
            dueDate,
            0,
            321328173,
            138917966,
            1,
            8,
            1217,
            30,
            4,
            0
        );
    });

    it("Day 105: Over payment", async function () {
        await testTokenContract.connect(borrower).approve(poolContract.address, toToken(400));

        nextDate = nextDate + 5 * 24 * 3600;
        await setNextBlockTimestamp(nextDate);
        await poolContract.connect(borrower).makePayment(borrower.address, toToken(400));

        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            3387122114,
            dueDate,
            -1305767,
            0,
            0,
            0,
            8,
            1217,
            30,
            3,
            0
        );
    });

    it("Day 110: Extra principal payment)", async function () {
        await testTokenContract.connect(borrower).approve(poolContract.address, toToken(400));

        nextDate = nextDate + 5 * 24 * 3600;
        await setNextBlockTimestamp(nextDate);
        await poolContract.connect(borrower).makePayment(borrower.address, toToken(400));

        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            2987122114,
            dueDate,
            -2639465,
            0,
            0,
            0,
            8,
            1217,
            30,
            3,
            0
        );
    });

    it("Day 120: 5th statement", async function () {
        nextDate = dueDate + 1;
        await mineNextBlockWithTimestamp(nextDate);
        dueDate += 2592000;

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 1, 29853003, 179077135, 2835258517, 27213538);
    });

    it("Day 150: 1st late", async function () {
        nextDate = dueDate + 1;
        await mineNextBlockWithTimestamp(nextDate);
        dueDate += 2592000;

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 2, 200868396, 351585178, 2863618870, 228081934);
    });

    it("Day 180: 2nd late", async function () {
        nextDate = dueDate + 1;
        await mineNextBlockWithTimestamp(nextDate);
        dueDate += 2592000;

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 3, 212921051, 373681253, 3054443846, 441002985);
    });

    it("Day 210: third late fee due to no payment", async function () {
        nextDate = dueDate + 1;
        await mineNextBlockWithTimestamp(nextDate);
        dueDate += 2592000;

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 4, 225696897, 397103151, 3256718845, 666699882);
    });

    // Technically default can be triggered for this account right now.
    // Will add a default trigger later.

    it("Day 220: Pay off", async function () {
        await testTokenContract.mint(borrower.address, toToken(10000));
        await testTokenContract.connect(borrower).approve(poolContract.address, toToken(3654));

        nextDate = dueDate - 20 * 24 * 3600;
        await setNextBlockTimestamp(nextDate);
        await expect(poolContract.connect(borrower).makePayment(borrower.address, toToken(3654)))
            .emit(poolContract, "PaymentMade")
            .withArgs(borrower.address, 3630961568, 0, 0, borrower.address);

        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            0,
            dueDate,
            0,
            0,
            0,
            0,
            4,
            1217,
            30,
            3,
            0
        );
    });

    // This happens slightly after day 300. Thus mis the cycle. No bill is generated until day 330
    it("Day 300: New borrow after being dormant for 4 periods", async function () {
        nextDate = nextDate + 80 * 24 * 3600;
        await setNextBlockTimestamp(nextDate);
        dueDate += 2592000 * 3;
        await poolContract.connect(borrower).drawdown(toToken(4000));

        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            toToken(4000),
            dueDate,
            40010958,
            0,
            0,
            0,
            1,
            1217,
            30,
            3,
            0
        );
    });

    it("Day 330: new bill", async function () {
        nextDate = dueDate + 1;
        await mineNextBlockWithTimestamp(nextDate);
        dueDate += 2592000;

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 1, 40411178, 4080422136, 0, 80422136);
    });

    // Note, this is for testing purpose. In reality, it is unliekly to extend the line by 30 days
    it("Day 345: Extend the credit line by 60 days", async function () {
        nextDate = dueDate - 15 * 24 * 3600;
        await setNextBlockTimestamp(nextDate);
        await poolContract.connect(eaServiceAccount).extendCreditLineDuration(borrower.address, 2);

        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            0,
            dueDate,
            0,
            4080422136,
            40411178,
            0,
            2,
            1217,
            30,
            3,
            0
        );
    });

    it("Day 350: Partial pay, below required interest", async function () {
        await testTokenContract.connect(borrower).approve(poolContract.address, toToken(20));

        nextDate = nextDate + 5 * 24 * 3600;
        await setNextBlockTimestamp(nextDate);
        await poolContract.connect(borrower).makePayment(borrower.address, toToken(20));

        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            0,
            dueDate,
            0,
            4060422136,
            20411178,
            0,
            2,
            1217,
            30,
            3,
            0
        );
    });

    it("Day 352: Drawdown blocked due to over limit", async function () {
        nextDate = nextDate + 2 * 24 * 3600;
        await setNextBlockTimestamp(nextDate);
        await expect(
            poolContract.connect(borrower).drawdown(toToken(2000))
        ).to.be.revertedWithCustomError(poolContract, "creditLineExceeded");
    });

    it("Day 355: Additional drawdown within limit allowed", async function () {
        nextDate = nextDate + 3 * 24 * 3600;
        await setNextBlockTimestamp(nextDate);
        await poolContract.connect(borrower).drawdown(toToken(999));

        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            toToken(999),
            dueDate,
            1665456,
            4060422136,
            20411178,
            0,
            2,
            1217,
            30,
            3,
            0
        );
    });

    it("Day 358: Pay with amountDue", async function () {
        await testTokenContract.connect(borrower).approve(poolContract.address, toToken(4061));

        nextDate = nextDate + 3 * 24 * 3600;
        await setNextBlockTimestamp(nextDate);
        await poolContract.connect(borrower).makePayment(borrower.address, toToken(4061));

        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            998422136,
            dueDate,
            -1029007,
            0,
            0,
            0,
            2,
            1217,
            30,
            3,
            0
        );
    });

    it("Day 360: normal statement", async function () {
        nextDate = dueDate + 1;
        await mineNextBlockWithTimestamp(nextDate);
        dueDate += 2592000;
        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 1, 9976663, 59846319, 947523473, 8947656);
    });

    it("Day 380: Pay with amountDue", async function () {
        await testTokenContract.connect(borrower).approve(poolContract.address, toToken(60));

        nextDate = dueDate - 10 * 24 * 3600;
        await setNextBlockTimestamp(nextDate);
        await poolContract.connect(borrower).makePayment(borrower.address, toToken(60));

        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            947369792,
            dueDate,
            -166790,
            0,
            0,
            0,
            1,
            1217,
            30,
            3,
            0
        );
    });

    it("Day 390: Final statement, all principal due", async function () {
        nextDate = dueDate + 1;
        await mineNextBlockWithTimestamp(nextDate);
        dueDate += 2592000;
        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 1, 9474625, 956677627, 0, 9307835);
    });

    it("Day 400: Additional drawdown blocked (credit line matured)", async function () {
        nextDate = dueDate - 20 * 24 * 3600;
        await setNextBlockTimestamp(nextDate);
        await expect(
            poolContract.connect(borrower).drawdown(toToken(10))
        ).to.be.revertedWithCustomError(poolContract, "creditExpiredDueToMaturity");
    });

    it("Day 415: Payoff", async function () {
        await testTokenContract.connect(borrower).approve(poolContract.address, toToken(957));

        nextDate = nextDate + 5 * 24 * 3600;
        await setNextBlockTimestamp(nextDate);
        await expect(poolContract.connect(borrower).makePayment(borrower.address, toToken(957)))
            .emit(poolContract, "PaymentMade")
            .withArgs(borrower.address, 951940315, 0, 0, borrower.address);

        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(
            record,
            recordStatic,
            toToken(5040),
            0,
            dueDate,
            0,
            0,
            0,
            0,
            0,
            1217,
            30,
            0,
            0
        );
    });
});
