/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {use, expect} = require("chai");
const {solidity} = require("ethereum-waffle");
const {deployContracts, deployAndSetupPool, advanceClock} = require("./BaseTest");

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
// 1. Lender contributes 300, together with owner's 100, the pool size is 400
// 2. Factoring fee is 10 flat and 100 bps. Protocol fee is 50 bps.
// 3. Borrower borrows 400. 14 fee charged (2 to treasury, 12 to the pool). Borrower get 386
// 4. Payback 500. The 100 extra will be transferred to the borrower, led to a balance of 486.
// 5. Owner balance becomes 103 with rounding error, lender balance becomes 309 with rounding error.
describe("Invoice Factoring", function () {
    let invoiceContract;
    let poolConfigContract;
    let hdtContract;
    let humaConfigContract;
    // let humaCreditFactoryContract;
    let testTokenContract;
    let invoiceNFTContract;
    let eaNFTContract;
    let feeManagerContract;
    let proxyOwner;
    let owner;
    let lender;
    let borrower;
    let borrower2;
    let treasury;
    let evaluationAgent;
    let invoiceNFTTokenId;
    let eaServiceAccount;
    let pdsServiceAccount;

    before(async function () {
        [
            owner,
            proxyOwner,
            lender,
            borrower,
            treasury,
            evaluationAgent,
            payer,
            eaServiceAccount,
            pdsServiceAccount,
        ] = await ethers.getSigners();

        const HumaConfig = await ethers.getContractFactory("HumaConfig");
        humaConfigContract = await HumaConfig.deploy(treasury.address);
        await humaConfigContract.setHumaTreasury(treasury.address);

        const feeManagerFactory = await ethers.getContractFactory("BaseFeeManager");
        feeManagerContract = await feeManagerFactory.deploy();
        await humaConfigContract.setHumaTreasury(treasury.address);

        await humaConfigContract.setEAServiceAccount(eaServiceAccount.address);
        await humaConfigContract.setPDSServiceAccount(pdsServiceAccount.address);

        const TestToken = await ethers.getContractFactory("TestToken");
        testTokenContract = await TestToken.deploy();

        await feeManagerContract.setFees(10, 100, 20, 100, 0);

        const InvoiceNFT = await ethers.getContractFactory("InvoiceNFT");
        invoiceNFTContract = await InvoiceNFT.deploy(testTokenContract.address);

        const eaNFT = await ethers.getContractFactory("EvaluationAgentNFT");
        eaNFTContract = await eaNFT.deploy();
    });

    beforeEach(async function () {
        const TransparentUpgradeableProxy = await ethers.getContractFactory(
            "TransparentUpgradeableProxy"
        );

        const HDT = await ethers.getContractFactory("HDT");
        const hdtImpl = await HDT.deploy();
        await hdtImpl.deployed();
        const hdtProxy = await TransparentUpgradeableProxy.deploy(
            hdtImpl.address,
            proxyOwner.address,
            []
        );
        await hdtProxy.deployed();
        hdtContract = HDT.attach(hdtProxy.address);
        await hdtContract.initialize("HumaIF HDT", "HHDT", testTokenContract.address);

        const BasePoolConfig = await ethers.getContractFactory("BasePoolConfig");
        poolConfigContract = await BasePoolConfig.deploy(
            "Base Credit Pool",
            hdtContract.address,
            humaConfigContract.address,
            feeManagerContract.address
        );
        await poolConfigContract.deployed();

        const ReceivableFactoringPool = await ethers.getContractFactory("ReceivableFactoringPool");
        const poolImpl = await ReceivableFactoringPool.deploy();
        await poolImpl.deployed();
        const poolProxy = await TransparentUpgradeableProxy.deploy(
            poolImpl.address,
            proxyOwner.address,
            []
        );
        await poolProxy.deployed();

        invoiceContract = ReceivableFactoringPool.attach(poolProxy.address);
        await invoiceContract.initialize(poolConfigContract.address);

        await poolConfigContract.setPool(invoiceContract.address);
        await hdtContract.setPool(invoiceContract.address);

        await testTokenContract.approve(invoiceContract.address, 100);

        await invoiceContract.enablePool();

        await testTokenContract.approve(invoiceContract.address, 100);

        await invoiceContract.connect(owner).addApprovedLender(owner.address);
        await invoiceContract.connect(owner).addApprovedLender(lender.address);

        await invoiceContract.connect(owner).makeInitialDeposit(100);

        expect(await invoiceContract.lastDepositTime(owner.address)).to.not.equal(0);
        expect(await testTokenContract.balanceOf(invoiceContract.address)).to.equal(100);

        const tx = await eaNFTContract.mintNFT(evaluationAgent.address, "");
        const receipt = await tx.wait();
        for (const evt of receipt.events) {
            if (evt.event === "NFTGenerated") {
                eaNFTTokenId = evt.args[0];
            }
        }

        await poolConfigContract.setEvaluationAgent(eaNFTTokenId, evaluationAgent.address);

        await poolConfigContract.connect(owner).setAPR(0); //bps
        await poolConfigContract.setMaxCreditLine(1000);

        await testTokenContract.give1000To(lender.address);
        await testTokenContract.connect(lender).approve(invoiceContract.address, 400);

        let lenderBalance = await testTokenContract.balanceOf(lender.address);
        if (lenderBalance < 1000)
            await testTokenContract.mint(lender.address, 1000 - lenderBalance);

        let borrowerBalance = await testTokenContract.balanceOf(borrower.address);
        if (lenderBalance > 0)
            await testTokenContract.connect(borrower).burn(borrower.address, borrowerBalance);

        await humaConfigContract.setTreasuryFee(2000);

        await poolConfigContract.connect(owner).setPoolOwnerRewardsAndLiquidity(625, 0);
        await poolConfigContract.connect(owner).setEARewardsAndLiquidity(1875, 0);
    });

    describe("Post Approved Invoice Factoring", function () {
        // Makes sure there is liquidity in the pool for borrowing
        beforeEach(async function () {
            await invoiceContract.connect(lender).deposit(300);
            await testTokenContract.connect(borrower).approve(invoiceContract.address, 99999);
        });

        afterEach(async function () {
            await humaConfigContract.connect(owner).unpauseProtocol();
        });

        it("Should only allow evaluation agents to post approved loan requests", async function () {
            await expect(
                invoiceContract
                    .connect(lender)
                    .recordApprovedCredit(
                        borrower.address,
                        400,
                        ethers.constants.AddressZero,
                        0,
                        0,
                        30,
                        1
                    )
            ).to.be.revertedWith("evaluationAgentServiceAccountRequired()");
        });

        it("Should not allow posting approved loans while protocol is paused", async function () {
            await humaConfigContract.connect(owner).pauseProtocol();

            await expect(
                invoiceContract
                    .connect(eaServiceAccount)
                    .recordApprovedCredit(
                        borrower.address,
                        400,
                        ethers.constants.AddressZero,
                        0,
                        0,
                        30,
                        1
                    )
            ).to.be.revertedWith("protocolIsPaused()");
        });

        it("Should not allow posting approved laons while pool is off", async function () {
            await invoiceContract.disablePool();

            await expect(
                invoiceContract
                    .connect(eaServiceAccount)
                    .recordApprovedCredit(
                        borrower.address,
                        400,
                        ethers.constants.AddressZero,
                        0,
                        0,
                        30,
                        1
                    )
            ).to.be.revertedWith("poolIsNotOn()");
        });

        it("Cannot post approved loan with amount greater than limit", async function () {
            await expect(
                invoiceContract
                    .connect(eaServiceAccount)
                    .recordApprovedCredit(
                        borrower.address,
                        9999,
                        ethers.constants.AddressZero,
                        0,
                        0,
                        30,
                        1
                    )
            ).to.be.revertedWith("greaterThanMaxCreditLine()");
        });

        it("Should post approved invoice financing successfully", async function () {
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(0);

            await poolConfigContract.connect(owner).setAPR(0);

            await invoiceContract
                .connect(eaServiceAccount)
                .recordApprovedCredit(
                    borrower.address,
                    400,
                    ethers.constants.AddressZero,
                    0,
                    0,
                    30,
                    1
                );

            const creditInfo = await invoiceContract.getCreditInformation(borrower.address);

            expect(creditInfo.creditLimit).to.equal(400);
            expect(creditInfo.unbilledPrincipal).to.equal(0);
            expect(creditInfo.remainingPeriods).to.equal(1);
        });
    });

    describe("Update Approved Invoice Factoring", function () {
        it("Should allow evaluation agent to change an approved invoice factoring record", async function () {
            await poolConfigContract.connect(owner).setAPR(0);

            await invoiceContract
                .connect(eaServiceAccount)
                .recordApprovedCredit(
                    borrower.address,
                    400,
                    ethers.constants.AddressZero,
                    0,
                    0,
                    30,
                    1
                );

            await expect(
                invoiceContract.connect(payer).changeCreditLine(borrower.address, 0)
            ).to.be.revertedWith("evaluationAgentServiceAccountRequired()");

            await invoiceContract.connect(eaServiceAccount).changeCreditLine(borrower.address, 0);

            //await invoiceContract.printDetailStatus(borrower.address);
            const creditInfo = await invoiceContract.getCreditInformation(borrower.address);

            expect(creditInfo.state).to.equal(0); // Means "Deleted"
        });
    });

    describe("Invoice Factoring Funding", function () {
        // Makes sure there is liquidity in the pool for borrowing
        beforeEach(async function () {
            await invoiceContract.connect(lender).deposit(300);

            // Mint InvoiceNFT to the borrower
            const tx = await invoiceNFTContract.mintNFT(borrower.address, "");
            const receipt = await tx.wait();
            // eslint-disable-next-line no-restricted-syntax
            for (const evt of receipt.events) {
                if (evt.event === "NFTGenerated") {
                    invoiceNFTTokenId = evt.args[0];
                }
            }

            await invoiceNFTContract
                .connect(borrower)
                .approve(invoiceContract.address, invoiceNFTTokenId);

            await invoiceContract
                .connect(eaServiceAccount)
                .recordApprovedCredit(
                    borrower.address,
                    400,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    4000,
                    30,
                    1
                );
        });

        afterEach(async function () {
            await humaConfigContract.connect(owner).unpauseProtocol();
        });

        it("Should not allow loan funding while protocol is paused", async function () {
            await humaConfigContract.connect(owner).pauseProtocol();
            await expect(invoiceContract.connect(borrower).drawdown(400)).to.be.revertedWith(
                "protocolIsPaused()"
            );
        });

        // todo This test throw VM Exception. More investigation needed
        it("Prevent loan funding before approval", async function () {
            // expect(
            //     await invoiceContract.connect(borrower).drawdown()
            // ).to.be.revertedWith("CREDIT_NOT_APPROVED");
        });

        it("Should be able to borrow amount less than approved", async function () {
            await invoiceContract
                .connect(borrower)
                .drawdownWithReceivable(
                    borrower.address,
                    200,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId
                );

            expect(await invoiceNFTContract.ownerOf(invoiceNFTTokenId)).to.equal(
                invoiceContract.address
            );

            expect(await invoiceNFTContract.balanceOf);
            let accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(2);
            expect(await testTokenContract.balanceOf(invoiceContract.address)).to.equal(212);

            const loanInformation = await invoiceContract.getCreditInformation(borrower.address);
            expect(loanInformation.totalDue).to.equal(200);
            expect(loanInformation.intervalInDays).to.equal(30);
            expect(loanInformation.aprInBps).to.equal(0);
            expect(loanInformation.feesAndInterestDue).to.equal(0);
            expect(loanInformation.creditLimit).to.equal(400);
        });

        it("Should be able to borrow the full approved amount", async function () {
            await invoiceContract.connect(eaServiceAccount).approveCredit(borrower.address);
            // expect(await invoiceContract.isApproved()).to.equal(true);

            await invoiceContract
                .connect(borrower)
                .drawdownWithReceivable(
                    borrower.address,
                    400,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId
                );

            expect(await invoiceNFTContract.ownerOf(invoiceNFTTokenId)).to.equal(
                invoiceContract.address
            );

            // principal: 400, fees 14 {flat: 10, bps fee: 4}
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(386);

            let accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(2);
            expect(accruedIncome.poolOwnerIncome).to.equal(0);
            expect(accruedIncome.eaIncome).to.equal(2);

            expect(await testTokenContract.balanceOf(invoiceContract.address)).to.equal(14);

            const loanInformation = await invoiceContract.getCreditInformation(borrower.address);
            expect(loanInformation.totalDue).to.equal(400);
            expect(loanInformation.intervalInDays).to.equal(30);
            expect(loanInformation.aprInBps).to.equal(0);
            expect(loanInformation.feesAndInterestDue).to.equal(0);
            expect(loanInformation.creditLimit).to.equal(400);
        });
    });

    // In "Payback".beforeEach(), make sure there is a loan funded.
    describe("Payback", async function () {
        beforeEach(async function () {
            await feeManagerContract.setFees(10, 100, 20, 100, 0);
            await poolConfigContract.setAPR(0);

            // Mint InvoiceNFT to the borrower
            const tx = await invoiceNFTContract.mintNFT(borrower.address, "");
            const receipt = await tx.wait();
            // eslint-disable-next-line no-restricted-syntax
            for (const evt of receipt.events) {
                if (evt.event === "NFTGenerated") {
                    invoiceNFTTokenId = evt.args[0];
                }
            }
            await invoiceNFTContract
                .connect(borrower)
                .approve(invoiceContract.address, invoiceNFTTokenId);

            await invoiceContract.connect(lender).deposit(300);
            await invoiceContract
                .connect(eaServiceAccount)
                .recordApprovedCredit(
                    borrower.address,
                    400,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    1,
                    30,
                    1
                );

            await invoiceContract
                .connect(borrower)
                .drawdownWithReceivable(
                    borrower.address,
                    400,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId
                );

            await testTokenContract.give1000To(payer.address);
        });

        afterEach(async function () {
            await humaConfigContract.unpauseProtocol();
        });

        it("Should not allow payback while protocol is paused", async function () {
            await humaConfigContract.connect(owner).pauseProtocol();
            await expect(
                invoiceContract
                    .connect(borrower)
                    .makePayment(borrower.address, testTokenContract.address, 5)
            ).to.be.revertedWith("protocolIsPaused()");
        });

        // todo if the pool is stopped, shall we accept payback?

        it("Should reject if non-PDS calls to report payments received", async function () {
            await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600 - 10]);
            await expect(
                invoiceContract
                    .connect(borrower)
                    .onReceivedPayment(borrower.address, testTokenContract.address, 500, 1)
            ).to.be.revertedWith("paymentDetectionServiceAccountRequired()");
        });

        it("Process payback", async function () {
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(386);
            await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600 - 10]);

            // simulates payments from payer.
            await testTokenContract.connect(payer).transfer(invoiceContract.address, 500);

            await invoiceContract
                .connect(pdsServiceAccount)
                .onReceivedPayment(borrower.address, testTokenContract.address, 500, 1);

            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(486);

            let accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(2);
            expect(await testTokenContract.balanceOf(invoiceContract.address)).to.equal(414);

            // test withdraw to make sure the income is allocated properly.
            expect(await hdtContract.balanceOf(lender.address)).to.equal(300);
            expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(307);
            expect(await hdtContract.withdrawableFundsOf(owner.address)).to.equal(102);
        });

        describe("Default flow", async function () {
            it("Writeoff less than pool value", async function () {
                await expect(invoiceContract.triggerDefault(borrower.address)).to.be.revertedWith(
                    "defaultTriggeredTooEarly()"
                );
                // post withdraw
                expect(await hdtContract.withdrawableFundsOf(owner.address)).to.equal(102);
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(307);

                let accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(2);
                expect(accruedIncome.eaIncome).to.equal(2);
                expect(accruedIncome.poolOwnerIncome).to.equal(0);

                await invoiceContract.connect(lender).deposit(100);

                // pay period 1
                advanceClock(30);
                await ethers.provider.send("evm_mine", []);
                await invoiceContract.updateDueInfo(borrower.address, true);

                await expect(invoiceContract.triggerDefault(borrower.address)).to.be.revertedWith(
                    "defaultTriggeredTooEarly()"
                );
                expect(await hdtContract.withdrawableFundsOf(owner.address)).to.equal(105);
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(420);

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(6);
                expect(accruedIncome.eaIncome).to.equal(5);
                expect(accruedIncome.poolOwnerIncome).to.equal(1);

                // pay period 2
                advanceClock(30);
                await invoiceContract.updateDueInfo(borrower.address, true);

                await expect(invoiceContract.triggerDefault(borrower.address)).to.be.revertedWith(
                    "defaultTriggeredTooEarly()"
                );
                expect(await hdtContract.withdrawableFundsOf(owner.address)).to.equal(109);
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(432);

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(10);
                expect(accruedIncome.eaIncome).to.equal(8);
                expect(accruedIncome.poolOwnerIncome).to.equal(2);

                // Pay period 3
                advanceClock(30);

                // Total 3 cycles late, do not charge fees for the final cycle, we got
                // 2 cycles of late fee for 48. Distribution among {protocol, EA, poolOwner, pool}
                // is {9, 7, 2, 30}. Pluge the origination fee {2, 2, 0, 10}. The balance is
                // {11, 9, 2, 40}.
                // The pool value was 531 before the loss. With a loss of 448, pool vlue became
                // 83, {poolOwnerAsLP, lender} split is {18, 73}.
                await expect(
                    invoiceContract.connect(eaServiceAccount).triggerDefault(borrower.address)
                )
                    .to.emit(invoiceContract, "DefaultTriggered")
                    .withArgs(borrower.address, 448, eaServiceAccount.address);

                expect(await hdtContract.withdrawableFundsOf(owner.address)).to.equal(18);
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(75);

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(10);
                expect(accruedIncome.eaIncome).to.equal(8);
                expect(accruedIncome.poolOwnerIncome).to.equal(2);

                expect(await testTokenContract.balanceOf(invoiceContract.address)).to.equal(114);
            });
            it("Writeoff more than pool value", async function () {
                await expect(invoiceContract.triggerDefault(borrower.address)).to.be.revertedWith(
                    "defaultTriggeredTooEarly()"
                );

                advanceClock(60);
                await expect(invoiceContract.triggerDefault(borrower.address)).to.be.revertedWith(
                    "defaultTriggeredTooEarly()"
                );

                advanceClock(60);

                // It was delayed for 4 cycles, we do not charge fees for the final cycle.
                // This gets us 84 total late fees. Please note since updateDueInfo() was not called
                // cycle by cycle, all the 84 will be distrbiuted once, vs. distribute 28 for 3
                // times, this leads to different rounding result.
                await expect(
                    invoiceContract.connect(eaServiceAccount).triggerDefault(borrower.address)
                )
                    .to.emit(invoiceContract, "DefaultTriggered")
                    .withArgs(borrower.address, 472, eaServiceAccount.address);

                expect(await hdtContract.withdrawableFundsOf(owner.address)).to.equal(0);
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(0);

                let accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(16);
                expect(accruedIncome.eaIncome).to.equal(12);
                expect(accruedIncome.poolOwnerIncome).to.equal(3);

                expect(await testTokenContract.balanceOf(invoiceContract.address)).to.equal(14);
            });
        });
    });
});
