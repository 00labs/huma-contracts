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
describe("Huma Pool", function () {
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

        const HumaConfig = await ethers.getContractFactory("HumaConfig");
        humaConfigContract = await HumaConfig.deploy(treasury.address);
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
            humaConfigContract.address,
            humaCreditFactoryContract.address,
            humaPoolLockerFactoryContract.address,
            reputationTrackerFactoryContract.address
        );
    });

    beforeEach(async function () {
        const TestToken = await ethers.getContractFactory("TestToken");
        testTokenContract = await TestToken.deploy();

        await testTokenContract.approve(humaPoolFactoryContract.address, 99999);
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
        await humaPoolContract.setFees(20, 100, 0, 0, 0, 0);

        await testTokenContract.give1000To(lender.address);
        await testTokenContract
            .connect(lender)
            .approve(humaPoolContract.address, 300);
    });

    describe("Huma Pool Settings", function () {
        // todo Verify only pool admins can deployNewPool

        it("Should have correct liquidity post beforeEach() run", async function () {
            const lenderInfo = await humaPoolContract
                .connect(owner)
                .getLenderInfo(owner.address);
            expect(lenderInfo.amount).to.equal(100);
            expect(lenderInfo.mostRecentLoanTimestamp).to.not.equal(0);

            expect(await humaPoolContract.getPoolLiquidity()).to.equal(100);

            expect(await humaPoolContract.balanceOf(owner.address)).to.equal(
                100
            );
        });

        //setPoolLiquidityCap
        it("Should be able to change pool liquidity cap", async function () {
            await humaPoolContract.setPoolLiquidityCap(1000000);
            var [, , , , cap] = await humaPoolContract.getPoolSummary();

            expect(cap).to.equal(1000000);
        });

        it("Should have the right liquidity token and interest", async function () {
            var [token, interest] = await humaPoolContract.getPoolSummary();

            expect(token).to.equal(testTokenContract.address);
            expect(interest).to.equal(1200);
        });

        it("Should be able to set min and max credit size", async function () {
            await humaPoolContract.setMinMaxBorrowAmt(10, 1000);
            var [token, interest, min, max] =
                await humaPoolContract.getPoolSummary();

            expect(min).to.equal(10);
            expect(max).to.equal(1000);
        });

        it("Should disallow platform fee bps lower than protocol fee bps", async function () {
            await expect(
                humaPoolContract.setFees(20, 10, 0, 0, 0, 0)
            ).to.be.revertedWith(
                "HumaPool:PLATFORM_FEE_BPS_LESS_THAN_PROTOCOL_BPS"
            );
        });

        it("Set pool fees and parameters", async function () {
            var [interest, f1, f2, f3, f4, f5, f6] =
                await humaPoolContract.getPoolFees();
            expect(f1).to.equal(20);
            expect(f2).to.equal(100);
            expect(f3).to.equal(0);
            expect(f4).to.equal(0);
            expect(f5).to.equal(0);
            expect(f6).to.equal(0);
        });

        it("Shall have the protocol-level default-grace-period", async function () {
            let poolDefaultGracePeriod =
                await humaPoolContract.getPoolDefaultGracePeriod();
            expect(
                await humaConfigContract.getProtocolDefaultGracePeriod()
            ).to.equal(poolDefaultGracePeriod);
        });

        it("Shall be able to set new value for the default grace period", async function () {
            await humaPoolContract.setPoolDefaultGracePeriod(30 * 24 * 3600);

            expect(await humaPoolContract.getPoolDefaultGracePeriod()).to.equal(
                30 * 24 * 3600
            );
        });
    });

    describe("Deposit", function () {
        afterEach(async function () {
            await humaConfigContract.connect(owner).unpauseProtocol();
        });

        it("Cannot deposit while protocol is paused", async function () {
            await humaConfigContract.connect(owner).pauseProtocol();
            await expect(
                humaPoolContract.connect(lender).deposit(100)
            ).to.be.revertedWith("HumaPool:PROTOCOL_PAUSED");
        });

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
            expect(await humaPoolContract.getPoolLiquidity()).to.equal(200);

            expect(await humaPoolContract.balanceOf(lender.address)).to.equal(
                100
            );
            expect(await humaPoolContract.balanceOf(owner.address)).to.equal(
                100
            );
            expect(await humaPoolContract.totalSupply()).to.equal(200);
        });
    });

    // In beforeEach() of Withdraw, we make sure there is 100 liquidity provided.
    describe("Withdraw", function () {
        beforeEach(async function () {
            await humaPoolContract.connect(lender).deposit(100);
        });

        afterEach(async function () {
            await humaConfigContract.connect(owner).unpauseProtocol();
        });

        it("Should not withdraw while protocol is paused", async function () {
            await humaConfigContract.connect(owner).pauseProtocol();
            await expect(
                humaPoolContract.connect(lender).withdraw(100)
            ).to.be.revertedWith("HumaPool:PROTOCOL_PAUSED");
        });

        it("Should reject if the protocol is off", async function () {
            // to do. HumaPool.Withdraw shall reject with a code.
        });

        it("Should reject if the pool is off", async function () {
            // to do. HumaPool.Withdraw shall reject with a code.
        });

        it("Should reject when withdraw too early", async function () {
            await expect(
                humaPoolContract.connect(lender).withdraw(100)
            ).to.be.revertedWith("HumaPool:WITHDRAW_TOO_SOON");
        });

        it("Should reject if the withdraw amount is higher than deposit", async function () {
            const loanWithdrawalLockout =
                await humaPoolContract.getLoanWithdrawalLockoutPeriod();
            await ethers.provider.send("evm_increaseTime", [
                loanWithdrawalLockout.toNumber(),
            ]);
            await expect(
                humaPoolContract.connect(lender).withdraw(500)
            ).to.be.revertedWith("HumaPool:WITHDRAW_AMT_TOO_GREAT");
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

            expect(await humaPoolContract.getPoolLiquidity()).to.equal(100);

            expect(await humaPoolContract.balanceOf(lender.address)).to.equal(
                0
            );
            expect(await humaPoolContract.balanceOf(owner.address)).to.equal(
                100
            );
            expect(await humaPoolContract.totalSupply()).to.equal(100);
        });
    });
});
