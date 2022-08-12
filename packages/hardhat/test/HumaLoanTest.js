/* eslint-disable no-underscore-dangle */
const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

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
// m0-2: Set up fees=(10, 100, 20, 100, 30, 100), APR=1200, protocol fee=50.
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
describe("Huma Loan", function () {
    let humaPoolFactoryContract;
    let poolContract;
    let humaConfigContract;
    let humaCreditFactoryContract;
    let humaPoolLockerFactoryContract;
    let testTokenContract;
    let owner;
    let lender;
    let borrower;
    let borrower2;
    let treasury;
    let creditApprover;

    before(async function () {
        [owner, lender, borrower, borrower2, treasury, creditApprover] =
            await ethers.getSigners();

        const HumaConfig = await ethers.getContractFactory("HumaConfig");
        humaConfigContract = await HumaConfig.deploy(treasury.address);
        humaConfigContract.setHumaTreasury(treasury.address);

        const poolLockerFactory = await ethers.getContractFactory(
            "PoolLockerFactory"
        );
        poolLockerFactoryContract = await poolLockerFactory.deploy();

        const InvoiceNFT = await ethers.getContractFactory("InvoiceNFT");
        invoiceNFTContract = await InvoiceNFT.deploy();
    });

    beforeEach(async function () {
        const TestToken = await ethers.getContractFactory("TestToken");
        testTokenContract = await TestToken.deploy();

        const BaseCreditPool = await ethers.getContractFactory(
            "BaseCreditPool"
        );
        poolContract = await BaseCreditPool.deploy(
            testTokenContract.address,
            humaConfigContract.address
        );
        await poolContract.deployed();

        await testTokenContract.approve(poolContract.address, 100);

        await poolContract.enablePool();

        const tx = await poolLockerFactoryContract.deployNewLocker(
            poolContract.address,
            testTokenContract.address
        );
        const receipt = await tx.wait();
        let lockerAddress;
        for (const evt of receipt.events) {
            if (evt.event === "PoolLockerDeployed") {
                lockerAddress = evt.args[0];
            }
        }

        await poolContract.connect(owner).setPoolLocker(lockerAddress);

        await testTokenContract.approve(poolContract.address, 100);

        await poolContract.makeInitialDeposit(100);

        const lenderInfo = await poolContract
            .connect(owner)
            .getLenderInfo(owner.address);
        expect(lenderInfo.amount).to.equal(100);
        expect(lenderInfo.mostRecentLoanTimestamp).to.not.equal(0);
        expect(await poolContract.getPoolLiquidity()).to.equal(100);

        await poolContract.addCreditApprover(creditApprover.address);

        await poolContract.setAPR(1200); //bps
        await poolContract.setMinMaxBorrowAmt(10, 1000);
        // set fees (factoring_fat, factoring_bps, late_flat, late_bps, early_falt, early_bps)
        await poolContract.setFees(10, 100, 20, 100, 30, 100);

        await testTokenContract.give1000To(lender.address);
        await testTokenContract
            .connect(lender)
            .approve(poolContract.address, 400);

        let lenderBalance = await testTokenContract.balanceOf(lender.address);
        if (lenderBalance < 1000)
            await testTokenContract.mint(lender.address, 1000 - lenderBalance);

        let borrowerBalance = await testTokenContract.balanceOf(
            borrower.address
        );
        if (lenderBalance > 0)
            await testTokenContract
                .connect(borrower)
                .burn(borrower.address, borrowerBalance);
    });

    afterEach(async function () {});

    // Borrowing tests are grouped into two suites: Borrowing Request and Funding.
    // In beforeEach() of "Borrowing request", we make sure there is 100 liquidity.
    describe("Borrowing request", function () {
        // Makes sure there is liquidity in the pool for borrowing
        beforeEach(async function () {
            await testTokenContract
                .connect(lender)
                .approve(poolContract.address, 300);
            await poolContract.connect(lender).deposit(300);
        });

        afterEach(async function () {
            await humaConfigContract.connect(owner).unpauseProtocol();
        });

        it("Should not allow loan requests while protocol is paused", async function () {
            await humaConfigContract.connect(owner).pauseProtocol();
            await expect(
                poolContract.connect(borrower).requestCredit(400, 30, 12)
            ).to.be.revertedWith("PROTOCOL_PAUSED");
        });

        it("Cannot request loan while pool is off", async function () {
            await poolContract.disablePool();
            await expect(
                poolContract.connect(borrower).requestCredit(400, 30, 12)
            ).to.be.revertedWith("POOL_NOT_ON");
        });

        it("Cannot request loan lower than limit", async function () {
            await expect(
                poolContract.connect(borrower).requestCredit(5, 30, 12)
            ).to.be.revertedWith("SMALLER_THAN_LIMIT");
        });

        it("Cannot request loan greater than limit", async function () {
            await expect(
                poolContract.connect(borrower).requestCredit(9999, 30, 12)
            ).to.be.revertedWith("GREATER_THAN_LIMIT");
        });

        it("Loan requested by borrower initiates correctly", async function () {
            expect(
                await testTokenContract.balanceOf(borrower.address)
            ).to.equal(0);

            await poolContract.connect(owner).setAPR(1200);

            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, 0);

            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, 999999);

            await poolContract.connect(borrower).requestCredit(400, 30, 12);

            const loanInformation = await poolContract.getCreditInformation(
                borrower.address
            );
            expect(loanInformation._amount).to.equal(400);
            expect(loanInformation._paybackPerInterval).to.equal(0);
            expect(loanInformation._paybackInterval).to.equal(30);
            expect(loanInformation._interestRateBasis).to.equal(1200);
        });

        describe("Loan Funding", function () {
            beforeEach(async function () {
                await poolContract.connect(borrower).requestCredit(400, 30, 12);
            });

            afterEach(async function () {
                await humaConfigContract.connect(owner).unpauseProtocol();
            });

            it("Should not allow loan funding while protocol is paused", async function () {
                await humaConfigContract.connect(owner).pauseProtocol();
                await expect(
                    poolContract.connect(borrower).originateCredit(400)
                ).to.be.revertedWith("PROTOCOL_PAUSED");
            });

            it("Prevent loan funding before approval", async function () {
                await expect(
                    poolContract.connect(borrower).originateCredit(400)
                ).to.be.revertedWith("CREDIT_NOT_APPROVED");
            });

            it("Borrow less than approved amount", async function () {
                await poolContract.approveCredit(borrower.address);
                expect(
                    await poolContract.isApproved(borrower.address)
                ).to.equal(true);

                expect(
                    await poolContract.getApprovalStatusForBorrower(
                        borrower.address
                    )
                ).to.equal(true);

                await poolContract.connect(borrower).originateCredit(200);

                expect(
                    await testTokenContract.balanceOf(borrower.address)
                ).to.equal(188); // fees: 12. pool: 11, protocol: 1

                expect(
                    await testTokenContract.balanceOf(treasury.address)
                ).to.equal(1);

                expect(await poolContract.getPoolLiquidity()).to.equal(211);
            });

            it("Borrow full amount that has been approved", async function () {
                await poolContract.approveCredit(borrower.address);
                expect(
                    await poolContract.isApproved(borrower.address)
                ).to.equal(true);

                expect(
                    await poolContract.getApprovalStatusForBorrower(
                        borrower.address
                    )
                ).to.equal(true);

                await poolContract.connect(borrower).originateCredit(400);

                expect(
                    await testTokenContract.balanceOf(borrower.address)
                ).to.equal(386); // fees: 14. pool: 12, protocol: 2

                expect(
                    await testTokenContract.balanceOf(treasury.address)
                ).to.equal(2);

                expect(await poolContract.getPoolLiquidity()).to.equal(12);
            });
        });

        // In "Payback".beforeEach(), make sure there is a loan funded.
        describe("Payback", function () {
            beforeEach(async function () {
                let lenderBalance = await testTokenContract.balanceOf(
                    lender.address
                );

                await poolContract.connect(owner).setAPR(1200);
                await poolContract.connect(borrower).requestCredit(400, 30, 12);

                await poolContract.approveCredit(borrower.address);
                await poolContract.connect(borrower).originateCredit(400);
            });

            afterEach(async function () {
                await humaConfigContract.connect(owner).unpauseProtocol();
            });

            it("Should not allow payback while protocol is paused", async function () {
                await humaConfigContract.connect(owner).pauseProtocol();
                await expect(
                    poolContract
                        .connect(borrower)
                        .makePayment(
                            borrower.address,
                            testTokenContract.address,
                            5
                        )
                ).to.be.revertedWith("PROTOCOL_PAUSED");
            });

            // todo if the pool is stopped, shall we accept payback?

            it("Process payback", async function () {
                await testTokenContract
                    .connect(borrower)
                    .approve(poolContract.address, 5);

                await poolContract
                    .connect(borrower)
                    .makePayment(
                        borrower.address,
                        testTokenContract.address,
                        5
                    );

                let creditInfo = await poolContract.getCreditInformation(
                    borrower.address
                );

                expect(creditInfo._remainingPayments).to.equal(11);
                expect(creditInfo._remainingPrincipal).to.equal(399);
            });

            // Default flow. Designed to include one payment successfully followed by a default.
            // Having one successful payment to incur some income so that we can cover both income and losses.
            it("Default flow", async function () {
                await ethers.provider.send("evm_increaseTime", [
                    30 * 24 * 3600 - 10,
                ]);
                await testTokenContract
                    .connect(borrower)
                    .approve(poolContract.address, 4);
                await poolContract
                    .connect(borrower)
                    .makePayment(
                        borrower.address,
                        testTokenContract.address,
                        4
                    );
                expect(
                    await poolContract.withdrawableFundsOf(owner.address)
                ).to.be.within(102, 104); // target 3
                expect(
                    await poolContract.withdrawableFundsOf(lender.address)
                ).to.be.within(308, 311); // target 9

                await expect(
                    poolContract.triggerDefault(borrower.address)
                ).to.be.revertedWith("HumaIF:DEFAULT_TRIGGERED_TOO_EARLY");

                await ethers.provider.send("evm_increaseTime", [
                    36 * 24 * 3600,
                ]);
                await poolContract.triggerDefault(borrower.address);

                expect(
                    await poolContract.withdrawableFundsOf(owner.address)
                ).to.be.within(3, 5); // target 4
                expect(
                    await poolContract.withdrawableFundsOf(lender.address)
                ).to.be.within(11, 13); // target 12
            });
        });
    });
});
