/* eslint-disable no-underscore-dangle */
const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

use(solidity);

const getInvoiceContractFromAddress = async function (address, signer) {
    return ethers.getContractAt("HumaIF", address, signer);
};

// Let us limit the depth of describe to be 2.
//
// In before() of "Huma Pool", all the key supporting contracts are deployed.
//
// In beforeEach() of "Huma Pool", we deploy a new HumaPool with initial
// liquidity 100 from the owner
//
// In afterEach() of "Huma Pool", we should return the 100 initial liquidity
// to the owner so that owner has enough balance for future tests.
// Right now, due to a bug with initial liquidity, we mint 100 to owner.
describe("Huma Invoice Financing", function () {
    let humaPoolAdminsContract;
    let humaPoolFactoryContract;
    let humaPoolContract;
    let humaConfigContract;
    let humaCreditFactoryContract;
    let humaPoolLockerFactoryContract;
    let humaAPIClientContract;
    let testTokenContract;
    let owner;
    let lender;
    let borrower;
    let borrower2;
    let treasury;
    let creditApprover;

    before(async function () {
        [owner, lender, borrower, treasury, creditApprover] =
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

        const HumaAPIClient = await ethers.getContractFactory("HumaAPIClient");
        humaAPIClientContract = await HumaAPIClient.deploy();

        const HumaPoolFactory = await ethers.getContractFactory(
            "HumaPoolFactory"
        );
        humaPoolFactoryContract = await HumaPoolFactory.deploy(
            humaPoolAdminsContract.address,
            humaConfigContract.address,
            humaCreditFactoryContract.address,
            humaPoolLockerFactoryContract.address,
            humaAPIClientContract.address
        );
    });

    beforeEach(async function () {
        const TestToken = await ethers.getContractFactory("TestToken");
        testTokenContract = await TestToken.deploy();

        // Deploy a InvoiceFactoring pool
        await testTokenContract.approve(humaPoolFactoryContract.address, 99999);
        const tx = await humaPoolFactoryContract.deployNewPool(
            testTokenContract.address,
            1
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

        await humaPoolContract.setMinMaxBorrowAmt(10, 1000);
        await humaPoolContract.addCreditApprover(creditApprover.address);

        await humaPoolContract.enablePool();
        await humaPoolContract.setFees(20, 100, 0, 0, 0, 0);

        await testTokenContract.give1000To(lender.address);
        await testTokenContract
            .connect(lender)
            .approve(humaPoolContract.address, 99999);
    });

    // Transfers the 100 initial liquidity provided by owner back to the owner
    afterEach(async function () {
        // todo The right way to reset for the next iteration is to allow owner to withdraw 100
        // Right now, HumaPoolFactory does not track the initialLiquidity. Need to fix it.
        //await humaPoolContract.connect(owner).withdraw(100);
        //await testTokenContract.connect(owner).give100To(owner.address);
    });

    // Borrowing tests are grouped into two suites: Borrowing Request and Funding.
    // In beforeEach() of "Borrowing request", we make sure there is 100 liquidity.

    describe("Post Approved Invoice Factoring", function () {
        // Makes sure there is liquidity in the pool for borrowing
        beforeEach(async function () {
            await humaPoolContract.connect(lender).deposit(200);
            await testTokenContract
                .connect(borrower)
                .approve(humaPoolContract.address, 99999);
        });

        afterEach(async function () {
            await humaConfigContract.setProtocolPaused(false);
        });

        it("Should only allow credit approvers to post approved loan requests", async function () {
            await expect(
                humaPoolContract
                    .connect(lender)
                    .postApprovedCreditRequest(borrower.address, 200, 30, 1)
            ).to.be.revertedWith("HumaPool:ILLEGAL_CREDIT_POSTER");
        });

        it("Should not allow posting approved loans while protocol is paused", async function () {
            await humaConfigContract.setProtocolPaused(true);
            await expect(
                humaPoolContract
                    .connect(creditApprover)
                    .postApprovedCreditRequest(borrower.address, 200, 30, 1)
            ).to.be.revertedWith("HumaPool:PROTOCOL_PAUSED");
        });

        it("Should not allow posting approved laons while pool is off", async function () {
            await humaPoolContract.disablePool();
            await expect(
                humaPoolContract
                    .connect(creditApprover)
                    .postApprovedCreditRequest(borrower.address, 200, 30, 1)
            ).to.be.revertedWith("HumaPool:POOL_NOT_ON");
        });

        it("Cannot post approved loan with amount lower than limit", async function () {
            await expect(
                humaPoolContract
                    .connect(creditApprover)
                    .postApprovedCreditRequest(borrower.address, 5, 30, 1)
            ).to.be.revertedWith("HumaPool:DENY_BORROW_SMALLER_THAN_LIMIT");
        });

        it("Cannot post approved loan with amount greater than limit", async function () {
            await expect(
                humaPoolContract
                    .connect(creditApprover)
                    .postApprovedCreditRequest(borrower.address, 9999, 30, 1)
            ).to.be.revertedWith("HumaPool:DENY_BORROW_GREATER_THAN_LIMIT");
        });

        it("Should post approved invoice financing successfully", async function () {
            expect(
                await testTokenContract.balanceOf(borrower.address)
            ).to.equal(0);

            await humaPoolContract.connect(owner).setInterestRateBasis(1200);

            await humaPoolContract
                .connect(creditApprover)
                .postApprovedCreditRequest(borrower.address, 200, 30, 1);

            const loanAddress = await humaPoolContract.creditMapping(
                borrower.address
            );

            const invoiceContract = await getInvoiceContractFromAddress(
                loanAddress,
                borrower
            );

            const invoiceInfo = await invoiceContract.getInvoiceInfo();

            expect(invoiceInfo._amount).to.equal(200);
        });

        describe("Invoice Factoring Funding", function () {
            beforeEach(async function () {
                await humaPoolContract
                    .connect(creditApprover)
                    .postApprovedCreditRequest(borrower.address, 200, 30, 1);
            });

            afterEach(async function () {
                await humaConfigContract.setProtocolPaused(false);
            });

            it("Should not allow loan funding while protocol is paused", async function () {
                await humaConfigContract.setProtocolPaused(true);
                await expect(
                    humaPoolContract.connect(borrower).originateCredit()
                ).to.be.revertedWith("HumaPool:PROTOCOL_PAUSED");
            });

            // todo This test throw VM Exception. More investigation needed
            it("Prevent loan funding before approval", async function () {
                // expect(
                //     await humaPoolContract.connect(borrower).originateCredit()
                // ).to.be.revertedWith("HumaPool:CREDIT_NOT_APPROVED");
            });

            it("Should fund successfully", async function () {
                const loanAddress = await humaPoolContract.creditMapping(
                    borrower.address
                );
                const invoiceContract = await getInvoiceContractFromAddress(
                    loanAddress,
                    borrower
                );
                await invoiceContract.approve();
                // expect(await invoiceContract.isApproved()).to.equal(true);

                await humaPoolContract.connect(borrower).originateCredit();

                expect(
                    await testTokenContract.balanceOf(borrower.address)
                ).to.equal(178);

                expect(
                    await testTokenContract.balanceOf(treasury.address)
                ).to.equal(22);

                expect(await humaPoolContract.getPoolLiquidity()).to.equal(0);
            });
        });

        // In "Payback".beforeEach(), make sure there is a loan funded.
        describe("Payback", function () {
            beforeEach(async function () {
                await humaPoolContract.connect(lender).deposit(200);
                await humaPoolContract
                    .connect(owner)
                    .setFees(20, 100, 0, 0, 0, 0);
                await humaPoolContract
                    .connect(creditApprover)
                    .postApprovedCreditRequest(borrower.address, 200, 30, 1);

                loanAddress = await humaPoolContract.creditMapping(
                    borrower.address
                );
                invoiceContract = await getInvoiceContractFromAddress(
                    loanAddress,
                    borrower
                );
                await invoiceContract.approve();
                await humaPoolContract.connect(borrower).originateCredit();
            });

            afterEach(async function () {
                await humaConfigContract.setProtocolPaused(false);
            });

            it("Should not allow payback while protocol is paused", async function () {
                await humaConfigContract.setProtocolPaused(true);
                await expect(
                    invoiceContract
                        .connect(borrower)
                        .makePayment(testTokenContract.address, 5)
                ).to.be.reverted;
            });

            // todo if the pool is stopped, shall we accept payback?

            it("Process payback", async function () {
                await ethers.provider.send("evm_increaseTime", [
                    25 * 24 * 3600,
                ]);

                await testTokenContract
                    .connect(borrower)
                    .approve(invoiceContract.address, 5);

                await invoiceContract
                    .connect(borrower)
                    .makePayment(testTokenContract.address, 210);

                expect(
                    await testTokenContract.balanceOf(borrower.address)
                ).to.equal(188);
            });
        });
    });
});
