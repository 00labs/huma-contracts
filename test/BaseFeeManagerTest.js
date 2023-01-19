/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {expect} = require("chai");
const {
    deployContracts,
    deployAndSetupPool,
    advanceClock,
    checkResult,
    checkArruedIncome,
    toToken,
    evmSnapshot,
    evmRevert,
} = require("./BaseTest");

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
let poolOperator;
let poolOwnerTreasury;

let record;
let recordStatic;

let sId;

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
            0,
            eaNFTContract,
            false,
            poolOperator,
            poolOwnerTreasury
        );

        await poolConfigContract.connect(poolOwner).setWithdrawalLockoutPeriod(90);
        await poolConfigContract.connect(poolOwner).setPoolDefaultGracePeriod(60);
    });

    describe("Admin functions", function () {
        before(async function () {
            sId = await evmSnapshot();
        });

        after(async function () {
            if (sId) {
                const res = await evmRevert(sId);
            }
        });
        describe("setFees()", function () {
            it("Should disallow non-owner to set the fees", async function () {
                await expect(
                    feeManagerContract
                        .connect(treasury)
                        .setFees(toToken(10), 100, toToken(20), 10000, 0)
                ).to.be.revertedWith("Ownable: caller is not the owner"); // open zeppelin default error message
            });

            it("Should set the fees correctly", async function () {
                await feeManagerContract
                    .connect(poolOwner)
                    .setFees(toToken(15), 150, toToken(25), 250, 10);
                var [f1, f2, f3, f4, f5] = await feeManagerContract.getFees();
                expect(f1).to.equal(toToken(15));
                expect(f2).to.equal(150);
                expect(f3).to.equal(toToken(25));
                expect(f4).to.equal(250);
                expect(f5).to.equal(10);
            });

            it("Should allow owner to change the fees again", async function () {
                await feeManagerContract
                    .connect(poolOwner)
                    .setFees(toToken(10), 100, toToken(20), 500, 0);
                var [f1, f2, f3, f4, f5] = await feeManagerContract.getFees();
                expect(f1).to.equal(toToken(10));
                expect(f2).to.equal(100);
                expect(f3).to.equal(toToken(20));
                expect(f4).to.equal(500);
                expect(f5).to.equal(0);
            });
        });

        describe("setMinPrincipalRateInBps()", async function () {
            it("Should disallow non-poolOwner to set min principal rate", async function () {
                await expect(
                    feeManagerContract.connect(treasury).setMinPrincipalRateInBps(6000)
                ).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("Should reject if the rate is too high", async function () {
                await expect(
                    feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(6000)
                ).to.be.revertedWithCustomError(
                    feeManagerContract,
                    "minPrincipalPaymentRateSettingTooHigh"
                );
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
            sId = await evmSnapshot();

            await feeManagerContract
                .connect(poolOwner)
                .setFees(toToken(10), 100, toToken(20), 500, 0);

            await poolContract.connect(borrower).requestCredit(toToken(400), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(400), 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(toToken(400));

            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            let r = await feeManagerContract.getDueInfo(record, recordStatic);
            // Please note drawdown() has distributed the 40 income, thus, the 40 income
            // from the first statement does not appear when call getDueInfo().
            checkResult(r, 0, 4001095, 4001095, toToken(400), 0);
        });

        after(async function () {
            if (sId) {
                const res = await evmRevert(sId);
            }
        });
        describe("1st statement", async function () {
            describe("No late fee", async function () {
                it("IntOnly", async function () {
                    let r = await feeManagerContract.getDueInfo(record, recordStatic);
                    checkResult(r, 0, 4001095, 4001095, toToken(400), 0);
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
                        checkResult(r, 1, 44241171, 44241171, 404001095, 44241171); // late fee = 20 flat + 20 bps
                    });
                });
                describe("Late for 2 periods", async function () {
                    before(async function () {
                        await advanceClock(30);
                    });
                    it("IntOnly", async function () {
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 2, 46895763, 46895763, 448242266, 91136934);
                    });
                });
                describe("Late for 3 periods", async function () {
                    before(async function () {
                        await advanceClock(30);
                    });
                    it("IntOnly", async function () {
                        await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(0);
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 3, 49709637, 49709637, 495138029, 140846571);
                    });
                });
            });
        });
    });

    describe("getDueInfo(), MinPrincipal", async function () {
        before(async function () {
            sId = await evmSnapshot();

            await feeManagerContract
                .connect(poolOwner)
                .setFees(toToken(10), 100, toToken(20), 100, 0);
            await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(500);

            // Create a borrowing record
            await poolContract.connect(borrower).requestCredit(toToken(5000), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(5000), 30, 12, 1217);
            await testTokenContract
                .connect(poolOwner)
                .approve(poolContract.address, toToken(4000));
            await poolContract.connect(borrower).drawdown(toToken(4000));

            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            let r = await feeManagerContract.getDueInfo(record, recordStatic);
            // Please note drawdown() has distributed the 40 income, thus, the 40 income
            // from the first statement does not appear when call getDueInfo().
            checkResult(r, 0, 40010958, 240010958, toToken(3800), 0);
        });

        after(async function () {
            if (sId) {
                const res = await evmRevert(sId);
            }
        });

        describe("1st statement", async function () {
            describe("No late fee", async function () {
                it("WithMinPrincipal", async function () {
                    let r = await feeManagerContract.getDueInfo(record, recordStatic);
                    checkResult(r, 0, 40010958, 240010958, toToken(3800), 0);
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
                        checkResult(r, 1, 100811287, 302811834, 3838010411, 100811287);
                    });
                });
                describe("Late for 2 periods", async function () {
                    before(async function () {
                        await advanceClock(30);
                    });
                    it("WithMinPrincipal", async function () {
                        await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(500);
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 2, 102827789, 309868901, 3933781133, 203639076);
                    });
                });
                describe("Late for 3 periods", async function () {
                    before(async function () {
                        await advanceClock(30);
                    });
                    it("WithMinPrincipal", async function () {
                        await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(500);
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 3, 104884626, 317067127, 4031467533, 308523702);
                    });
                });
            });
        });
    });

    describe("getDueInfo() + membership fee, IntOnly", async function () {
        before(async function () {
            sId = await evmSnapshot();

            await feeManagerContract
                .connect(poolOwner)
                .setFees(toToken(10), 100, toToken(20), 500, toToken(10));
            await poolContract.connect(borrower).requestCredit(toToken(400), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(400), 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(toToken(400));

            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            let r = await feeManagerContract.getDueInfo(record, recordStatic);
            // Please note drawdown() has distributed the 40 income, thus, the 40 income
            // from the first statement does not appear when call getDueInfo().
            checkResult(r, 0, 14001095, 14001095, toToken(400), 0);
        });

        after(async function () {
            if (sId) {
                const res = await evmRevert(sId);
            }
        });
        describe("1st statement", async function () {
            describe("No late fee", async function () {
                it("IntOnly", async function () {
                    let r = await feeManagerContract.getDueInfo(record, recordStatic);
                    checkResult(r, 0, 14001095, 14001095, toToken(400), 0);
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
                        checkResult(r, 1, 54841199, 54841199, 414001095, 54841199); // late fee = 20 flat + 20 bps
                    });
                });
                describe("Late for 2 periods", async function () {
                    before(async function () {
                        await advanceClock(30);
                    });
                    it("IntOnly", async function () {
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 2, 58131821, 58131821, 468842294, 112973020);
                    });
                });
                describe("Late for 3 periods", async function () {
                    before(async function () {
                        await advanceClock(30);
                    });
                    it("IntOnly", async function () {
                        await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(0);
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 3, 61619889, 61619889, 526974115, 174592909);
                    });
                });
            });
        });
    });

    describe("getDueInfo() + membership fee, MinPrincipal", async function () {
        before(async function () {
            sId = await evmSnapshot();

            await feeManagerContract
                .connect(poolOwner)
                .setFees(toToken(10), 100, toToken(20), 100, toToken(10));
            await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(500);

            // Create a borrowing record
            await poolContract.connect(borrower).requestCredit(toToken(5000), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(5000), 30, 12, 1217);
            await testTokenContract
                .connect(poolOwner)
                .approve(poolContract.address, toToken(4000));
            await poolContract.connect(borrower).drawdown(toToken(4000));

            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            let r = await feeManagerContract.getDueInfo(record, recordStatic);
            // Please note drawdown() has distributed the 40 income, thus, the 40 income
            // from the first statement does not appear when call getDueInfo().
            checkResult(r, 0, 50010958, 250010958, toToken(3800), 0);
        });

        after(async function () {
            if (sId) {
                const res = await evmRevert(sId);
            }
        });
        describe("1st statement", async function () {
            describe("No late fee", async function () {
                it("WithMinPrincipal", async function () {
                    let r = await feeManagerContract.getDueInfo(record, recordStatic);
                    checkResult(r, 0, 50010958, 250010958, toToken(3800), 0);
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
                        checkResult(r, 1, 111011314, 313511861, 3847510411, 111011314);
                    });
                });
                describe("Late for 2 periods", async function () {
                    before(async function () {
                        await advanceClock(30);
                    });
                    it("WithMinPrincipal", async function () {
                        await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(500);
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 2, 113231844, 321282957, 3952971159, 224243158);
                    });
                });
                describe("Late for 3 periods", async function () {
                    before(async function () {
                        await advanceClock(30);
                    });
                    it("WithMinPrincipal", async function () {
                        await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(500);
                        let r = await feeManagerContract.getDueInfo(record, recordStatic);
                        checkResult(r, 3, 115496792, 329209497, 4060541411, 339739950);
                    });
                });
            });
        });
    });

    describe("calcLateFee()", async function () {
        before(async function () {
            sId = await evmSnapshot();
        });

        after(async function () {
            if (sId) {
                const res = await evmRevert(sId);
            }
        });

        it("do nothing", async function () {
            const fees = await feeManagerContract.calcLateFee(0, 0, 0);
            expect(fees).to.equal(0);
        });

        it("only flat late fee", async function () {
            await feeManagerContract
                .connect(poolOwner)
                .setFees(toToken(10), 100, toToken(20), 0, 0);

            await poolContract.connect(borrower).requestCredit(toToken(400), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(400), 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(toToken(400));

            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);

            await ethers.provider.send("evm_increaseTime", [3600 * 24 * 30 + 10]);
            await ethers.provider.send("evm_mine", []);

            let r = await feeManagerContract.getDueInfo(record, recordStatic);
            checkResult(r, 1, 24041117, 24041117, 404001095, 24041117);
        });
    });
});
