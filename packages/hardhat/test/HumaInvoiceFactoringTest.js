/* eslint-disable no-underscore-dangle */
const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

use(solidity);

const getInvoiceContractFromAddress = async function (address, signer) {
    return ethers.getContractAt("HumaInvoiceFactoring", address, signer);
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
describe("Huma Invoice Financing", function () {
    let invoiceContract;
    let humaConfigContract;
    // let humaCreditFactoryContract;
    let poolLockerFactoryContract;
    let testTokenContract;
    let invoiceNFTContract;
    let feeManagerContract;
    let owner;
    let lender;
    let borrower;
    let borrower2;
    let treasury;
    let creditApprover;
    let invoiceNFTTokenId;

    before(async function () {
        [owner, lender, borrower, treasury, creditApprover, payer] =
            await ethers.getSigners();

        const HumaConfig = await ethers.getContractFactory("HumaConfig");
        humaConfigContract = await HumaConfig.deploy(treasury.address);
        humaConfigContract.setHumaTreasury(treasury.address);

        const poolLockerFactory = await ethers.getContractFactory(
            "PoolLockerFactory"
        );
        poolLockerFactoryContract = await poolLockerFactory.deploy();

        const feeManagerFactory = await ethers.getContractFactory(
            "BaseFeeManager"
        );
        feeManagerContract = await feeManagerFactory.deploy();

        await feeManagerContract.setFees(10, 100, 20, 100, 30, 100);

        const InvoiceNFT = await ethers.getContractFactory("InvoiceNFT");
        invoiceNFTContract = await InvoiceNFT.deploy();
    });

    beforeEach(async function () {
        const TestToken = await ethers.getContractFactory("TestToken");
        testTokenContract = await TestToken.deploy();

        const HumaInvoiceFactoring = await ethers.getContractFactory(
            "HumaInvoiceFactoring"
        );
        invoiceContract = await HumaInvoiceFactoring.deploy(
            testTokenContract.address,
            humaConfigContract.address,
            poolLockerFactoryContract.address,
            feeManagerContract.address,
            "Invoice Factory Pool",
            "HumaIF HDT",
            "HHDT"
        );
        await invoiceContract.deployed();

        await testTokenContract.approve(invoiceContract.address, 100);

        await invoiceContract.enablePool();

        // const tx = await poolLockerFactoryContract.deployNewLocker(
        //     invoiceContract.address,
        //     testTokenContract.address
        // );
        // const receipt = await tx.wait();
        // let lockerAddress;
        // for (const evt of receipt.events) {
        //     if (evt.event === "PoolLockerDeployed") {
        //         lockerAddress = evt.args[0];
        //     }
        // }

        // await invoiceContract.connect(owner).setPoolLocker(lockerAddress);

        await testTokenContract.approve(invoiceContract.address, 100);

        await invoiceContract.makeInitialDeposit(100);

        const lenderInfo = await invoiceContract
            .connect(owner)
            .getLenderInfo(owner.address);
        expect(lenderInfo.principalAmount).to.equal(100);
        expect(lenderInfo.mostRecentLoanTimestamp).to.not.equal(0);
        expect(await invoiceContract.getPoolLiquidity()).to.equal(100);

        await invoiceContract.addCreditApprover(creditApprover.address);

        await invoiceContract.connect(owner).setAPRandInterestOnly(0, true); //bps
        await invoiceContract.setMinMaxBorrowAmount(10, 1000);

        await testTokenContract.give1000To(lender.address);
        await testTokenContract
            .connect(lender)
            .approve(invoiceContract.address, 400);

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

    describe("Post Approved Invoice Factoring", function () {
        // Makes sure there is liquidity in the pool for borrowing
        beforeEach(async function () {
            await invoiceContract.connect(lender).deposit(300);
            await testTokenContract
                .connect(borrower)
                .approve(invoiceContract.address, 99999);
        });

        afterEach(async function () {
            await humaConfigContract.connect(owner).unpauseProtocol();
        });

        it("Should only allow credit approvers to post approved loan requests", async function () {
            await expect(
                invoiceContract
                    .connect(lender)
                    .recordPreapprovedCreditRequest(
                        borrower.address,
                        400,
                        ethers.constants.AddressZero,
                        0,
                        0,
                        30,
                        1
                    )
            ).to.be.revertedWith("APPROVER_REQUIRED");
        });

        it("Should not allow posting approved loans while protocol is paused", async function () {
            await humaConfigContract.connect(owner).pauseProtocol();

            await expect(
                invoiceContract
                    .connect(creditApprover)
                    .recordPreapprovedCreditRequest(
                        borrower.address,
                        400,
                        ethers.constants.AddressZero,
                        0,
                        0,
                        30,
                        1
                    )
            ).to.be.revertedWith("PROTOCOL_PAUSED");
        });

        it("Should not allow posting approved laons while pool is off", async function () {
            await invoiceContract.disablePool();

            await expect(
                invoiceContract
                    .connect(creditApprover)
                    .recordPreapprovedCreditRequest(
                        borrower.address,
                        400,
                        ethers.constants.AddressZero,
                        0,
                        0,
                        30,
                        1
                    )
            ).to.be.revertedWith("POOL_NOT_ON");
        });

        it("Cannot post approved loan with amount lower than limit", async function () {
            await expect(
                invoiceContract
                    .connect(creditApprover)
                    .recordPreapprovedCreditRequest(
                        borrower.address,
                        5,
                        ethers.constants.AddressZero,
                        0,
                        0,
                        30,
                        1
                    )
            ).to.be.revertedWith("SMALLER_THAN_LIMIT");
        });

        it("Cannot post approved loan with amount greater than limit", async function () {
            await expect(
                invoiceContract
                    .connect(creditApprover)
                    .recordPreapprovedCreditRequest(
                        borrower.address,
                        9999,
                        ethers.constants.AddressZero,
                        0,
                        0,
                        30,
                        1
                    )
            ).to.be.revertedWith("GREATER_THAN_LIMIT");
        });

        it("Should post approved invoice financing successfully", async function () {
            expect(
                await testTokenContract.balanceOf(borrower.address)
            ).to.equal(0);

            await invoiceContract.connect(owner).setAPRandInterestOnly(0, true);

            await invoiceContract
                .connect(creditApprover)
                .recordPreapprovedCreditRequest(
                    borrower.address,
                    400,
                    ethers.constants.AddressZero,
                    0,
                    0,
                    30,
                    1
                );

            const creditInfo = await invoiceContract.getCreditInformation(
                borrower.address
            );

            expect(creditInfo.loanAmount).to.equal(400);
            expect(creditInfo.remainingPrincipal).to.equal(400);
            expect(creditInfo.remainingPayments).to.equal(1);
        });
    });

    describe("Invalidate Approved Invoice Factoring", function () {
        // it("Should disallow non-credit-approver to invalidate an approved invoice factoring record", async function () {
        //     await expect(
        //         invoiceContract
        //             .connect(payer)
        //             .invalidateApprovedCredit(borrower.address)
        //     ).to.be.revertedWith("APPROVER_REQUIRED");
        // });

        it("Should allow credit approver to invalidate an approved invoice factoring record", async function () {
            await invoiceContract.connect(owner).setAPRandInterestOnly(0, true);

            await invoiceContract
                .connect(creditApprover)
                .recordPreapprovedCreditRequest(
                    borrower.address,
                    400,
                    ethers.constants.AddressZero,
                    0,
                    0,
                    30,
                    1
                );

            await invoiceContract
                .connect(creditApprover)
                .invalidateApprovedCredit(borrower.address);

            //await invoiceContract.printDetailStatus(borrower.address);
            const creditInfo = await invoiceContract.getCreditInformation(
                borrower.address
            );

            expect(creditInfo.deleted).to.equal(true);
        });
    });

    describe("Invoice Factoring Funding", function () {
        // Makes sure there is liquidity in the pool for borrowing
        beforeEach(async function () {
            await invoiceContract.connect(lender).deposit(300);

            await invoiceContract
                .connect(creditApprover)
                .recordPreapprovedCreditRequest(
                    borrower.address,
                    400,
                    ethers.constants.AddressZero,
                    0,
                    0,
                    30,
                    1
                );

            // Mint InvoiceNFT to the borrower
            const tx = await invoiceNFTContract.mintNFT(borrower.address, "");
            const receipt = await tx.wait();
            // eslint-disable-next-line no-restricted-syntax
            for (const evt of receipt.events) {
                if (evt.event === "TokenGenerated") {
                    invoiceNFTTokenId = evt.args[0];
                }
            }

            await invoiceNFTContract
                .connect(borrower)
                .approve(invoiceContract.address, invoiceNFTTokenId);
        });

        afterEach(async function () {
            await humaConfigContract.connect(owner).unpauseProtocol();
        });

        it("Should not allow loan funding while protocol is paused", async function () {
            await humaConfigContract.connect(owner).pauseProtocol();
            await expect(
                invoiceContract.connect(borrower).originateCredit(400)
            ).to.be.revertedWith("PROTOCOL_PAUSED");
        });

        // todo This test throw VM Exception. More investigation needed
        it("Prevent loan funding before approval", async function () {
            // expect(
            //     await invoiceContract.connect(borrower).originateCredit()
            // ).to.be.revertedWith("CREDIT_NOT_APPROVED");
        });

        it("Should be able to borrow amount less than approved", async function () {
            await invoiceContract
                .connect(creditApprover)
                .approveCredit(borrower.address);

            await invoiceContract
                .connect(borrower)
                .originateCollateralizedCredit(
                    borrower.address,
                    200,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    1
                );

            expect(
                await invoiceNFTContract.ownerOf(invoiceNFTTokenId)
            ).to.equal(await invoiceContract.poolLockerAddress());

            expect(await invoiceNFTContract.balanceOf);
            expect(
                await testTokenContract.balanceOf(treasury.address)
            ).to.equal(1);

            expect(await invoiceContract.getPoolLiquidity()).to.equal(211);
        });

        it("Should be able to borrow the full approved amount", async function () {
            await invoiceContract
                .connect(creditApprover)
                .approveCredit(borrower.address);
            // expect(await invoiceContract.isApproved()).to.equal(true);

            await invoiceContract
                .connect(borrower)
                .originateCollateralizedCredit(
                    borrower.address,
                    400,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    1
                );

            expect(
                await invoiceNFTContract.ownerOf(invoiceNFTTokenId)
            ).to.equal(await invoiceContract.poolLockerAddress());

            expect(
                await testTokenContract.balanceOf(borrower.address)
            ).to.equal(386); // principal: 400, flat fee: 20, bps fee: 4

            expect(
                await testTokenContract.balanceOf(treasury.address)
            ).to.equal(2);

            expect(await invoiceContract.getPoolLiquidity()).to.equal(12);
        });
    });

    describe("Pre-approved Invoice Factoring Request and Origination", function () {
        // Makes sure there is liquidity in the pool for borrowing
        beforeEach(async function () {
            await invoiceContract.connect(lender).deposit(300);
            await testTokenContract
                .connect(borrower)
                .approve(invoiceContract.address, 99999);

            // Mint InvoiceNFT to the borrower
            const tx = await invoiceNFTContract.mintNFT(borrower.address, "");
            const receipt = await tx.wait();
            // eslint-disable-next-line no-restricted-syntax
            for (const evt of receipt.events) {
                if (evt.event === "TokenGenerated") {
                    invoiceNFTTokenId = evt.args[0];
                }
            }

            await invoiceNFTContract
                .connect(borrower)
                .approve(invoiceContract.address, invoiceNFTTokenId);
        });

        afterEach(async function () {
            await humaConfigContract.connect(owner).unpauseProtocol();
        });

        it("Should not allow posting pre-approved IF while protocol is paused", async function () {
            await humaConfigContract.connect(owner).pauseProtocol();

            await expect(
                invoiceContract
                    .connect(creditApprover)
                    .originatePreapprovedCredit(
                        borrower.address,
                        400,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        1,
                        30,
                        1
                    )
            ).to.be.revertedWith("PROTOCOL_PAUSED");
        });

        it("Should not allow posting pre-approved IF while pool is off", async function () {
            await invoiceContract.disablePool();

            await expect(
                invoiceContract
                    .connect(creditApprover)
                    .originatePreapprovedCredit(
                        borrower.address,
                        400,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        1,
                        30,
                        1
                    )
            ).to.be.revertedWith("POOL_NOT_ON");
        });

        it("Should only allow approvers to post pre-approved IF", async function () {
            await expect(
                invoiceContract
                    .connect(lender)
                    .originatePreapprovedCredit(
                        borrower.address,
                        400,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        1,
                        30,
                        1
                    )
            ).to.be.revertedWith("APPROVER_REQUIRED");
        });

        // Should deny if there is existing IF.

        it("Cannot post pre-approved IF with amount lower than limit", async function () {
            await expect(
                invoiceContract
                    .connect(creditApprover)
                    .originatePreapprovedCredit(
                        borrower.address,
                        5,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        1,
                        30,
                        1
                    )
            ).to.be.revertedWith("SMALLER_THAN_LIMIT");
        });

        it("Cannot post pre-approved IF with amount greater than limit", async function () {
            await expect(
                invoiceContract
                    .connect(creditApprover)
                    .originatePreapprovedCredit(
                        borrower.address,
                        9999,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        1,
                        30,
                        1
                    )
            ).to.be.revertedWith("GREATER_THAN_LIMIT");
        });

        it("Should post pre-approved IF successfully", async function () {
            expect(
                await testTokenContract.balanceOf(borrower.address)
            ).to.equal(0);

            await invoiceContract.connect(owner).setAPRandInterestOnly(0, true);

            await invoiceContract
                .connect(creditApprover)
                .originatePreapprovedCredit(
                    borrower.address,
                    400,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    1,
                    30,
                    1
                );

            expect(
                await invoiceNFTContract.ownerOf(invoiceNFTTokenId)
            ).to.equal(await invoiceContract.poolLockerAddress());

            expect(
                await testTokenContract.balanceOf(borrower.address)
            ).to.equal(386); // principal: 400, flat fee: 20, bps fee: 4

            expect(
                await testTokenContract.balanceOf(treasury.address)
            ).to.equal(2);

            expect(await invoiceContract.getPoolLiquidity()).to.equal(12);
        });
    });

    describe("Pre-approved Invoice Factoring Request and Origination", function () {
        // Makes sure there is liquidity in the pool for borrowing
        beforeEach(async function () {
            await invoiceContract.connect(lender).deposit(300);
            await testTokenContract
                .connect(borrower)
                .approve(invoiceContract.address, 99999);
        });

        afterEach(async function () {
            await humaConfigContract.connect(owner).unpauseProtocol();
        });

        it("Should not allow posting pre-approved IF while protocol is paused", async function () {
            await humaConfigContract.connect(owner).pauseProtocol();

            await expect(
                invoiceContract
                    .connect(creditApprover)
                    .originatePreapprovedCredit(
                        borrower.address,
                        400,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        1,
                        30,
                        1
                    )
            ).to.be.revertedWith("PROTOCOL_PAUSED");
        });

        it("Should not allow posting pre-approved IF while pool is off", async function () {
            await invoiceContract.disablePool();

            await expect(
                invoiceContract
                    .connect(creditApprover)
                    .originatePreapprovedCredit(
                        borrower.address,
                        400,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        1,
                        30,
                        1
                    )
            ).to.be.revertedWith("POOL_NOT_ON");
        });

        it("Should only allow approvers to post pre-approved IF", async function () {
            await expect(
                invoiceContract
                    .connect(lender)
                    .originatePreapprovedCredit(
                        borrower.address,
                        400,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        1,
                        30,
                        1
                    )
            ).to.be.revertedWith("APPROVER_REQUIRED");
        });

        // Should deny if there is existing IF.

        it("Cannot post pre-approved IF with amount lower than limit", async function () {
            await expect(
                invoiceContract
                    .connect(creditApprover)
                    .originatePreapprovedCredit(
                        borrower.address,
                        5,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        1,
                        30,
                        1
                    )
            ).to.be.revertedWith("SMALLER_THAN_LIMIT");
        });

        it("Cannot post pre-approved IF with amount greater than limit", async function () {
            await expect(
                invoiceContract
                    .connect(creditApprover)
                    .originatePreapprovedCredit(
                        borrower.address,
                        9999,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        1,
                        30,
                        1
                    )
            ).to.be.revertedWith("GREATER_THAN_LIMIT");
        });

        it("Should post pre-approved IF successfully", async function () {
            // Mint InvoiceNFT to the borrower
            const tx = await invoiceNFTContract.mintNFT(borrower.address, "");
            const receipt = await tx.wait();
            // eslint-disable-next-line no-restricted-syntax
            for (const evt of receipt.events) {
                if (evt.event === "TokenGenerated") {
                    invoiceNFTTokenId = evt.args[0];
                }
            }

            await invoiceNFTContract
                .connect(borrower)
                .approve(invoiceContract.address, invoiceNFTTokenId);

            expect(
                await testTokenContract.balanceOf(borrower.address)
            ).to.equal(0);

            await invoiceContract.connect(owner).setAPRandInterestOnly(0, true);

            await invoiceContract
                .connect(creditApprover)
                .originatePreapprovedCredit(
                    borrower.address,
                    400,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    1,
                    30,
                    1
                );

            const invoiceInfo = await invoiceContract.getCreditInformation(
                borrower.address
            );

            expect(invoiceInfo.loanAmount).to.equal(400);

            expect(
                await testTokenContract.balanceOf(borrower.address)
            ).to.equal(386); // principal: 400, flat fee: 20, bps fee: 4

            expect(
                await testTokenContract.balanceOf(treasury.address)
            ).to.equal(2);

            expect(await invoiceContract.getPoolLiquidity()).to.equal(12);
        });
    });

    // In "Payback".beforeEach(), make sure there is a loan funded.
    describe("Payback", async function () {
        beforeEach(async function () {
            // Mint InvoiceNFT to the borrower
            const tx = await invoiceNFTContract.mintNFT(borrower.address, "");
            const receipt = await tx.wait();
            // eslint-disable-next-line no-restricted-syntax
            for (const evt of receipt.events) {
                if (evt.event === "TokenGenerated") {
                    invoiceNFTTokenId = evt.args[0];
                }
            }
            await invoiceNFTContract
                .connect(borrower)
                .approve(invoiceContract.address, invoiceNFTTokenId);

            await invoiceContract.connect(lender).deposit(300);
            await invoiceContract
                .connect(creditApprover)
                .recordPreapprovedCreditRequest(
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
                .originateCollateralizedCredit(
                    borrower.address,
                    400,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    1
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
                    .makePayment(testTokenContract.address, 5)
            ).to.be.revertedWith("PROTOCOL_PAUSED");
        });

        // todo if the pool is stopped, shall we accept payback?

        it("Should reject if non-approver calls to report payments received", async function () {
            await ethers.provider.send("evm_increaseTime", [
                30 * 24 * 3600 - 10,
            ]);
            await expect(
                invoiceContract
                    .connect(borrower)
                    .receivedPayment(
                        borrower.address,
                        testTokenContract.address,
                        500
                    )
            ).to.be.revertedWith("APPROVER_REQUIRED");
        });

        it("Process payback", async function () {
            await ethers.provider.send("evm_increaseTime", [
                30 * 24 * 3600 - 10,
            ]);

            // await testTokenContract
            //     .connect(payer)
            //     .transfer(
            //         HumaPoolLocker(invoiceContract.getPoolLiquidity()),
            //         210
            //     );

            // await testTokenContract
            //     .connect(borrower)
            //     .approve(invoiceContract.poolLockerAddress(), 210);

            // simulates payments from payer.
            await testTokenContract
                .connect(payer)
                .transfer(invoiceContract.poolLockerAddress(), 500);

            await testTokenContract
                .connect(borrower)
                .approve(invoiceContract.address, 100);

            await invoiceContract
                .connect(creditApprover)
                .receivedPayment(
                    borrower.address,
                    testTokenContract.address,
                    500
                );

            expect(
                await testTokenContract.balanceOf(borrower.address)
            ).to.equal(486);
            expect(
                await testTokenContract.balanceOf(treasury.address)
            ).to.equal(2);
            expect(await invoiceContract.getPoolLiquidity()).to.equal(412);

            // test withdraw to make sure the income is allocated properly.
            expect(await invoiceContract.balanceOf(lender.address)).to.equal(
                300
            );
            expect(
                await invoiceContract.withdrawableFundsOf(lender.address)
            ).to.be.within(308, 310); // use within to handle rounding error
            expect(
                await invoiceContract.withdrawableFundsOf(owner.address)
            ).to.be.within(102, 104); // use within to handle rounding error
        });

        it("Default flow", async function () {
            await expect(
                invoiceContract.triggerDefault(borrower.address)
            ).to.be.revertedWith("DEFAULT_TRIGGERED_TOO_EARLY");

            const creditInfo = await invoiceContract.getCreditInformation(
                borrower.address
            );
            let gracePeriod =
                await invoiceContract.poolDefaultGracePeriodInSeconds();
            let dueDate = creditInfo.nextDueDate;
            let current = Date.now();

            let timeNeeded = dueDate + gracePeriod - current;

            await ethers.provider.send("evm_increaseTime", [timeNeeded]);

            await invoiceContract.triggerDefault(borrower.address);

            expect(
                await invoiceContract.withdrawableFundsOf(owner.address)
            ).to.be.within(2, 4);
            expect(
                await invoiceContract.withdrawableFundsOf(lender.address)
            ).to.be.within(8, 10);
        });
    });
});
