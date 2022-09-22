/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {use, expect} = require("chai");
const {solidity} = require("ethereum-waffle");
const {deployContracts, deployAndSetupPool, advanceClock} = require("./BaseTest");

use(solidity);

let eaNFTContract;
let poolContract;
let hdtContract;
let humaConfigContract;
let feeManagerContract;
let testTokenContract;
let proxyOwner;
let lender;
let borrower;
let treasury;
let evaluationAgent;
let protocolOwner;

let record;
let recordStatic;

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

let checkResult = function (r, v1, v2, v3, v4, v5) {
    expect(r.periodsPassed).to.equal(v1);
    expect(r.feesAndInterestDue).to.equal(v2);
    expect(r.totalDue).to.equal(v3);
    expect(r.unbilledPrincipal).to.equal(v4);
    expect(r.totalCharges).to.equal(v5);
};

describe("Base Fee Manager", function () {
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
            0,
            eaNFTContract
        );

        await poolContract.connect(poolOwner).setWithdrawalLockoutPeriod(90);
        await poolContract.connect(poolOwner).setPoolDefaultGracePeriod(60);
    });

    describe("Admin functions", function () {
        // todo Verify only pool admins can deployNewPool
        describe("setFees()", function () {
            it("Should disallow non-owner to set the fees", async function () {
                await expect(
                    feeManagerContract.connect(treasury).setFees(10, 100, 20, 10000)
                ).to.be.revertedWith("caller is not the owner"); // open zeppelin default error message
            });

            it("Should set the fees correctly", async function () {
                await feeManagerContract.connect(poolOwner).setFees(15, 150, 25, 250);
                var [f1, f2, f3, f4] = await feeManagerContract.getFees();
                expect(f1).to.equal(15);
                expect(f2).to.equal(150);
                expect(f3).to.equal(25);
                expect(f4).to.equal(250);
            });

            it("Should allow owner to change the fees", async function () {
                await feeManagerContract.connect(poolOwner).setFees(10, 100, 20, 500);
                var [f1, f2, f3, f4] = await feeManagerContract.getFees();
                expect(f1).to.equal(10);
                expect(f2).to.equal(100);
                expect(f3).to.equal(20);
                expect(f4).to.equal(500);
            });
        });

        describe("setMinPrincipalRateInBps()", async function () {
            it("Should disallow non-poolOwner to set min principal rate", async function () {
                await expect(
                    feeManagerContract.connect(treasury).setMinPrincipalRateInBps(6000)
                ).to.be.revertedWith("caller is not the owner");
            });

            it("Should reject if the rate is too high", async function () {
                await expect(
                    feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(6000)
                ).to.be.revertedWith("RATE_TOO_HIGH");
            });

            it("Should be able to set min principal payment rate", async function () {
                await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(500);
                expect(
                    await feeManagerContract.connect(poolOwner).minPrincipalRateInBps()
                ).to.equal(500);
            });
        });
    });

    describe("getDueInfo(), IntOnly", async function () {
        before(async function () {
            [hdtContract, poolContract] = await deployAndSetupPool(
                poolOwner,
                proxyOwner,
                evaluationAgent,
                lender,
                humaConfigContract,
                feeManagerContract,
                testTokenContract,
                0,
                eaNFTContract
            );

            await poolContract.connect(borrower).requestCredit(400, 30, 12);
            await poolContract.connect(evaluationAgent).approveCredit(borrower.address);
            await testTokenContract.connect(lender).approve(poolContract.address, 300);
            await poolContract.connect(borrower).drawdown(400);

            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            let r = await feeManagerContract.getDueInfo(record, recordStatic);
            checkResult(r, 0, 4, 4, 400, 0);

            await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(0);
        });
        describe("1st statement", async function () {
            describe("No late fee", async function () {
                it("IntOnly", async function () {
                    let r = await feeManagerContract.getDueInfo(record, recordStatic);
                    checkResult(r, 0, 4, 4, 400, 0);
                });
            });
            describe("Late fee scenarios", async function () {
                describe("Late for 1 period", async function () {
                    before(async function () {
                        await ethers.provider.send("evm_increaseTime", [3600 * 24 * 30 + 10]);
                        await ethers.provider.send("evm_mine", []);
                    });
                    it("IntOnly", async function () {
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 1, 44, 44, 404, 44); // late fee = 20 flat + 20 bps
                    });
                });
                describe("Late for 2 periods", async function () {
                    before(async function () {
                        advanceClock(30);
                    });
                    it("IntOnly", async function () {
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 2, 46, 46, 448, 90);
                    });
                });
                describe("Late for 3 periods", async function () {
                    before(async function () {
                        advanceClock(30);
                    });
                    it("IntOnly", async function () {
                        await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(0);
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 3, 48, 48, 494, 138);
                    });
                });
            });
        });
    });

    describe("getDueInfo(), MinPrincipal", async function () {
        before(async function () {
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

            await feeManagerContract.connect(poolOwner).setFees(10, 100, 20, 100);
            await poolContract.connect(poolOwner).setAPR(1217);
            await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(500);

            // Create a borrowing record
            await poolContract.connect(borrower).requestCredit(5000, 30, 12);
            await poolContract.connect(evaluationAgent).approveCredit(borrower.address);
            await testTokenContract.connect(poolOwner).approve(poolContract.address, 4000);
            await poolContract.connect(borrower).drawdown(4000);

            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            let r = await feeManagerContract.getDueInfo(record, recordStatic);
            // Please note drawdown() has distributed the 40 income, thus, the 40 income
            // from the first statement does not appear when call getDueInfo().
            checkResult(r, 0, 40, 240, 3800, 0);
        });
        describe("1st statement", async function () {
            describe("No late fee", async function () {
                it("WithMinPrincipal", async function () {
                    let r = await feeManagerContract.getDueInfo(record, recordStatic);
                    checkResult(r, 0, 40, 240, 3800, 0);
                });
            });
            describe("Late fee scenarios", async function () {
                describe("Late for 1 period", async function () {
                    before(async function () {
                        await ethers.provider.send("evm_increaseTime", [3600 * 24 * 30 + 10]);
                        await ethers.provider.send("evm_mine", []);
                    });
                    it("WithMinPrincipal", async function () {
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 1, 100, 302, 3838, 100);
                    });
                });
                describe("Late for 2 periods", async function () {
                    before(async function () {
                        advanceClock(30);
                    });
                    it("WithMinPrincipal", async function () {
                        await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(500);
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 2, 102, 309, 3933, 202);
                    });
                });
                describe("Late for 3 periods", async function () {
                    before(async function () {
                        advanceClock(30);
                    });
                    it("WithMinPrincipal", async function () {
                        await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(500);
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 3, 104, 316, 4030, 306);
                    });
                });
            });
        });
    });
});
