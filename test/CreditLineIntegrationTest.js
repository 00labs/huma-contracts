/* eslint-disable no-underscore-dangle */
const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

use(solidity);

let poolContract;
let humaConfigContract;
let testToken;
let feeManager;
let owner;
let lender;
let borrower;
let treasury;
let evaluationAgent;
let record;
let initialTimestamp;

let checkRecord = function(r, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
  if (v1 != "SKIP") expect(r.creditLimit).to.equal(v1);
  if (v2 != "SKIP") expect(r.unbilledPrincipal).to.equal(v2);
  if (v3 != "SKIP") expect(r.dueDate).to.be.within(v3 - 60, v3 + 60);
  if (v4 != "SKIP") expect(r.correction).to.equal(v4);
  if (v5 != "SKIP") expect(r.totalDue).to.equal(v5);
  if (v6 != "SKIP") expect(r.missedPeriods).to.equal(v6);
  if (v7 != "SKIP") expect(r.missedPeriods).to.equal(v7);
  if (v8 != "SKIP") expect(r.remainingPeriods).to.equal(v8);
  if (v9 != "SKIP") expect(r.aprInBps).to.equal(v9);
  if (v10 != "SKIP") expect(r.intervalInDays).to.equal(v10);
  if (v11 != "SKIP") expect(r.state).to.equal(v11);
};

let checkResult = function(r, v1, v2, v3, v4) {
  expect(r.periodsPassed).to.equal(v1);
  expect(r.feesAndInterestDue).to.equal(v2);
  expect(r.totalDue).to.equal(v3);
  expect(r.payoffAmount).to.equal(v4);
};

let advanceClock = async function(days) {
  await ethers.provider.send("evm_increaseTime", [3600 * 24 * days]);
  await ethers.provider.send("evm_mine", []);
};

async function deployContracts() {
  // Deploy HumaConfig
  const HumaConfig = await ethers.getContractFactory("HumaConfig");
  humaConfigContract = await HumaConfig.deploy(treasury.address);
  await humaConfigContract.setHumaTreasury(treasury.address);

  // Deploy Fee Manager
  const feeManagerFactory = await ethers.getContractFactory("BaseFeeManager");
  feeManager = await feeManagerFactory.deploy();

  // Deploy TestToken, give initial tokens to lender
  const TestToken = await ethers.getContractFactory("TestToken");
  testToken = await TestToken.deploy();
  await testToken.give1000To(lender.address);
  await testToken.give1000To(owner.address);
}

async function deployAndSetupPool(principalRateInBps) {
  await feeManager.connect(owner).setFees(10, 100, 20, 500);
  await feeManager.connect(owner).setMinPrincipalRateInBps(principalRateInBps);

  // Deploy BaseCreditPool
  const BaseCreditPool = await ethers.getContractFactory("BaseCreditPool");
  poolContract = await BaseCreditPool.deploy(
    testToken.address,
    humaConfigContract.address,
    feeManager.address,
    "Base Credit Pool",
    "Base HDT",
    "BHDT"
  );
  await poolContract.deployed();

  // Pool setup
  await testToken.connect(owner).approve(poolContract.address, 100);
  await poolContract.connect(owner).makeInitialDeposit(100);
  await poolContract.enablePool();
  await poolContract.connect(owner).setAPR(1217);
  await poolContract.setMinMaxBorrowAmount(10, 10000);
  await poolContract.addEvaluationAgent(evaluationAgent.address);
  await testToken.connect(lender).approve(poolContract.address, 10000);
  await poolContract.connect(lender).deposit(10000);
}

describe("Credit Line Integration Test", async function() {
  before(async function() {
    [owner, lender, borrower, treasury, evaluationAgent] = await ethers.getSigners();

    await deployContracts();

    await deployAndSetupPool(500);
  });

  it("Day 0: Initial drawdown", async function() {
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

    await testToken.connect(owner).approve(poolContract.address, 2000);
    await poolContract.connect(borrower).drawdown(2000);
    record = await poolContract.creditRecordMapping(borrower.address);
    checkRecord(record, 5000, 2000, initialTimestamp + 2592000, 0, 0, 0, 0, 12, 1217, 30, 3);

    let r = await feeManager.getDueInfo(record);
    checkResult(r, 0, 0, 0, 2020);

    // Advance to the next billing cycle
    advanceClock(15);
  });

  it("Day 15: Second drawdown (to test offset)", async function() {
    await testToken.connect(owner).approve(poolContract.address, 2000);
    await poolContract.connect(borrower).drawdown(2000);
    record = await poolContract.creditRecordMapping(borrower.address);
    checkRecord(record, 5000, 4000, initialTimestamp + 2592000, -10, 0, 0, 0, 12, 1217, 30, 3);

    let r = await feeManager.getDueInfo(record);
    checkResult(r, 0, 0, 0, 4030);

    // Advance to the next billing cycle
    advanceClock(30);
  });

  it("Day 30: 1st statement", async function() {
    let r = await feeManager.getDueInfo(record);
    checkResult(r, 1, 30, 230, 4070);
  });

  it("Day 45: 1st statement", async function() {
    let r = await feeManager.getDueInfo(record);
    checkResult(r, 1, 30, 230, 4070);
  });
});
