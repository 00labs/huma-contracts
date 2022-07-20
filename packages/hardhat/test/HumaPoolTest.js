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
// In afterEach() of "Huma Pool", we should return the 100 initial liquidity
// to the owner so that owner has enough balance for future tests.
// Right now, due to a bug with initial liquidity, we mint 100 to owner.
describe("Huma Pool", function () {
    let humaPoolAdminsContract;
    let humaPoolFactoryContract;
    let humaPoolContract;
    let humaConfigContract;
    let humaLoanFactoryContract;
    let humaPoolLockerFactoryContract;
    let humaAPIClientContract;
    let testTokenContract;
    let owner;
    let lender;
    let borrower;
    let borrower2;
    let treasury;

    before(async function () {
        [owner, lender, borrower, borrower2] = await ethers.getSigners();

        const HumaPoolAdmins = await ethers.getContractFactory(
            "HumaPoolAdmins"
        );
        humaPoolAdminsContract = await HumaPoolAdmins.deploy();

        const HumaConfig = await ethers.getContractFactory("HumaConfig");
        humaConfigContract = await HumaConfig.deploy(
            owner.address,
            owner.address
        );

        const HumaLoanFactory = await ethers.getContractFactory(
            "HumaLoanFactory"
        );
        humaLoanFactoryContract = await HumaLoanFactory.deploy();

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
            humaLoanFactoryContract.address,
            humaPoolLockerFactoryContract.address,
            humaAPIClientContract.address
        );
    });

    beforeEach(async function () {
        const TestToken = await ethers.getContractFactory("TestToken");
        testTokenContract = await TestToken.deploy();

        await testTokenContract.approve(humaPoolFactoryContract.address, 99999);
        const tx = await humaPoolFactoryContract.deployNewPool(
            testTokenContract.address,
            100
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

        await humaPoolContract.setInterestRateBasis(1200); //bps
        await humaPoolContract.setMaxLoanAmount(100);
        await humaPoolContract.enablePool();
        await humaPoolContract.setFees(10, 0, 0, 0, 0, 0);

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

    // Test all the pool admin functions
    describe("Huma Pool Admin", function () {
        it("Pool loan helper can only be approved by master admin", async function () {
            await humaPoolContract.setHumaPoolLoanHelper(
                "0x0000000000000000000000000000000000000001"
            );

            // Cannot deposit while helper not approved
            await expect(
                humaPoolContract.connect(lender).deposit(100)
            ).to.be.revertedWith("HumaPool:POOL_LOAN_HELPER_NOT_APPROVED");

            // Pool cannot be approved by non-master admin
            await expect(
                humaPoolContract
                    .connect(lender)
                    .setHumaPoolLoanHelperApprovalStatus(true)
            ).to.be.revertedWith("HumaPool:PERMISSION_DENIED_NOT_MASTER_ADMIN");

            // Approval by master admin should work
            await humaPoolContract.setHumaPoolLoanHelperApprovalStatus(true);

            // Deposit should work
            await humaPoolContract.connect(lender).deposit(100);
        });

        it("Only pool owner and master admin can edit pool settings", async function () {
            // Transfer ownership of pool to other account
            await humaPoolContract.transferOwnership(lender.address);

            // Master admin should succeed
            await humaPoolContract.setHumaPoolLoanHelper(
                "0x0000000000000000000000000000000000000000"
            );

            // Owner should succeed
            await humaPoolContract
                .connect(lender)
                .setHumaPoolLoanHelper(
                    "0x0000000000000000000000000000000000000000"
                );

            // Non-owner should fail
            await expect(
                humaPoolContract
                    .connect(borrower)
                    .setHumaPoolLoanHelper(
                        "0x0000000000000000000000000000000000000000"
                    )
            ).to.be.revertedWith("HumaPool:PERMISSION_DENIED_NOT_ADMIN");
        });
    });

    describe("Huma Pool Settings", function () {
        it("Set pool fees and parameters", async function () {
            var [maxLoanAmount, interest, f1, f2, f3, f4, f5, f6] =
                await humaPoolContract.getPoolSettings();
            expect(maxLoanAmount).to.equal(100);
            expect(interest).to.equal(1200);
            expect(f1).to.equal(10);
            expect(f2).to.equal(0);
            expect(f3).to.equal(0);
            expect(f4).to.equal(0);
            expect(f5).to.equal(0);
            expect(f6).to.equal(0);
        });
    });

    describe("Deposit", function () {
        it("Cannot deposit while pool is off", async function () {
            await humaPoolContract.disablePool();
            await expect(
                humaPoolContract.connect(lender).deposit(100)
            ).to.be.revertedWith("HumaPool:POOL_NOT_ON");
        });

        it("Cannot deposit when pool max liquidity has been reached", async function () {
            // todo implement it
        });

        it("Cannot deposit if the deposit amount is larger than the lender's balance", async function () {
            // todo implement it
        });

        it("Pool deposit works correctly", async function () {
            await humaPoolContract.connect(lender).deposit(100);
            const lenderInfo = await humaPoolContract
                .connect(lender)
                .getLenderInfo(lender.address);
            expect(lenderInfo.amount).to.equal(100);
            expect(lenderInfo.mostRecentLoanTimestamp).to.not.equal(0);
            // todo update 100 to 200 once the bug for HumaPoolFactory bookkeeps initialLiquidity
            expect(await humaPoolContract.getPoolLiquidity()).to.equal(100);
        });
    });

    // In beforeEach() of Withdraw, we make sure there is 100 liquidity provided.
    describe("Withdraw", function () {
        beforeEach(async function () {
            await humaPoolContract.connect(lender).deposit(100);
        });

        it("Should reject if the protocol is off", async function () {
            // to do. HumaPool.Withdraw shall reject with a code.
        });

        it("Should reject if the pool is off", async function () {
            // to do. HumaPool.Withdraw shall reject with a code.
        });

        it("Should reject if the withdraw amount is higher than deposit", async function () {
            await expect(
                humaPoolContract.connect(lender).withdraw(500)
            ).to.be.revertedWith("HumaPool:WITHDRAW_AMT_TOO_GREAT");
        });

        it("Should reject when withdraw too early", async function () {
            await expect(
                humaPoolContract.connect(lender).withdraw(100)
            ).to.be.revertedWith("HumaPool:WITHDRAW_TOO_SOON");
        });

        it("Pool withdrawal works correctly", async function () {
            // Increment block by lockout period
            const loanWithdrawalLockout =
                await humaPoolContract.getLoanWithdrawalLockoutPeriod();
            await ethers.provider.send("evm_increaseTime", [
                loanWithdrawalLockout.toNumber(),
            ]);

            await humaPoolContract.connect(lender).withdraw(100);

            const lenderInfo = await humaPoolContract
                .connect(lender)
                .getLenderInfo(lender.address);
            expect(lenderInfo.amount).to.equal(0);
        });
    });

    // Borrowing tests are grouped into two suites: Borrowing Request and Funding.
    // In beforeEach() of "Borrowing request", we make sure there is 100 liquidity.

    // Borrowing tests are grouped into two suites: Borrowing Request and Funding.
    // In beforeEach() of "Borrowing request", we make sure there is 100 liquidity.
    describe("Borrowing request", function () {
        // Makes sure there is liquidity in the pool for borrowing
        beforeEach(async function () {
            await humaPoolContract.connect(lender).deposit(101);
            await testTokenContract
                .connect(borrower)
                .approve(humaPoolContract.address, 99999);
        });

        it("Cannot request loan while the protocol is paused", async function () {
            // todo coordinate with HumaPool change to implement it
        });

        it("Cannot request loan while pool is off", async function () {
            await humaPoolContract.disablePool();
            await expect(
                humaPoolContract.connect(borrower).requestLoan(100, 30, 12)
            ).to.be.revertedWith("HumaPool:POOL_NOT_ON");
        });

        it("Cannot request loan greater than limit", async function () {
            await expect(
                humaPoolContract.connect(borrower).requestLoan(9999, 30, 12)
            ).to.be.revertedWith("HumaPool:DENY_BORROW_GREATER_THAN_LIMIT");
        });

        it("Loan initiates correctly", async function () {
            expect(
                await testTokenContract.balanceOf(borrower.address)
            ).to.equal(0);

            await humaPoolContract.connect(owner).setInterestRateBasis(1200);

            await testTokenContract
                .connect(borrower)
                .approve(humaPoolContract.address, 0);

            await expect(
                humaPoolContract.connect(borrower).requestLoan(10, 1000, 10)
            ).to.be.revertedWith("HumaPool:DENY_NO_ALLOWANCE");

            await testTokenContract
                .connect(borrower)
                .approve(humaPoolContract.address, 999999);

            await humaPoolContract.connect(borrower).requestLoan(100, 30, 12);

            const loanAddress = await humaPoolContract.creditMapping(
                borrower.address
            );
            const loanContract = await getLoanContractFromAddress(
                loanAddress,
                borrower
            );

            const loanInformation = await loanContract.getLoanInformation();
            expect(loanInformation._id).to.equal(1);
            expect(loanInformation._amount).to.equal(100);
            expect(loanInformation._paybackPerInterval).to.equal(0);
            expect(loanInformation._paybackInterval).to.equal(30);
            expect(loanInformation._interestRateBasis).to.equal(1200);
        });

        describe("Loan Id", function () {
            it("LoanId", async function () {
                await testTokenContract
                    .connect(borrower2)
                    .approve(humaPoolContract.address, 10);
                // Test that id increments
                await humaPoolContract
                    .connect(borrower2)
                    .requestLoan(10, 1000, 10);
                const loanAddress2 = await humaPoolContract.creditMapping(
                    borrower2.address
                );
                const loanContract2 = await getLoanContractFromAddress(
                    loanAddress2,
                    borrower2
                );
                const loanInformation2 =
                    await loanContract2.getLoanInformation();
                expect(loanInformation2._id).to.equal(2);
            });
        });

        describe("Loan Funding", function () {
            beforeEach(async function () {
                await humaPoolContract
                    .connect(borrower)
                    .requestLoan(100, 30, 12);
            });

            //Borrowing with existing loans should fail
            it("Should not allow repeated loans for the same wallet", async function () {
                await expect(
                    humaPoolContract.connect(borrower).requestLoan(10, 1000, 10)
                ).to.be.revertedWith("HumaPool:DENY_BORROW_EXISTING_LOAN");
            });

            // todo This test throw VM Exception. More investigation needed
            it("Prevent loan funding before approval", async function () {
                // expect(
                //     await humaPoolContract.connect(borrower).originateLoan()
                // ).to.be.revertedWith("HumaPool:LOAN_NOT_APPROVED");
            });

            it("Funding", async function () {
                const loanAddress = await humaPoolContract.creditMapping(
                    borrower.address
                );
                const loanContract = await getLoanContractFromAddress(
                    loanAddress,
                    borrower
                );
                await loanContract.approve();
                // expect(await loanContract.isApproved()).to.equal(true);

                await humaPoolContract.connect(borrower).originateLoan();

                expect(
                    await testTokenContract.balanceOf(borrower.address)
                ).to.equal(90);

                // Check the amount in the treasury.
                // todo this does not work, not sure if it is test error or contract error.
                // expect(await testTokenContract.balanceOf(owner.address)).to.equal(
                //   10
                // );

                expect(await humaPoolContract.getPoolLiquidity()).to.equal(1);
            });
        });

        // In "Payback".beforeEach(), make sure there is a loan funded.
        describe("Payback", function () {
            beforeEach(async function () {
                await humaPoolContract.connect(lender).deposit(100);
                await humaPoolContract
                    .connect(owner)
                    .setInterestRateBasis(1200);
                await humaPoolContract
                    .connect(borrower)
                    .requestLoan(100, 30, 12);

                loanAddress = await humaPoolContract.creditMapping(
                    borrower.address
                );
                loanContract = await getLoanContractFromAddress(
                    loanAddress,
                    borrower
                );
                await loanContract.approve();
                await humaPoolContract.connect(borrower).originateLoan();
            });

            // todo if the protocol is paused, shall we accept payback?

            // todo if the pool is stopped, shall we accept payback?

            it("Process payback", async function () {
                await ethers.provider.send("evm_increaseTime", [
                    30 * 24 * 3600,
                ]);

                const loanInformation = await loanContract.getLoanInformation();
                console.log("amount", loanInformation._amount);
                console.log(
                    "amount per payback",
                    loanInformation._paybackPerInterval
                );
                console.log(
                    "payback interval",
                    loanInformation._paybackInterval
                );
                console.log(
                    "interest rate",
                    loanInformation._interestRateBasis
                );
                console.log("Next due date", loanInformation._nextDueDate);
                console.log(
                    "principal paid back",
                    loanInformation._principalPaidBack
                );
                console.log(
                    "remaining payments",
                    loanInformation._remainingPayments
                );
                console.log(
                    "number of payments",
                    loanInformation._numOfPayments
                );

                console.log(
                    ethers.utils.formatEther(
                        await testTokenContract.balanceOf(borrower.address)
                    )
                );

                // todo the test complains not enough balance in the test account. Thre is a bug in the code.
                // await loanContract
                //   .connect(borrower)
                //   .makePayment(testTokenContract.address, 20);
                // expect(loanInformation._amountPaidBack).to.equal(20);
            });
        });
    });
});
