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
    let humaPoolAdminsContract;
    let humaPoolFactoryContract;
    let humaPoolContract;
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

        const HumaPoolAdmins = await ethers.getContractFactory(
            "HumaPoolAdmins"
        );
        humaPoolAdminsContract = await HumaPoolAdmins.deploy();

        const HumaConfig = await ethers.getContractFactory("HumaConfig");
        humaConfigContract = await HumaConfig.deploy(
            owner.address,
            owner.address
        );
        humaConfigContract.setHumaTreasury(treasury.address);

        const HumaCreditFactory = await ethers.getContractFactory(
            "HumaCreditFactory"
        );
        humaCreditFactoryContract = await HumaCreditFactory.deploy();

        const HumaPoolLockerFactory = await ethers.getContractFactory(
            "HumaPoolLockerFactory"
        );
        humaPoolLockerFactoryContract = await HumaPoolLockerFactory.deploy();

        const ReputationTrackerFactory = await ethers.getContractFactory(
            "ReputationTrackerFactory"
        );
        reputationTrackerFactoryContract =
            await ReputationTrackerFactory.deploy();

        const HumaPoolFactory = await ethers.getContractFactory(
            "HumaPoolFactory"
        );
        humaPoolFactoryContract = await HumaPoolFactory.deploy(
            humaPoolAdminsContract.address,
            humaConfigContract.address,
            humaCreditFactoryContract.address,
            humaPoolLockerFactoryContract.address,
            reputationTrackerFactoryContract.address
        );
    });

    beforeEach(async function () {
        const TestToken = await ethers.getContractFactory("TestToken");
        testTokenContract = await TestToken.deploy();

        const tx = await humaPoolFactoryContract.deployNewPool(
            testTokenContract.address,
            0 // Pool type: Loan
        );
        const receipt = await tx.wait();
        let poolAddress;
        // eslint-disable-next-line no-restricted-syntax
        for (const evt of receipt.events) {
            if (evt.event === "PoolDeployed") {
                poolAddress = evt.args[0];
            }
        }

        humaPoolContract = await ethers.getContractAt(
            "HumaPool",
            poolAddress,
            owner
        );

        await testTokenContract.approve(humaPoolContract.address, 100);

        await humaPoolContract.makeInitialDeposit(100);
        await humaPoolContract.enablePool();

        await humaPoolContract.addCreditApprover(creditApprover.address);

        await humaPoolContract.setInterestRateBasis(1200); //bps
        await humaPoolContract.setMinMaxBorrowAmt(10, 1000);
        await humaPoolContract.enablePool();
        await humaPoolContract.setFees(10, 100, 20, 100, 30, 100);

        await testTokenContract.give1000To(lender.address);
        await testTokenContract
            .connect(lender)
            .approve(humaPoolContract.address, 300);

        await testTokenContract.approve(humaPoolFactoryContract.address, 99999);

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
                .approve(humaPoolContract.address, 300);
            await humaPoolContract.connect(lender).deposit(300);
        });

        afterEach(async function () {
            await humaConfigContract.setProtocolPaused(false);
        });

        it("Should not allow loan requests while protocol is paused", async function () {
            await humaConfigContract.setProtocolPaused(true);
            await expect(
                humaPoolContract.connect(borrower).requestCredit(400, 30, 12)
            ).to.be.revertedWith("HumaPool:PROTOCOL_PAUSED");
        });

        it("Cannot request loan while pool is off", async function () {
            await humaPoolContract.disablePool();
            await expect(
                humaPoolContract.connect(borrower).requestCredit(400, 30, 12)
            ).to.be.revertedWith("HumaPool:POOL_NOT_ON");
        });

        it("Cannot request loan lower than limit", async function () {
            await expect(
                humaPoolContract.connect(borrower).requestCredit(5, 30, 12)
            ).to.be.revertedWith("HumaPool:DENY_BORROW_SMALLER_THAN_LIMIT");
        });

        it("Cannot request loan greater than limit", async function () {
            await expect(
                humaPoolContract.connect(borrower).requestCredit(9999, 30, 12)
            ).to.be.revertedWith("HumaPool:DENY_BORROW_GREATER_THAN_LIMIT");
        });

        it("Loan requested by borrower initiates correctly", async function () {
            expect(
                await testTokenContract.balanceOf(borrower.address)
            ).to.equal(0);

            await humaPoolContract.connect(owner).setInterestRateBasis(1200);

            await testTokenContract
                .connect(borrower)
                .approve(humaPoolContract.address, 0);

            await testTokenContract
                .connect(borrower)
                .approve(humaPoolContract.address, 999999);

            await humaPoolContract.connect(borrower).requestCredit(400, 30, 12);

            const loanAddress = await humaPoolContract.creditMapping(
                borrower.address
            );
            const loanContract = await getLoanContractFromAddress(
                loanAddress,
                borrower
            );

            const loanInformation = await loanContract.getLoanInformation();
            expect(loanInformation._amount).to.equal(400);
            expect(loanInformation._paybackPerInterval).to.equal(0);
            expect(loanInformation._paybackInterval).to.equal(30);
            expect(loanInformation._interestRateBasis).to.equal(1200);
        });

        describe("Loan Funding", function () {
            beforeEach(async function () {
                await humaPoolContract
                    .connect(borrower)
                    .requestCredit(400, 30, 12);
            });

            afterEach(async function () {
                await humaConfigContract.setProtocolPaused(false);
            });

            it("Should not allow loan funding while protocol is paused", async function () {
                await humaConfigContract.setProtocolPaused(true);
                await expect(
                    humaPoolContract.connect(borrower).originateCredit(400)
                ).to.be.reverted;
            });

            it("Prevent loan funding before approval", async function () {
                await expect(
                    humaPoolContract.connect(borrower).originateCredit(400)
                ).to.be.revertedWith("HumaPool:CREDIT_NOT_APPROVED");
            });

            it("Borrow less than approved amount", async function () {
                const loanAddress = await humaPoolContract.creditMapping(
                    borrower.address
                );
                const loanContract = await getLoanContractFromAddress(
                    loanAddress,
                    borrower
                );
                await loanContract.approve();
                expect(await loanContract.isApproved()).to.equal(true);

                await humaPoolContract.connect(borrower).originateCredit(200);

                expect(
                    await testTokenContract.balanceOf(borrower.address)
                ).to.equal(188); // fees: 12. pool: 11, protocol: 1

                expect(
                    await testTokenContract.balanceOf(treasury.address)
                ).to.equal(1);

                expect(await humaPoolContract.getPoolLiquidity()).to.equal(211);
            });

            it("Borrow full amount that has been approved", async function () {
                const loanAddress = await humaPoolContract.creditMapping(
                    borrower.address
                );
                const loanContract = await getLoanContractFromAddress(
                    loanAddress,
                    borrower
                );
                await loanContract.approve();
                expect(await loanContract.isApproved()).to.equal(true);

                await humaPoolContract.connect(borrower).originateCredit(400);

                expect(
                    await testTokenContract.balanceOf(borrower.address)
                ).to.equal(386); // fees: 14. pool: 12, protocol: 2

                expect(
                    await testTokenContract.balanceOf(treasury.address)
                ).to.equal(2);

                expect(await humaPoolContract.getPoolLiquidity()).to.equal(12);
            });
        });

        // In "Payback".beforeEach(), make sure there is a loan funded.
        describe("Payback", function () {
            beforeEach(async function () {
                let lenderBalance = await testTokenContract.balanceOf(
                    lender.address
                );

                await humaPoolContract
                    .connect(owner)
                    .setInterestRateBasis(1200);
                await humaPoolContract
                    .connect(borrower)
                    .requestCredit(400, 30, 12);

                loanAddress = await humaPoolContract.creditMapping(
                    borrower.address
                );
                loanContract = await getLoanContractFromAddress(
                    loanAddress,
                    borrower
                );

                await loanContract.approve();
                await humaPoolContract.connect(borrower).originateCredit(400);
            });

            afterEach(async function () {
                await humaConfigContract.setProtocolPaused(false);
            });

            it("Should not allow payback while protocol is paused", async function () {
                await humaConfigContract.setProtocolPaused(true);
                await expect(
                    loanContract
                        .connect(borrower)
                        .makePayment(testTokenContract.address, 5)
                ).to.be.reverted;
            });

            // todo if the pool is stopped, shall we accept payback?

            it("Process payback", async function () {
                // await ethers.provider.send("evm_increaseTime", [
                //     30 * 24 * 3600 - 10,
                // ]);

                await testTokenContract
                    .connect(borrower)
                    .approve(loanContract.address, 5);

                await loanContract
                    .connect(borrower)
                    .makePayment(testTokenContract.address, 5);

                let loanInfo = await loanContract.getLoanInformation();

                expect(loanInfo._principalPaidBack).to.equal(1);
                expect(loanInfo._remainingPayments).to.equal(11);
            });

            // Default flow. Designed to include one payment successfully followed by a default.
            // Having one successful payment to incur some income so that we can cover both income and losses.
            it("Default flow", async function () {
                await ethers.provider.send("evm_increaseTime", [
                    30 * 24 * 3600 - 10,
                ]);
                await testTokenContract
                    .connect(borrower)
                    .approve(loanContract.address, 4);
                await loanContract
                    .connect(borrower)
                    .makePayment(testTokenContract.address, 4);
                expect(
                    await humaPoolContract.withdrawableFundsOf(owner.address)
                ).to.be.within(102, 104); // target 3
                expect(
                    await humaPoolContract.withdrawableFundsOf(lender.address)
                ).to.be.within(308, 311); // target 9

                await expect(loanContract.triggerDefault()).to.be.revertedWith(
                    "HumaIF:DEFAULT_TRIGGERED_TOO_EARLY"
                );

                await ethers.provider.send("evm_increaseTime", [
                    36 * 24 * 3600,
                ]);
                await loanContract.triggerDefault();

                expect(
                    await humaPoolContract.withdrawableFundsOf(owner.address)
                ).to.be.within(3, 5); // target 4
                expect(
                    await humaPoolContract.withdrawableFundsOf(lender.address)
                ).to.be.within(11, 13); // target 12
            });
        });
    });
});
