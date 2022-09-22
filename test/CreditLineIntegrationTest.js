/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {use, expect} = require("chai");
const {solidity} = require("ethereum-waffle");
const {deployContracts, deployAndSetupPool, advanceClock} = require("./BaseTest");

use(solidity);

let poolContract;
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
let dueDate;
let protocolOwner;
let eaNFTContract;

let checkRecord = function (r, rs, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
    if (v1 != "SKIP") expect(rs.creditLimit).to.equal(v1);
    if (v2 != "SKIP") expect(r.unbilledPrincipal).to.equal(v2);
    if (v3 != "SKIP") expect(r.dueDate).to.be.within(v3 - 60, v3 + 60);
    if (v4 != "SKIP") expect(r.correction).to.equal(v4); //be.within(v4 - 1, v4 + 1);
    if (v5 != "SKIP") expect(r.totalDue).to.equal(v5);
    if (v6 != "SKIP") expect(r.feesAndInterestDue).to.equal(v6);
    if (v7 != "SKIP") expect(r.missedPeriods).to.equal(v7);
    if (v8 != "SKIP") expect(r.remainingPeriods).to.equal(v8);
    if (v9 != "SKIP") expect(rs.aprInBps).to.equal(v9);
    if (v10 != "SKIP") expect(rs.intervalInDays).to.equal(v10);
    if (v11 != "SKIP") expect(r.state).to.equal(v11);
};

let checkResult = function (r, v1, v2, v3, v4, v5) {
    expect(r.periodsPassed).to.equal(v1);
    expect(r.feesAndInterestDue).to.equal(v2);
    expect(r.totalDue).to.equal(v3);
    expect(r.unbilledPrincipal).to.equal(v4);
    expect(r.totalCharges).to.equal(v5);
};

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
        ] = await ethers.getSigners();

        [humaConfigContract, feeManagerContract, testTokenContract, eaNFTContract] =
            await deployContracts(poolOwner, treasury, lender, protocolOwner);

        [hdtContract, poolContract] = await deployAndSetupPool(
            poolOwner,
            proxyOwner,
            evaluationAgent,
            lender,
            humaConfigContract,
            feeManagerContract,
            testTokenContract,
            500,
            eaNFTContract
        );

        await feeManagerContract.connect(poolOwner).setFees(10, 100, 20, 500);
        await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(500);
        await poolContract.connect(poolOwner).setPoolDefaultGracePeriod(60);
    });

    it("Day 0: Initial drawdown", async function () {
        // Establish credit line
        await poolContract.connect(borrower).requestCredit(5000, 30, 12);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 0, "SKIP", 0, 0, 0, 0, 12, 1217, 30, 1);

        await poolContract.connect(evaluationAgent).approveCredit(borrower.address);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 0, "SKIP", 0, 0, 0, 0, 12, 1217, 30, 2);

        let blockNumBefore = await ethers.provider.getBlockNumber();
        let blockBefore = await ethers.provider.getBlock(blockNumBefore);

        dueDate = blockBefore.timestamp + 2592000;

        await poolContract.connect(borrower).drawdown(2000);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 1900, dueDate, 0, 120, 20, 0, 11, 1217, 30, 3);

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 0, 20, 120, 1900, 0);
    });

    it("Day 15: Second drawdown (to test offset)", async function () {
        advanceClock(15);

        await poolContract.connect(borrower).drawdown(2000);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 3900, dueDate, 10, 120, 20, 0, 11, 1217, 30, 3);

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 0, 20, 120, 3900, 0);
    });

    it("Day 18: 1st payment", async function () {
        advanceClock(3);

        await testTokenContract.connect(borrower).approve(poolContract.address, 120);
        await poolContract
            .connect(borrower)
            .makePayment(borrower.address, testTokenContract.address, 120);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 3900, dueDate, 10, 0, 0, 0, 11, 1217, 30, 3);

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 0, 0, 0, 3900, 0);
    });

    it("Day 30: 2nd statement", async function () {
        advanceClock(12);
        dueDate += 2592000;

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 1, 49, 244, 3705, 49);
    });

    it("Day 40: 2st payment (pay full amountDue)", async function () {
        advanceClock(10);

        await testTokenContract.connect(borrower).approve(poolContract.address, 244);
        await poolContract
            .connect(borrower)
            .makePayment(borrower.address, testTokenContract.address, 244);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 3705, dueDate, -1, 0, 0, 0, 10, 1217, 30, 3);
    });

    it("Day 60: 3rd statement", async function () {
        advanceClock(20);
        dueDate += 2592000;

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 1, 36, 221, 3520, 36);
    });

    it("Day 75: 2nd payment (pay partial amountDue incl. all feesAndInterestDue)", async function () {
        // Advance 15 days for a mid-cycle event
        advanceClock(15);

        await testTokenContract.connect(borrower).approve(poolContract.address, 100);
        await poolContract
            .connect(borrower)
            .makePayment(borrower.address, testTokenContract.address, 100);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 3520, dueDate, 0, 121, 0, 0, 9, 1217, 30, 3);
    });

    it("Day 90: 4th statement (late due to partial payment", async function () {
        // Advance 15 days to the next cycle
        advanceClock(15);
        dueDate += 2592000;

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 1, 238, 420, 3459, 238);
    });

    it("Day 100: Partial payment (lower than F&I)", async function () {
        advanceClock(10);

        await testTokenContract.connect(borrower).approve(poolContract.address, 100);
        await poolContract
            .connect(borrower)
            .makePayment(borrower.address, testTokenContract.address, 100);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 3459, dueDate, 0, 320, 138, 1, 8, 1217, 30, 4);
    });

    it("Day 105: Over payment", async function () {
        advanceClock(5);

        await testTokenContract.connect(borrower).approve(poolContract.address, 400);
        await poolContract
            .connect(borrower)
            .makePayment(borrower.address, testTokenContract.address, 400);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 3379, dueDate, -1, 0, 0, 0, 8, 1217, 30, 3);
    });

    it("Day 110: Extra principal payment)", async function () {
        advanceClock(5);

        await testTokenContract.connect(borrower).approve(poolContract.address, 400);
        await poolContract
            .connect(borrower)
            .makePayment(borrower.address, testTokenContract.address, 400);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 2979, dueDate, -2, 0, 0, 0, 8, 1217, 30, 3);
    });

    it("Day 120: 5th statement", async function () {
        advanceClock(10);
        dueDate += 2592000;

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 1, 27, 175, 2831, 27);
    });

    it("Day 150: 1st late", async function () {
        advanceClock(30);
        dueDate += 2592000;

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 2, 200, 350, 2856, 227);
    });

    it("Day 180: 2nd late", async function () {
        advanceClock(30);
        dueDate += 2592000;

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 3, 212, 372, 3046, 439);
    });

    it("Day 210: third late fee due to no payment", async function () {
        advanceClock(30);
        dueDate += 2592000;

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 4, 224, 394, 3248, 663);
    });

    // Technically default can be triggered for this account right now.
    // Will add a default trigger later.

    it("Day 220: Pay off", async function () {
        advanceClock(10);

        await testTokenContract.give1000To(borrower.address);

        await testTokenContract.connect(borrower).approve(poolContract.address, 3642);
        await expect(
            poolContract
                .connect(borrower)
                .makePayment(borrower.address, testTokenContract.address, 3642)
        )
            .emit(poolContract, "PaymentMade")
            .withArgs(borrower.address, 3620, borrower.address);

        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 0, dueDate, 0, 0, 0, 0, 4, 1217, 30, 3);
    });

    it("Day 300: New borrow after being dormant for 4 periods", async function () {
        advanceClock(80);
        dueDate += 2592000 * 3;

        await poolContract.connect(borrower).drawdown(4000);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 4000, dueDate, 40, 0, 0, 0, 1, 1217, 30, 3);
    });

    it("Day 330: new bill", async function () {
        advanceClock(30);
        dueDate += 2592000;

        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 1, 80, 4080, 0, 80);
    });

    // Note, this is for testing purpose. In reality, it is unliekly to extend the line by 30 days
    it("Day 345: Extend the credit line by 60 days", async function () {
        advanceClock(15);
        await poolContract.connect(evaluationAgent).extendCreditLineDuration(borrower.address, 2);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 0, dueDate, 0, 4080, 80, 0, 2, 1217, 30, 3);
    });

    it("Day 350: Partial pay, below required interest", async function () {
        advanceClock(5);
        await testTokenContract.connect(borrower).approve(poolContract.address, 20);
        await poolContract
            .connect(borrower)
            .makePayment(borrower.address, testTokenContract.address, 20);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 0, dueDate, 0, 4060, 60, 0, 2, 1217, 30, 3);
    });

    it("Day 352: Drawdown blocked due to over limit", async function () {
        advanceClock(2);
        await expect(poolContract.connect(borrower).drawdown(2000)).to.be.revertedWith(
            "creditLineExceeded()"
        );
    });

    it("Day 355: Additional drawdown within limit allowed", async function () {
        advanceClock(3);
        await poolContract.connect(borrower).drawdown(1000);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 1000, dueDate, 1, 4060, 60, 0, 2, 1217, 30, 3);
    });

    it("Day 358: Pay with amountDue", async function () {
        advanceClock(3);
        await testTokenContract.connect(borrower).approve(poolContract.address, 4060);
        await poolContract
            .connect(borrower)
            .makePayment(borrower.address, testTokenContract.address, 4060);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 1000, dueDate, -1, 0, 0, 0, 2, 1217, 30, 3);
    });

    it("Day 360: normal statement", async function () {
        advanceClock(2);
        dueDate += 2592000;
        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 1, 9, 59, 950, 9);
    });

    it("Day 380: Pay with amountDue", async function () {
        advanceClock(20);
        await testTokenContract.connect(borrower).approve(poolContract.address, 59);
        await poolContract
            .connect(borrower)
            .makePayment(borrower.address, testTokenContract.address, 59);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 950, dueDate, 0, 0, 0, 0, 1, 1217, 30, 3);
    });

    it("Day 390: Final statement, all principal due", async function () {
        advanceClock(10);
        dueDate += 2592000;
        let r = await feeManagerContract.getDueInfo(record, recordStatic);
        checkResult(r, 1, 9, 959, 0, 9);
    });

    it("Day 400: Additional drawdown blocked (credit line matured)", async function () {
        advanceClock(10);
        await expect(poolContract.connect(borrower).drawdown(10)).to.be.revertedWith(
            "creditExpiredDueToMaturity()"
        );
    });

    it("Day 415: Payoff", async function () {
        advanceClock(5);
        await testTokenContract.connect(borrower).approve(poolContract.address, 959);
        await expect(
            poolContract
                .connect(borrower)
                .makePayment(borrower.address, testTokenContract.address, 959)
        )
            .emit(poolContract, "PaymentMade")
            .withArgs(borrower.address, 955, borrower.address);
        record = await poolContract.creditRecordMapping(borrower.address);
        recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
        checkRecord(record, recordStatic, 5000, 0, dueDate, 0, 0, 0, 0, 0, 1217, 30, 3);
    });
});
