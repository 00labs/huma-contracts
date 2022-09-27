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

const getInvoiceContractFromAddress = async function (address, signer) {
    return ethers.getContractAt("ReceivableFactoringPool", address, signer);
};

// Let us limit the depth of describe to be 2.
//
// In before() of "Huma Pool", all the key supporting contracts are deployed.
//
// In beforeEach() of "Huma Pool", we deploy a new HumaPool with initial
// liquidity 100 from the owner
//
// The full testing scenario is designed as:
// 1. Lender contributes 300, together with owner's 100, the pool size is 1_000_000
// 2. Factoring fee is 10 flat and 100 bps. Protocol fee is 50 bps.
// 3. Borrower borrows 1_000_000. 14 fee charged (2 to treasury, 12 to the pool). Borrower get 386
// 4. Payback 500. The 100 extra will be transferred to the borrower, led to a balance of 486.
// 5. Owner balance becomes 103 with rounding error, lender balance becomes 309 with rounding error.
describe("Invoice Factoring", function () {
    let poolContract;
    let poolConfigContract;
    let hdtContract;
    let humaConfigContract;
    let feeManagerContract;
    let testTokenContract;
    let proxyOwner;
    let poolOwner;
    let lender;
    let borrower;
    let treasury;
    let evaluationAgent;
    let protocolOwner;
    let eaNFTContract;
    let eaServiceAccount;
    let pdsServiceAccount;
    let r;
    let rs;

    let invoiceNFTContract;
    let invoiceNFTTokenId;
    let dueDate;

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
            payer,
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

        const InvoiceNFT = await ethers.getContractFactory("InvoiceNFT");
        invoiceNFTContract = await InvoiceNFT.deploy(testTokenContract.address);

        const tx = await invoiceNFTContract.mintNFT(borrower.address, "");
        const receipt = await tx.wait();
        for (const evt of receipt.events) {
            if (evt.event === "NFTGenerated") {
                invoiceNFTTokenId = evt.args.tokenId;
            }
        }

        await testTokenContract.give1000To(payer.address);
    });

    beforeEach(async function () {
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
            true
        );

        await poolConfigContract.connect(poolOwner).setWithdrawalLockoutPeriod(90);
        await poolConfigContract.connect(poolOwner).setPoolDefaultGracePeriod(60);
        await feeManagerContract.connect(poolOwner).setFees(1000, 100, 2000, 100, 0);
        await poolConfigContract.connect(poolOwner).setAPR(0);
        await poolConfigContract.connect(poolOwner).setMaxCreditLine(1_000_000);
        await humaConfigContract.connect(protocolOwner).setTreasuryFee(2000);
        await poolConfigContract.connect(poolOwner).setPoolOwnerRewardsAndLiquidity(625, 0);
        await poolConfigContract.connect(poolOwner).setEARewardsAndLiquidity(1875, 0);
    });

    describe("Post Approved Invoice Factoring", function () {
        beforeEach(async function () {
            await testTokenContract.connect(borrower).approve(poolContract.address, 1_000_000);
        });

        afterEach(async function () {
            await humaConfigContract.connect(protocolOwner).unpauseProtocol();
        });

        it("Should only allow evaluation agents to post approved loan requests", async function () {
            await expect(
                poolContract
                    .connect(lender)
                    .recordApprovedCredit(
                        borrower.address,
                        1_000_000,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        1_500_000,
                        30,
                        1
                    )
            ).to.be.revertedWith("evaluationAgentServiceAccountRequired()");
        });

        it("Should not allow posting approved loans while protocol is paused", async function () {
            // 9/26 todo check why needs to connect as poolOwner to pause.
            await humaConfigContract.connect(poolOwner).pauseProtocol();

            await expect(
                poolContract
                    .connect(eaServiceAccount)
                    .recordApprovedCredit(
                        borrower.address,
                        1_000_000,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        1_500_000,
                        30,
                        1
                    )
            ).to.be.revertedWith("protocolIsPaused()");
        });

        it("Should not allow posting approved laons while pool is off", async function () {
            await poolContract.connect(poolOwner).disablePool();

            await expect(
                poolContract
                    .connect(eaServiceAccount)
                    .recordApprovedCredit(
                        borrower.address,
                        1_000_000,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        1_500_000,
                        30,
                        1
                    )
            ).to.be.revertedWith("poolIsNotOn()");
        });

        it("Cannot post approved loan with amount greater than limit", async function () {
            await expect(
                poolContract
                    .connect(eaServiceAccount)
                    .recordApprovedCredit(
                        borrower.address,
                        1_200_000,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        1_500_000,
                        30,
                        1
                    )
            ).to.be.revertedWith("greaterThanMaxCreditLine()");
        });

        it("Should post approved invoice financing successfully", async function () {
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(0);

            await poolConfigContract.connect(poolOwner).setAPR(0);

            await poolContract
                .connect(eaServiceAccount)
                .recordApprovedCredit(
                    borrower.address,
                    1_000_000,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    1_500_000,
                    30,
                    1
                );

            const creditInfo = await poolContract.getCreditInformation(borrower.address);

            expect(creditInfo.creditLimit).to.equal(1_000_000);
            expect(creditInfo.unbilledPrincipal).to.equal(0);
            expect(creditInfo.remainingPeriods).to.equal(1);
        });

        it("Should reject approved invoice with invoice amount lower than the receivable requirement", async function () {
            await poolConfigContract.connect(poolOwner).setReceivableRequiredInBps(12500);

            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(0);

            await expect(
                poolContract
                    .connect(eaServiceAccount)
                    .recordApprovedCredit(
                        borrower.address,
                        1_000_000,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        1_000_000,
                        30,
                        1
                    )
            ).to.be.revertedWith("insufficientReceivableAmount()");
        });

        it("Should approve invoice with amount equals to or high than the receivable requirement", async function () {
            await poolConfigContract.connect(poolOwner).setReceivableRequiredInBps(12500);

            await poolContract
                .connect(eaServiceAccount)
                .recordApprovedCredit(
                    borrower.address,
                    1_000_000,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    1_500_000,
                    30,
                    1
                );

            const creditInfo = await poolContract.getCreditInformation(borrower.address);

            expect(creditInfo.creditLimit).to.equal(1_000_000);
            expect(creditInfo.unbilledPrincipal).to.equal(0);
            expect(creditInfo.remainingPeriods).to.equal(1);
        });
    });

    describe("Update Approved Invoice Factoring", function () {
        beforeEach(async function () {
            await poolContract
                .connect(eaServiceAccount)
                .recordApprovedCredit(
                    borrower.address,
                    1_000_000,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    1_500_000,
                    30,
                    1
                );
        });
        it("Should allow evaluation agent to change an approved invoice factoring record", async function () {
            await expect(
                poolContract.connect(payer).changeCreditLine(borrower.address, 0)
            ).to.be.revertedWith("evaluationAgentServiceAccountRequired()");

            await poolContract.connect(eaServiceAccount).changeCreditLine(borrower.address, 0);

            //await poolContract.printDetailStatus(borrower.address);
            const creditInfo = await poolContract.getCreditInformation(borrower.address);

            expect(creditInfo.creditLimit).to.equal(0); // Means "Deleted"
            expect(creditInfo.state).to.equal(0); // Means "Deleted"
        });
        // todo add a test to show creditInfo.state != Deleted when there is outstanding balance.
    });

    describe("Invoice Factoring Funding", function () {
        beforeEach(async function () {
            // Mint InvoiceNFT to the borrower
            const tx = await invoiceNFTContract.mintNFT(borrower.address, "");
            const receipt = await tx.wait();
            // eslint-disable-next-line no-restricted-syntax
            for (const evt of receipt.events) {
                if (evt.event === "NFTGenerated") {
                    invoiceNFTTokenId = evt.args.tokenId;
                }
            }

            await invoiceNFTContract
                .connect(borrower)
                .approve(poolContract.address, invoiceNFTTokenId);

            await poolContract
                .connect(eaServiceAccount)
                .recordApprovedCredit(
                    borrower.address,
                    1_000_000,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    1_500_0000,
                    30,
                    1
                );
            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(record, recordStatic, 1_000_000, 0, 0, 0, 0, 0, 0, 1, 0, 30, 2, 0);
        });

        afterEach(async function () {
            await humaConfigContract.connect(protocolOwner).unpauseProtocol();
        });

        it("Should not allow loan funding while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pauseProtocol();
            await expect(poolContract.connect(borrower).drawdown(1_000_000)).to.be.revertedWith(
                "protocolIsPaused()"
            );
        });

        it("Shall reject drawdown without receivable", async function () {
            await expect(poolContract.connect(borrower).drawdown(1_000_000)).to.be.revertedWith(
                "receivableAssetMismatch()"
            );
        });

        it("Should be able to borrow amount less than approved", async function () {
            await poolContract
                .connect(borrower)
                .drawdownWithReceivable(
                    borrower.address,
                    200_000,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId
                );

            expect(await invoiceNFTContract.ownerOf(invoiceNFTTokenId)).to.equal(
                poolContract.address
            );

            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);

            dueDate = blockBefore.timestamp + 2592000;

            let accruedIncome = await poolConfigContract.accruedIncome();
            checkArruedIncome(accruedIncome, 600, 450, 150);

            expect(await poolContract.totalPoolValue()).to.equal(5_001_800);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(4_803_000);

            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, 1_000_000, 0, dueDate, 0, 200_000, 0, 0, 0, 0, 30, 3, 0);

            let dueInfo = await feeManagerContract.getDueInfo(r, rs);
            checkResult(dueInfo, 0, 0, 200_000, 0, 0);
        });

        it("Should be able to borrow the full approved amount", async function () {
            await poolContract
                .connect(borrower)
                .drawdownWithReceivable(
                    borrower.address,
                    1_000_000,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId
                );

            expect(await invoiceNFTContract.ownerOf(invoiceNFTTokenId)).to.equal(
                poolContract.address
            );

            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);

            dueDate = blockBefore.timestamp + 2592000;

            let accruedIncome = await poolConfigContract.accruedIncome();
            checkArruedIncome(accruedIncome, 2200, 1650, 550);

            expect(await poolContract.totalPoolValue()).to.equal(5_006_600);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(4_011_000);

            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, 1_000_000, 0, dueDate, 0, 1_000_000, 0, 0, 0, 0, 30, 3, 0);

            let dueInfo = await feeManagerContract.getDueInfo(r, rs);
            checkResult(dueInfo, 0, 0, 1_000_000, 0, 0);
        });
    });

    // In "Payback".beforeEach(), make sure there is a loan funded.
    describe("Payback", async function () {
        beforeEach(async function () {
            await feeManagerContract.connect(poolOwner).setFees(1000, 100, 2000, 100, 0);
            await poolConfigContract.connect(poolOwner).setAPR(0);

            // Mint InvoiceNFT to the borrower
            const tx = await invoiceNFTContract.mintNFT(borrower.address, "");
            const receipt = await tx.wait();
            // eslint-disable-next-line no-restricted-syntax
            for (const evt of receipt.events) {
                if (evt.event === "NFTGenerated") {
                    invoiceNFTTokenId = evt.args.tokenId;
                }
            }
            await invoiceNFTContract
                .connect(borrower)
                .approve(poolContract.address, invoiceNFTTokenId);

            await poolContract
                .connect(eaServiceAccount)
                .recordApprovedCredit(
                    borrower.address,
                    1_000_000,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    1_500_000,
                    30,
                    1
                );

            await poolContract
                .connect(borrower)
                .drawdownWithReceivable(
                    borrower.address,
                    1_000_000,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId
                );
            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);

            dueDate = blockBefore.timestamp + 2592000;
        });

        afterEach(async function () {
            await humaConfigContract.connect(protocolOwner).unpauseProtocol();
        });

        it("Should not allow payback while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pauseProtocol();

            await expect(
                poolContract
                    .connect(borrower)
                    .makePayment(borrower.address, testTokenContract.address, 5)
            ).to.be.revertedWith("protocolIsPaused()");
        });

        // todo if the pool is stopped, shall we accept payback?
        it("Should reject payback when pool is off", async function () {
            await poolContract.connect(poolOwner).disablePool();

            await expect(
                poolContract
                    .connect(pdsServiceAccount)
                    .onReceivedPayment(borrower.address, testTokenContract.address, 1_500_000, 1)
            ).to.be.revertedWith("poolIsNotOn()");
        });

        it("Should reject if non-PDS calls to report payments received", async function () {
            await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600 - 10]);
            await expect(
                poolContract
                    .connect(borrower)
                    .onReceivedPayment(borrower.address, testTokenContract.address, 1_500_000, 1)
            ).to.be.revertedWith("paymentDetectionServiceAccountRequired()");
        });

        it("Process payback", async function () {
            let borrowerBalance = await testTokenContract.balanceOf(borrower.address);
            await testTokenContract.burn(borrower.address, borrowerBalance - 890000);
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(890000);
            await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600 - 10]);

            // simulates payments from payer.
            await testTokenContract.connect(payer).transfer(poolContract.address, 1_500_000);

            await poolContract
                .connect(pdsServiceAccount)
                .onReceivedPayment(borrower.address, testTokenContract.address, 1_500_000, 1);

            await expect(
                poolContract
                    .connect(pdsServiceAccount)
                    .onReceivedPayment(borrower.address, testTokenContract.address, 1_500_000, 1)
            ).to.be.revertedWith("paymentAlreadyProcessed()");

            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(1_390_000);

            let accruedIncome = await poolConfigContract.accruedIncome();
            checkArruedIncome(accruedIncome, 2200, 1650, 550);

            expect(await poolContract.totalPoolValue()).to.equal(5_006_600);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(5_011_000);

            expect(await hdtContract.withdrawableFundsOf(poolOwner.address)).to.equal(1_001_320);
            // todo check why this is 2_000_000
            // expect(await hdtContract.balanceOf(lender.address)).to.equal(2_002_640);
            expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                2_002_640
            );

            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, 1_000_000, 0, dueDate, 0, 0, 0, 0, 0, 0, 30, 0, 0);

            let dueInfo = await feeManagerContract.getDueInfo(r, rs);
            checkResult(dueInfo, 0, 0, 0, 0, 0);
        });

        describe("Default flow", async function () {
            it("Writeoff less than pool value", async function () {
                await expect(poolContract.triggerDefault(borrower.address)).to.be.revertedWith(
                    "defaultTriggeredTooEarly()"
                );
                // post withdraw
                expect(await hdtContract.withdrawableFundsOf(poolOwner.address)).to.equal(
                    1_001_320
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(2_002_640);

                let accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(2200);
                expect(accruedIncome.eaIncome).to.equal(1650);
                expect(accruedIncome.poolOwnerIncome).to.equal(550);

                // pay period 1
                advanceClock(30);
                await ethers.provider.send("evm_mine", []);
                await poolContract.refreshAccount(borrower.address);

                await expect(poolContract.triggerDefault(borrower.address)).to.be.revertedWith(
                    "defaultTriggeredTooEarly()"
                );
                expect(await hdtContract.withdrawableFundsOf(poolOwner.address)).to.equal(
                    1_002_760
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(2_005_520);

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(4600);
                expect(accruedIncome.eaIncome).to.equal(3450);
                expect(accruedIncome.poolOwnerIncome).to.equal(1150);

                // pay period 2
                advanceClock(30);
                await poolContract.refreshAccount(borrower.address);

                await expect(poolContract.triggerDefault(borrower.address)).to.be.revertedWith(
                    "defaultTriggeredTooEarly()"
                );
                expect(await hdtContract.withdrawableFundsOf(poolOwner.address)).to.equal(
                    1_004_214
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(2_008_428);

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(7024);
                expect(accruedIncome.eaIncome).to.equal(5268);
                expect(accruedIncome.poolOwnerIncome).to.equal(1756);

                // Pay period 3
                advanceClock(30);

                // Total 3 cycles late, do not charge fees for the final cycle, we got
                // 2 cycles of late fee for 48. Distribution among {protocol, EA, poolOwner, pool}
                // is {9, 7, 2, 30}. Pluge the origination fee {2, 2, 0, 10}. The balance is
                // {11, 9, 2, 40}.
                // The pool value was 531 before the loss. With a loss of 448, pool vlue became
                // 83, {poolOwnerAsLP, lender} split is {18, 73}.
                await expect(
                    poolContract.connect(eaServiceAccount).triggerDefault(borrower.address)
                )
                    .to.emit(poolContract, "DefaultTriggered")
                    .withArgs(borrower.address, 1_024_120, eaServiceAccount.address);

                expect(await hdtContract.withdrawableFundsOf(poolOwner.address)).to.equal(799_390);
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(1_598_780);

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(7024);
                expect(accruedIncome.eaIncome).to.equal(5268);
                expect(accruedIncome.poolOwnerIncome).to.equal(1756);

                expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                    4_011_000
                );
            });

            // todo Add test case for multi payments.

            // it("Writeoff more than pool value", async function () {
            //     await expect(poolContract.triggerDefault(borrower.address)).to.be.revertedWith(
            //         "defaultTriggeredTooEarly()"
            //     );

            //     advanceClock(60);
            //     await expect(poolContract.triggerDefault(borrower.address)).to.be.revertedWith(
            //         "defaultTriggeredTooEarly()"
            //     );

            //     advanceClock(60);

            //     // It was delayed for 4 cycles, we do not charge fees for the final cycle.
            //     // This gets us 84 total late fees. Please note since updateDueInfo() was not called
            //     // cycle by cycle, all the 84 will be distrbiuted once, vs. distribute 28 for 3
            //     // times, this leads to different rounding result.
            //     await expect(
            //         poolContract.connect(eaServiceAccount).triggerDefault(borrower.address)
            //     )
            //         .to.emit(poolContract, "DefaultTriggered")
            //         .withArgs(borrower.address, 472, eaServiceAccount.address);

            //     expect(await hdtContract.withdrawableFundsOf(poolOwner.address)).to.equal(0);
            //     expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(0);

            //     let accruedIncome = await poolConfigContract.accruedIncome();
            //     expect(accruedIncome.protocolIncome).to.equal(16);
            //     expect(accruedIncome.eaIncome).to.equal(12);
            //     expect(accruedIncome.poolOwnerIncome).to.equal(3);

            //     expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(14);
            // });
        });
    });
});
