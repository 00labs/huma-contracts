/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {use, expect} = require("chai");
const {solidity} = require("ethereum-waffle");
const {deployContracts, deployAndSetupPool} = require("./BaseTest");

use(solidity);

const getLoanContractFromAddress = async function (address, signer) {
    return ethers.getContractAt("HumaLoan", address, signer);
};

// Let us limit the depth of describe to be 2.
//
// In before() of "Huma Pool", all the key supporting contracts are deployed.
//
// In beforeEach() of "Huma Pool", we deploy a new HumaPool with initial
// liquidity 100 from the owner
//
// The full testing scenario is designed as:
// m0-1: Owner contributes 100 initial liquidity
// m0-2: Set up fees=(10, 100, 20, 100, 30, 100), APR=1217, protocol fee=50.
// m0-3: Lender contributes 300, together with owner's 100, the pool size is 400. PPS=1
// m0-4. Borrower borrows 400 with interest-only. 14 fee charged (12 pool fee, 2 protocol fee). Borrower get 386
//       PPS=1.03, withdrawable(owner, lender)=(103,309)
// m1.   Borrower makes a regular payment of 4 interest fee
//       PPS=1.04, withdrawable(owner, lender)=(104,312)
// m2.   Borrower was late to make the payment, gets charged 24 late fee, plus 4 interest, total fee 28
//       PPS=1.11, withdrawable(owner, lender)=(111,333)
// m3-1. Borrower pays makes a regular payment of 4 interest fee
//       PPS=1.12, withdrawable(owner, lender)=(112,336)
// m3-2. Owner deposits another 200
//       FDT(owner, lender)=(300, 300)
//       PPS=1.12, correction(owner, lender)=(-24,0), withdrawable(owner, lender)=(312,336)
// m3-2. Lender withdraws 224, which is 200 * PPS
//       FDT(owner, lender)=(300, 100), pool liquidity is 24
//       PPS=1.12, correction(owner, lender)=(-24,0, 224), withdrawable(owner, lender)=(312,112)
// m3-3. Borrower pays makes a regular payment of 4 interest fee
//       PPS=1.12, withdrawable(owner, lender)=(312,112)
// m4.   Borrower pays off with a fee of 38 (early payoff penalty 34, interest 4), total 438 incl. principal
//       PPS=1.215, correction(owner, lender)=(-24,0, 224),withdrawable(owner, lender)=(340.5,121.5)
// m5.   Lender withdraw 121.5, pool liquidity is now 340.5
//       PPS=1.215, correction(owner, lender)=(-24,0, 345.5),withdrawable(owner, lender)=(340.5,0)
//
// Numbers in Google Sheet: more detail: (shorturl.at/dfqrT)
//
describe("Base Credit Pool", function () {
    let humaPoolFactoryContract;
    let poolContract;
    let hdtContract;
    let humaConfigContract;
    let feeManagerContract;
    let humaCreditFactoryContract;
    let testTokenContract;
    let proxyOwner;
    let defaultDeployer;
    let lender;
    let borrower;
    let borrower2;
    let borrower3;
    let treasury;
    let evaluationAgent;
    let poolOwner;

    before(async function () {
        [
            defaultDeployer,
            proxyOwner,
            lender,
            borrower,
            borrower2,
            borrower3,
            treasury,
            evaluationAgent,
            poolOwner,
        ] = await ethers.getSigners();

        [humaConfigContract, feeManagerContract, testTokenContract] = await deployContracts(
            poolOwner,
            treasury,
            lender,
            [10, 100, 20, 100]
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

    afterEach(async function () {});

    describe("BaseCreditPool settings", function () {
        beforeEach(async function () {
            await poolContract.connect(borrower).requestCredit(400, 30, 12);
        });

        afterEach(async function () {
            await poolContract.connect(evaluationAgent).invalidateApprovedCredit(borrower.address);
        });

        it("Should not allow credit line to be changed when protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pauseProtocol();
            await expect(
                poolContract.connect(evaluationAgent).changeCreditLine(borrower.address, 500)
            ).to.be.revertedWith("PROTOCOL_PAUSED");
            await humaConfigContract.connect(poolOwner).unpauseProtocol();
        });
        it("Should not allow non-EA to change credit line", async function () {
            await expect(
                poolContract.connect(borrower).changeCreditLine(borrower.address, 500)
            ).to.be.revertedWith("APPROVER_REQUIRED");
        });
        it("Should not allow credit line to be changed to above maximal credit line", async function () {
            await expect(
                poolContract.connect(evaluationAgent).changeCreditLine(borrower.address, 50000)
            ).to.be.revertedWith("GREATER_THAN_LIMIT");
        });
        it("Should allow credit limit to be changed", async function () {
            await poolContract.connect(evaluationAgent).changeCreditLine(borrower.address, 1000);
            let result = await poolContract.creditRecordMapping(borrower.address);
            expect(result.creditLimit).to.equal(1000);
        });
    });

    describe("Defaulting resolver", function () {
        let resolverContract;

        beforeEach(async function () {
            await poolContract.connect(borrower).requestCredit(400, 30, 12);
            await poolContract.connect(borrower2).requestCredit(400, 30, 12);
            await poolContract.connect(borrower3).requestCredit(400, 30, 12);

            await poolContract.connect(evaluationAgent).approveCredit(borrower.address);
            await poolContract.connect(evaluationAgent).approveCredit(borrower2.address);
            await poolContract.connect(evaluationAgent).approveCredit(borrower3.address);

            await poolContract.connect(borrower).drawdown(10);
            await poolContract.connect(borrower2).drawdown(10);
            await poolContract.connect(borrower3).drawdown(10);

            const BaseCreditPoolDefaultingResolver = await ethers.getContractFactory(
                "BaseCreditPoolDefaultingResolver"
            );
            resolverContract = await BaseCreditPoolDefaultingResolver.deploy();
            await resolverContract.push(poolContract.address);
        });

        afterEach(async function () {
            await poolContract.connect(evaluationAgent).invalidateApprovedCredit(borrower.address);
            await poolContract
                .connect(evaluationAgent)
                .invalidateApprovedCredit(borrower2.address);
            await poolContract
                .connect(evaluationAgent)
                .invalidateApprovedCredit(borrower3.address);
        });

        it("creditLines is correctly ordered", async function () {
            let creditLines = await poolContract.creditLines();
            expect(creditLines.length).to.equal(3);
            expect(creditLines[0]).to.equal(borrower.address);
            expect(creditLines[1]).to.equal(borrower2.address);
            expect(creditLines[2]).to.equal(borrower3.address);

            // Invalidate borrower's credit
            await poolContract.connect(evaluationAgent).invalidateApprovedCredit(borrower.address);
            creditLines = await poolContract.creditLines();
            expect(creditLines.length).to.equal(2);
            expect(creditLines[0]).to.equal(borrower3.address);
            expect(creditLines[1]).to.equal(borrower2.address);

            await poolContract.connect(borrower).requestCredit(400, 30, 12);
            await poolContract.connect(evaluationAgent).approveCredit(borrower.address);
            await poolContract.connect(borrower).drawdown(10);
            creditLines = await poolContract.creditLines();
            expect(creditLines.length).to.equal(3);
            expect(creditLines[0]).to.equal(borrower3.address);
            expect(creditLines[1]).to.equal(borrower2.address);
            expect(creditLines[2]).to.equal(borrower.address);
        });

        it("resolver false case", async function () {
            // TODO add this logic. Right now due date is not being set properly
            // let res = await resolverContract.checker();
        });

        it("resolver true case", async function () {});
    });

    // Borrowing tests are grouped into two suites: Borrowing Request and Funding.
    describe("Borrowing request", function () {
        afterEach(async function () {
            await humaConfigContract.connect(poolOwner).unpauseProtocol();
            await poolContract.connect(evaluationAgent).invalidateApprovedCredit(borrower.address);
        });

        it("Should not allow loan requests while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pauseProtocol();
            await expect(
                poolContract.connect(borrower).requestCredit(400, 30, 12)
            ).to.be.revertedWith("PROTOCOL_PAUSED");
        });

        it("Cannot request loan while pool is off", async function () {
            await poolContract.connect(poolOwner).disablePool();
            await expect(
                poolContract.connect(borrower).requestCredit(400, 30, 12)
            ).to.be.revertedWith("POOL_NOT_ON");
            await poolContract.connect(poolOwner).enablePool();
        });

        it("Cannot request loan greater than limit", async function () {
            await expect(
                poolContract.connect(borrower).requestCredit(10001, 30, 12)
            ).to.be.revertedWith("GREATER_THAN_LIMIT");
        });

        it("Loan requested by borrower initiates correctly", async function () {
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(0);

            await poolContract.connect(poolOwner).setAPR(1217);

            await testTokenContract.connect(borrower).approve(poolContract.address, 0);

            await testTokenContract.connect(borrower).approve(poolContract.address, 999999);

            await poolContract.connect(borrower).requestCredit(400, 30, 12);

            const loanInformation = await poolContract.getCreditInformation(borrower.address);
            expect(loanInformation.creditLimit).to.equal(400);
            expect(loanInformation.intervalInDays).to.equal(30);
            expect(loanInformation.aprInBps).to.equal(1217);
        });

        describe("Loan Funding", function () {
            beforeEach(async function () {
                await poolContract.connect(borrower).requestCredit(400, 30, 12);
            });

            afterEach(async function () {
                await humaConfigContract.connect(poolOwner).unpauseProtocol();
            });

            it("Should not allow loan funding while protocol is paused", async function () {
                await humaConfigContract.connect(poolOwner).pauseProtocol();
                await expect(poolContract.connect(borrower).drawdown(400)).to.be.revertedWith(
                    "PROTOCOL_PAUSED"
                );
            });

            it("Prevent loan funding before approval", async function () {
                await expect(poolContract.connect(borrower).drawdown(400)).to.be.revertedWith(
                    "NOT_APPROVED_OR_IN_GOOD_STANDING"
                );
            });

            it("Borrow less than approved amount", async function () {
                await poolContract.connect(evaluationAgent).approveCredit(borrower.address);
                expect(await poolContract.isApproved(borrower.address)).to.equal(true);

                expect(await poolContract.getApprovalStatusForBorrower(borrower.address)).to.equal(
                    true
                );

                // Should return false when no loan exists
                expect(
                    await poolContract.getApprovalStatusForBorrower(evaluationAgent.address)
                ).to.equal(false);

                await poolContract.connect(borrower).drawdown(200);

                expect(await testTokenContract.balanceOf(borrower.address)).to.equal(188); // fees: 12. pool: 11, protocol: 1

                let accruedIncome = await poolContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(1);
                expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(212);
            });

            it("Borrow full amount that has been approved", async function () {
                await poolContract.connect(evaluationAgent).approveCredit(borrower.address);
                expect(await poolContract.isApproved(borrower.address)).to.equal(true);

                expect(await poolContract.getApprovalStatusForBorrower(borrower.address)).to.equal(
                    true
                );

                await poolContract.connect(borrower).drawdown(400);

                expect(await testTokenContract.balanceOf(borrower.address)).to.equal(386); // fees: 14. pool: 12, protocol: 2

                let accruedIncome = await poolContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(2);

                expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(14);
            });
        });

        // In "Payback".beforeEach(), make sure there is a loan funded.
        describe("Payback", function () {
            beforeEach(async function () {
                let lenderBalance = await testTokenContract.balanceOf(lender.address);

                await poolContract.connect(poolOwner).setAPR(1217);
                await poolContract.connect(borrower).requestCredit(400, 30, 12);

                await poolContract.connect(evaluationAgent).approveCredit(borrower.address);
                await poolContract.connect(borrower).drawdown(400);
            });

            afterEach(async function () {
                await humaConfigContract.connect(poolOwner).unpauseProtocol();
            });

            it("Should not allow payback while protocol is paused", async function () {
                await humaConfigContract.connect(poolOwner).pauseProtocol();
                await expect(
                    poolContract
                        .connect(borrower)
                        .makePayment(borrower.address, testTokenContract.address, 5)
                ).to.be.revertedWith("PROTOCOL_PAUSED");
            });

            // todo if the pool is stopped, shall we accept payback?

            it("Process payback", async function () {
                await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600]);
                await ethers.provider.send("evm_mine", []);

                await testTokenContract.connect(borrower).approve(poolContract.address, 5);

                await poolContract
                    .connect(borrower)
                    .makePayment(borrower.address, testTokenContract.address, 5);

                let creditInfo = await poolContract.getCreditInformation(borrower.address);

                expect(creditInfo.balance).to.equal(399);
                expect(creditInfo.remainingPeriods).to.equal(11);
            });

            // Default flow. Designed to include one payment successfully followed by a default.
            // Having one successful payment to incur some income so that we can cover both income and losses.
            it("Default flow", async function () {
                await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600 - 10]);
                await testTokenContract.connect(borrower).approve(poolContract.address, 4);
                await poolContract
                    .connect(borrower)
                    .makePayment(borrower.address, testTokenContract.address, 4);
                console.log(
                    "poolOwner withdrawableFundsOf: " +
                        (await hdtContract.withdrawableFundsOf(poolOwner.address))
                );
                expect(await hdtContract.withdrawableFundsOf(poolOwner.address)).to.be.within(
                    102,
                    104
                ); // target 3

                console.log(
                    "lender withdrawableFundsOf: " +
                        (await hdtContract.withdrawableFundsOf(lender.address))
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.be.within(
                    308,
                    312
                ); // target 9

                await expect(poolContract.triggerDefault(borrower.address)).to.be.revertedWith(
                    "DEFAULT_TRIGGERED_TOO_EARLY"
                );

                await ethers.provider.send("evm_increaseTime", [36 * 24 * 3600]);
                await poolContract.triggerDefault(borrower.address);

                console.log(
                    "poolOwner withdrawableFundsOf: " +
                        (await hdtContract.withdrawableFundsOf(poolOwner.address))
                );
                expect(await hdtContract.withdrawableFundsOf(owner.address)).to.be.within(3, 5); // target 4
                console.log(
                    "lender withdrawableFundsOf: " +
                        (await hdtContract.withdrawableFundsOf(lender.address))
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.be.within(11, 15); // target 12
            });
        });
    });
});
