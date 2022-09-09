/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {use, expect} = require("chai");
const {solidity} = require("ethereum-waffle");
const {deployContracts, deployAndSetupPool} = require("./BaseTest");

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
let initialTimestamp;

let checkRecord = function (r, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
    if (v1 != "SKIP") expect(r.creditLimit).to.equal(v1);
    if (v2 != "SKIP") expect(r.unbilledPrincipal).to.equal(v2);
    if (v3 != "SKIP") expect(r.dueDate).to.be.within(v3 - 60, v3 + 60);
    if (v4 != "SKIP") expect(r.correction).to.equal(v4); //be.within(v4 - 1, v4 + 1);
    if (v5 != "SKIP") expect(r.totalDue).to.equal(v5);
    if (v6 != "SKIP") expect(r.feesAndInterestDue).to.equal(v6);
    if (v7 != "SKIP") expect(r.missedPeriods).to.equal(v7);
    if (v8 != "SKIP") expect(r.remainingPeriods).to.equal(v8);
    if (v9 != "SKIP") expect(r.aprInBps).to.equal(v9);
    if (v10 != "SKIP") expect(r.intervalInDays).to.equal(v10);
    if (v11 != "SKIP") expect(r.state).to.equal(v11);
};

let checkResult = function (r, v1, v2, v3, v4) {
    expect(r.periodsPassed).to.equal(v1);
    expect(r.feesAndInterestDue).to.equal(v2);
    expect(r.totalDue).to.equal(v3);
    expect(r.payoffAmount).to.equal(v4);
};

let advanceClock = async function (days) {
    await ethers.provider.send("evm_increaseTime", [3600 * 24 * days]);
    await ethers.provider.send("evm_mine", []);
};

describe("Credit Line Integration Test", async function () {
    before(async function () {
        [defaultDeployer, proxyOwner, lender, borrower, treasury, evaluationAgent, poolOwner] =
            await ethers.getSigners();

        [humaConfigContract, feeManagerContract, testTokenContract] = await deployContracts(
            poolOwner,
            treasury,
            lender
        );

        [hdtContract, poolContract] = await deployAndSetupPool(
            poolOwner,
            proxyOwner,
            evaluationAgent,
            lender,
            humaConfigContract,
            feeManagerContract,
            testTokenContract,
            500
        );
    });

    it("Day 0: Initial drawdown", async function () {
        // Establish credit line
        await poolContract.connect(borrower).requestCredit(5000, 30, 12);
        record = await poolContract.creditRecordMapping(borrower.address);
        checkRecord(record, 5000, 0, "SKIP", 0, 0, 0, 0, 12, 1217, 30, 1);

        await poolContract.connect(evaluationAgent).approveCredit(borrower.address);
        record = await poolContract.creditRecordMapping(borrower.address);
        checkRecord(record, 5000, 0, "SKIP", 0, 0, 0, 0, 12, 1217, 30, 2);

        let blockNumBefore = await ethers.provider.getBlockNumber();
        let blockBefore = await ethers.provider.getBlock(blockNumBefore);
        initialTimestamp = blockBefore.timestamp;

        await poolContract.connect(borrower).drawdown(2000);
        record = await poolContract.creditRecordMapping(borrower.address);
        checkRecord(record, 5000, 2000, initialTimestamp + 2592000, 0, 0, 0, 0, 12, 1217, 30, 3);

        let r = await feeManagerContract.getDueInfo(record);
        checkResult(r, 0, 0, 0, 2020, 2000);
    });

    it("Day 15: Second drawdown (to test offset)", async function () {
        advanceClock(15);

        await poolContract.connect(borrower).drawdown(2000);
        record = await poolContract.creditRecordMapping(borrower.address);
        checkRecord(record, 5000, 4000, initialTimestamp + 2592000, -10, 0, 0, 0, 12, 1217, 30, 3);

        let r = await feeManagerContract.getDueInfo(record);
        checkResult(r, 0, 0, 0, 4030, 4000);
    });

    it("Day 30: 1st statement", async function () {
        advanceClock(15);
        let r = await feeManagerContract.getDueInfo(record);
        checkResult(r, 1, 30, 230, 4070, 3800);
    });

    it("Day 45: 1st payment (pay full amountDue)", async function () {
        advanceClock(15);
        let dueDate = initialTimestamp + 2592000 * 2;

        await testTokenContract.connect(borrower).approve(poolContract.address, 230);
        await poolContract
            .connect(borrower)
            .makePayment(borrower.address, testTokenContract.address, 230);
        record = await poolContract.creditRecordMapping(borrower.address);
        // correction is close to 1, but due to rounding to zero, it is 0.
        checkRecord(record, 5000, 3800, dueDate, 1, 0, 0, 0, 11, 1217, 30, 3);
    });

    it("Day 60: 2nd statement", async function () {
        // Advance 15 days to the next cycle
        advanceClock(15);

        let r = await feeManagerContract.getDueInfo(record);
        checkResult(r, 1, 39, 229, 3877, 3610);
    });

    it("Day 75: 2nd payment (pay partial amountDue incl. all feesAndInterestDue)", async function () {
        // Advance 15 days for a mid-cycle event
        advanceClock(15);

        let dueDate = initialTimestamp + 2592000 * 3;

        await testTokenContract.connect(borrower).approve(poolContract.address, 100);
        await poolContract
            .connect(borrower)
            .makePayment(borrower.address, testTokenContract.address, 100);
        record = await poolContract.creditRecordMapping(borrower.address);
        // correction is close to 1, but due to rounding to zero, it is 0.
        checkRecord(record, 5000, 3610, dueDate, 0, 129, 0, 0, 10, 1217, 30, 3);
    });

    it("Day 90: 3nd statement (late due to partial payment", async function () {
        // Advance 15 days to the next cycle
        advanceClock(15);

        let r = await feeManagerContract.getDueInfo(record);
        checkResult(r, 1, 243, 429, 4019, 3553);
    });

    it("Day 105: 3rd payment (pay full amountDue)", async function () {
        advanceClock(15);
        let dueDate = initialTimestamp + 2592000 * 4;

        await testTokenContract.connect(borrower).approve(poolContract.address, 500);
        await poolContract
            .connect(borrower)
            .makePayment(borrower.address, testTokenContract.address, 500);
        record = await poolContract.creditRecordMapping(borrower.address);
        checkRecord(record, 5000, 3482, dueDate, 1, 0, 0, 0, 9, 1217, 30, 3);
    });

    it("Day 110: 4th payment (extra principal payment)", async function () {
        advanceClock(5);

        let dueDate = initialTimestamp + 2592000 * 4;

        await testTokenContract.connect(borrower).approve(poolContract.address, 400);
        await poolContract
            .connect(borrower)
            .makePayment(borrower.address, testTokenContract.address, 400);
        record = await poolContract.creditRecordMapping(borrower.address);
        checkRecord(record, 5000, 3082, dueDate, 3, 0, 0, 0, 9, 1217, 30, 3);
    });

    it("Day 120: 4th statement", async function () {
        advanceClock(10);

        let r = await feeManagerContract.getDueInfo(record);
        checkResult(r, 1, 33, 187, 3145, 2928);
    });

    it("Day 150: first late fee due to no payment", async function () {
        advanceClock(30);
        let r = await feeManagerContract.getDueInfo(record);
        checkResult(r, 2, 206, 361, 3352, 2960);
    });

    it("Day 180: second late fee due to no payment", async function () {
        advanceClock(30);
        let r = await feeManagerContract.getDueInfo(record);
        checkResult(r, 3, 219, 385, 3573, 3155);
    });

    it("Day 210: third late fee due to no payment", async function () {
        advanceClock(30);
        let r = await feeManagerContract.getDueInfo(record);
        checkResult(r, 4, 232, 409, 3807, 3363);
    });

    it("Day 225: pay full amountDue", async function () {
        advanceClock(15);
        let dueDate = initialTimestamp + 2592000 * 8;

        await testTokenContract.give1000To(borrower.address);

        await testTokenContract.connect(borrower).approve(poolContract.address, 3807);
        await poolContract
            .connect(borrower)
            .makePayment(borrower.address, testTokenContract.address, 3807);
        record = await poolContract.creditRecordMapping(borrower.address);
        checkRecord(record, 5000, 0, dueDate, 0, 0, 0, 0, 5, 1217, 30, 3);
    });

    it("Day 330: New borrow after being dormant for 4 periods", async function () {
        advanceClock(105);
        let dueDate = initialTimestamp + 2592000 * 12;

        await poolContract.connect(borrower).drawdown(4000);
        record = await poolContract.creditRecordMapping(borrower.address);
        checkRecord(record, 5000, 4000, dueDate, 0, 0, 0, 0, 1, 1217, 30, 3);
    });

    // Note, this is for testing purpose. In reality, it is unliekly to extend the line by 30 days
    it("Day 345: Extend the credit line by 30 days", async function () {
        advanceClock(15);
        let dueDate = initialTimestamp + 2592000 * 12;
        await poolContract.connect(evaluationAgent).extendCreditLineDuration(borrower.address, 1);
        record = await poolContract.creditRecordMapping(borrower.address);
        checkRecord(record, 5000, 4000, dueDate, 0, 0, 0, 0, 2, 1217, 30, 3);
    });

    it("Day 360: normal statement", async function () {
        advanceClock(15);
        let r = await feeManagerContract.getDueInfo(record);
        checkResult(r, 1, 40, 240, 4080, 3800);
    });

    it("Day 370: Partial pay, below required interest", async function () {
        advanceClock(10);
        let dueDate = initialTimestamp + 2592000 * 13;
        await testTokenContract.connect(borrower).approve(poolContract.address, 20);
        await poolContract
            .connect(borrower)
            .makePayment(borrower.address, testTokenContract.address, 20);
        record = await poolContract.creditRecordMapping(borrower.address);
        checkRecord(record, 5000, 3800, dueDate, 0, 220, 20, 0, 1, 1217, 30, 3);
    });

    it("Day 372: Drawdown blocked due to over limit", async function () {
        advanceClock(2);
        await expect(poolContract.connect(borrower).drawdown(2000)).to.be.revertedWith(
            "EXCEEDED_CREDIT_LMIIT"
        );
    });

    it("Day 375: Additional drawdown within limit allowed", async function () {
        advanceClock(3);
        let dueDate = initialTimestamp + 2592000 * 13;
        await poolContract.connect(borrower).drawdown(1000);
        record = await poolContract.creditRecordMapping(borrower.address);
        checkRecord(record, 5000, 4800, dueDate, -5, 220, 20, 0, 1, 1217, 30, 3);
    });

    it("Day 380: Pay with amountDue", async function () {
        advanceClock(5);
        let dueDate = initialTimestamp + 2592000 * 13;
        await testTokenContract.connect(borrower).approve(poolContract.address, 220);
        await poolContract
            .connect(borrower)
            .makePayment(borrower.address, testTokenContract.address, 220);
        record = await poolContract.creditRecordMapping(borrower.address);
        checkRecord(record, 5000, 4800, dueDate, -4, 0, 0, 0, 1, 1217, 30, 3);
    });

    it("Day 390: Final statement, all principal due", async function () {
        advanceClock(10);
        let r = await feeManagerContract.getDueInfo(record);
        checkResult(r, 1, 92, 4892, 4892, 0);
    });

    it("Day 400: Additional drawdown blocked (credit line matured)", async function () {
        advanceClock(10);
        await expect(poolContract.connect(borrower).drawdown(10)).to.be.revertedWith("EXPIRED");
    });

    it("Day 415: Payoff", async function () {
        let dueDate = initialTimestamp + 2592000 * 14;
        advanceClock(15);
        await testTokenContract.connect(borrower).approve(poolContract.address, 4892);
        await poolContract
            .connect(borrower)
            .makePayment(borrower.address, testTokenContract.address, 4892);
        record = await poolContract.creditRecordMapping(borrower.address);
        checkRecord(record, 0, 0, dueDate, 0, 0, 0, 0, 0, 1217, 30, 3);
    });
});
