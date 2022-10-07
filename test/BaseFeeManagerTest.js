/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {use, expect} = require("chai");
const {solidity} = require("ethereum-waffle");
const {
    deployContracts,
    deployAndSetupPool,
    advanceClock,
    checkRecord,
    checkResult,
    checkArruedIncome,
} = require("./BaseTest");

use(solidity);

let eaNFTContract;
let poolContract;
let poolConfigContract;
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
let eaServiceAccount;
let pdsServiceAccount;

let record;
let recordStatic;

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
            eaServiceAccount,
            pdsServiceAccount,
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
            0,
            eaNFTContract,
            false
        );

        await poolConfigContract.connect(poolOwner).setWithdrawalLockoutPeriod(90);
        await poolConfigContract.connect(poolOwner).setPoolDefaultGracePeriod(60);
    });

    describe("Admin functions", function () {
        describe("setFees()", function () {
            it("Should disallow non-owner to set the fees", async function () {
                await expect(
                    feeManagerContract.connect(treasury).setFees(10, 100, 20, 10000, 0)
                ).to.be.revertedWith("caller is not the owner"); // open zeppelin default error message
            });

            it("Should set the fees correctly", async function () {
                await feeManagerContract.connect(poolOwner).setFees(15, 150, 25, 250, 10);
                var [f1, f2, f3, f4, f5] = await feeManagerContract.getFees();
                expect(f1).to.equal(15);
                expect(f2).to.equal(150);
                expect(f3).to.equal(25);
                expect(f4).to.equal(250);
                expect(f5).to.equal(10);
            });

            it("Should allow owner to change the fees again", async function () {
                await feeManagerContract.connect(poolOwner).setFees(10, 100, 20, 500, 0);
                var [f1, f2, f3, f4, f5] = await feeManagerContract.getFees();
                expect(f1).to.equal(10);
                expect(f2).to.equal(100);
                expect(f3).to.equal(20);
                expect(f4).to.equal(500);
                expect(f5).to.equal(0);
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
                ).to.be.revertedWith("minPrincipalPaymentRateSettingTooHigh()");
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
            [hdtContract, poolConfigContract, poolContract] = await deployAndSetupPool(
                poolOwner,
                proxyOwner,
                evaluationAgent,
                lender,
                humaConfigContract,
                feeManagerContract,
                testTokenContract,
                0,
                eaNFTContract,
                false
            );

            await poolContract.connect(borrower).requestCredit(400, 30 * 86400, 12);
            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);
            await testTokenContract.connect(lender).approve(poolContract.address, 300);
            await poolContract.connect(borrower).drawdown(borrower.address, 400);

            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            let r = await feeManagerContract.getDueInfo(record, recordStatic);
            // Please note drawdown() has distributed the 40 income, thus, the 40 income
            // from the first statement does not appear when call getDueInfo().
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
                false
            );

            await feeManagerContract.connect(poolOwner).setFees(10, 100, 20, 100, 0);
            await poolConfigContract.connect(poolOwner).setAPR(1217);
            await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(500);

            // Create a borrowing record
            await poolContract.connect(borrower).requestCredit(5000, 30 * 86400, 12);
            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);
            await testTokenContract.connect(poolOwner).approve(poolContract.address, 4000);
            await poolContract.connect(borrower).drawdown(borrower.address, 4000);

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

    describe("getDueInfo() + membership fee, IntOnly", async function () {
        before(async function () {
            [hdtContract, poolConfigContract, poolContract] = await deployAndSetupPool(
                poolOwner,
                proxyOwner,
                evaluationAgent,
                lender,
                humaConfigContract,
                feeManagerContract,
                testTokenContract,
                0,
                eaNFTContract,
                false
            );

            await feeManagerContract.connect(poolOwner).setFees(10, 100, 20, 500, 10);
            await poolContract.connect(borrower).requestCredit(400, 30 * 86400, 12);
            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);
            await testTokenContract.connect(lender).approve(poolContract.address, 300);
            await poolContract.connect(borrower).drawdown(borrower.address, 400);

            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            let r = await feeManagerContract.getDueInfo(record, recordStatic);
            // Please note drawdown() has distributed the 40 income, thus, the 40 income
            // from the first statement does not appear when call getDueInfo().
            checkResult(r, 0, 14, 14, 400, 0);

            await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(0);
        });
        describe("1st statement", async function () {
            describe("No late fee", async function () {
                it("IntOnly", async function () {
                    let r = await feeManagerContract.getDueInfo(record, recordStatic);
                    checkResult(r, 0, 14, 14, 400, 0);
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
                        checkResult(r, 1, 54, 54, 414, 54); // late fee = 20 flat + 20 bps
                    });
                });
                describe("Late for 2 periods", async function () {
                    before(async function () {
                        advanceClock(30);
                    });
                    it("IntOnly", async function () {
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 2, 57, 57, 468, 111);
                    });
                });
                describe("Late for 3 periods", async function () {
                    before(async function () {
                        advanceClock(30);
                    });
                    it("IntOnly", async function () {
                        await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(0);
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 3, 61, 61, 525, 172);
                    });
                });
            });
        });
    });

    describe("getDueInfo() + membership fee, MinPrincipal", async function () {
        before(async function () {
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
                false
            );

            await feeManagerContract.connect(poolOwner).setFees(10, 100, 20, 100, 10);
            await poolConfigContract.connect(poolOwner).setAPR(1217);
            await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(500);

            // Create a borrowing record
            await poolContract.connect(borrower).requestCredit(5000, 30 * 86400, 12);
            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);
            await testTokenContract.connect(poolOwner).approve(poolContract.address, 4000);
            await poolContract.connect(borrower).drawdown(borrower.address, 4000);

            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            let r = await feeManagerContract.getDueInfo(record, recordStatic);
            // Please note drawdown() has distributed the 40 income, thus, the 40 income
            // from the first statement does not appear when call getDueInfo().
            checkResult(r, 0, 50, 250, 3800, 0);
        });
        describe("1st statement", async function () {
            describe("No late fee", async function () {
                it("WithMinPrincipal", async function () {
                    let r = await feeManagerContract.getDueInfo(record, recordStatic);
                    checkResult(r, 0, 50, 250, 3800, 0);
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
                        checkResult(r, 1, 110, 312, 3848, 110);
                    });
                });
                describe("Late for 2 periods", async function () {
                    before(async function () {
                        advanceClock(30);
                    });
                    it("WithMinPrincipal", async function () {
                        await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(500);
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 2, 112, 320, 3952, 222);
                    });
                });
                describe("Late for 3 periods", async function () {
                    before(async function () {
                        advanceClock(30);
                    });
                    it("WithMinPrincipal", async function () {
                        await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(500);
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 3, 114, 327, 4059, 336);
                    });
                });
            });
        });
    });
});
