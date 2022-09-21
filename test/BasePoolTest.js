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
// liquidity 10100 from the poolOwner
let poolContract;
let hdtContract;
let humaConfigContract;
let testTokenContract;
let feeManagerContract;
let defaultDeployer;
let proxyOwner;
let lender;
let borrower;
let borrower2;
let treasury;
let evaluationAgent;
let poolOwner;
let protocolOwner;
let eaNFTContract;

describe("Base Pool - LP and Admin functions", function () {
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
        ] = await ethers.getSigners();
    });

    beforeEach(async function () {
        [humaConfigContract, feeManagerContract, testTokenContract, eaNFTContract] =
            await deployContracts(poolOwner, treasury, lender, protocolOwner);

        [hdtContract, poolContract] = await deployAndSetupPool(
            poolOwner,
            proxyOwner,
            evaluationAgent,
            lender,
            humaConfigContract,
            feeManagerContract,
            testTokenContract,
            0,
            eaNFTContract
        );
    });

    describe("Huma Pool Settings", function () {
        // todo Verify only pool admins can deployNewPool

        it("Should have correct liquidity post beforeEach() run", async function () {
            expect(await poolContract.lastDepositTime(poolOwner.address)).to.not.equal(0);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(5_000_000);
            expect(await hdtContract.balanceOf(poolOwner.address)).to.equal(1_000_000);

            const fees = await feeManagerContract.getFees();
            expect(fees._frontLoadingFeeFlat).to.equal(1000);
            expect(fees._frontLoadingFeeBps).to.equal(100);
            expect(fees._lateFeeFlat).to.equal(2000);
            expect(fees._lateFeeBps).to.equal(100);
        });

        //setPoolLiquidityCap
        it("Should be able to change pool liquidity cap", async function () {
            await poolContract.connect(poolOwner).setPoolLiquidityCap(10_000_000);
            var [, , , , cap] = await poolContract.getPoolSummary();

            expect(cap).to.equal(10_000_000);
        });

        it("Should have the right liquidity token and interest", async function () {
            var [token, interest] = await poolContract.getPoolSummary();

            expect(token).to.equal(testTokenContract.address);
            expect(interest).to.equal(1217);
        });

        it("Should be able to set min and max credit size", async function () {
            await poolContract.connect(poolOwner).setMaxCreditLine(1_000_000);
            var [, , , max] = await poolContract.getPoolSummary();

            expect(max).to.equal(1_000_000);
        });

        // todo decide protocol fee calculation, and add this check to either setTreasuryFee() or setFees()
        // it("Should disallow platform fee bps lower than protocol fee bps", async function () {
        //     await expect(
        //         poolContract.setFees(20, 10, 0, 0)
        //     ).to.be.revertedWith("PLATFORM_FEE_LESS_THAN_PROTOCOL_FEE");
        // });

        it("Shall have the protocol-level default-grace-period", async function () {
            let poolDefaultGracePeriodInSconds =
                await poolContract.poolDefaultGracePeriodInSeconds();
            expect(await humaConfigContract.protocolDefaultGracePeriodInSeconds()).to.equal(
                poolDefaultGracePeriodInSconds
            );
        });

        it("Shall be able to set new value for the default grace period", async function () {
            await poolContract.connect(poolOwner).setPoolDefaultGracePeriod(30);

            expect(await poolContract.poolDefaultGracePeriodInSeconds()).to.equal(30 * 24 * 3600);
        });

        it("Shall be able to set the pay period for the pool", async function () {
            await poolContract.connect(poolOwner).setPoolPayPeriod(20);
            expect(await poolContract.payPeriodInDays()).to.equal(20);
            await poolContract.connect(poolOwner).setPoolPayPeriod(30);
            expect(await poolContract.payPeriodInDays()).to.equal(30);
        });
    });

    describe("Deposit", function () {
        afterEach(async function () {
            await humaConfigContract.connect(protocolOwner).unpauseProtocol();
        });

        it("Cannot deposit while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pauseProtocol();
            await expect(poolContract.connect(lender).deposit(1_000_000)).to.be.revertedWith(
                "PROTOCOL_PAUSED"
            );
        });

        it("Cannot deposit while pool is off", async function () {
            await poolContract.connect(poolOwner).disablePool();
            await expect(poolContract.connect(lender).deposit(1_000_000)).to.be.revertedWith(
                "POOL_NOT_ON"
            );
        });

        it("Cannot deposit when pool max liquidity has been reached", async function () {
            // todo implement it
        });

        it("Pool deposit works correctly", async function () {
            await testTokenContract.connect(lender).approve(poolContract.address, 1_000_000);
            await poolContract.connect(lender).deposit(1_000_000);

            expect(await poolContract.lastDepositTime(lender.address)).to.not.equal(0);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(6_000_000);

            expect(await hdtContract.balanceOf(lender.address)).to.equal(3_000_000);
            expect(await hdtContract.balanceOf(poolOwner.address)).to.equal(1_000_000);
            expect(await hdtContract.totalSupply()).to.equal(6_000_000);
        });
    });

    // In beforeEach() of Withdraw, we make sure there is 100 liquidity provided.
    describe("Withdraw", function () {
        afterEach(async function () {
            await humaConfigContract.connect(protocolOwner).unpauseProtocol();
        });

        it("Should not withdraw while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pauseProtocol();
            await expect(poolContract.connect(lender).withdraw(1_000_000)).to.be.revertedWith(
                "PROTOCOL_PAUSED"
            );
        });

        it("Should reject if the protocol is off", async function () {
            // to do. HumaPool.Withdraw shall reject with a code.
        });

        it("Should reject if the pool is off", async function () {
            // to do. HumaPool.Withdraw shall reject with a code.
        });

        it("Should reject when withdraw too early", async function () {
            await expect(poolContract.connect(lender).withdraw(1_000_000)).to.be.revertedWith(
                "WITHDRAW_TOO_SOON"
            );
        });

        it("Should reject if the withdraw amount is higher than deposit", async function () {
            const loanWithdrawalLockout = await poolContract.withdrawalLockoutPeriodInSeconds();
            await ethers.provider.send("evm_increaseTime", [loanWithdrawalLockout.toNumber()]);
            await expect(poolContract.connect(lender).withdraw(3_000_000)).to.be.revertedWith(
                "WITHDRAW_AMT_TOO_GREAT"
            );
        });

        it("Pool withdrawal works correctly", async function () {
            // Increment block by lockout period
            const loanWithdrawalLockout = await poolContract.withdrawalLockoutPeriodInSeconds();
            await ethers.provider.send("evm_increaseTime", [loanWithdrawalLockout.toNumber()]);

            await poolContract.connect(lender).withdraw(1_000_000);

            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(4_000_000);

            expect(await hdtContract.balanceOf(lender.address)).to.equal(1_000_000);
            expect(await hdtContract.balanceOf(poolOwner.address)).to.equal(1_000_000);
            expect(await hdtContract.totalSupply()).to.equal(4_000_000);
        });
    });
});
