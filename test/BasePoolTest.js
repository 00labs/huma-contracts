/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {use, expect} = require("chai");
const {solidity} = require("ethereum-waffle");

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
describe("Base Pool - LP and Admin functions", function () {
    let poolContract;
    let hdtContract;
    let humaConfigContract;
    let testTokenContract;
    let feeManagerContract;
    let proxyOwner;
    let owner;
    let lender;
    let borrower;
    let borrower2;
    let treasury;
    let evaluationAgent;

    before(async function () {
        [owner, proxyOwner, lender, borrower, borrower2, treasury, evaluationAgent] =
            await ethers.getSigners();

        const HumaConfig = await ethers.getContractFactory("HumaConfig");
        humaConfigContract = await HumaConfig.deploy(treasury.address);
        humaConfigContract.setHumaTreasury(treasury.address);

        const feeManagerFactory = await ethers.getContractFactory("BaseFeeManager");
        feeManagerContract = await feeManagerFactory.deploy();

        await feeManagerContract.setFees(10, 100, 20, 100);
    });

    beforeEach(async function () {
        const TestToken = await ethers.getContractFactory("TestToken");
        testTokenContract = await TestToken.deploy();

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
        await hdtContract.initialize("Base Credit HDT", "CHDT", testTokenContract.address);

        const BaseCreditPool = await ethers.getContractFactory("BaseCreditPool");
        const poolImpl = await BaseCreditPool.deploy();
        await poolImpl.deployed();
        const poolProxy = await TransparentUpgradeableProxy.deploy(
            poolImpl.address,
            proxyOwner.address,
            []
        );
        await poolProxy.deployed();

        poolContract = BaseCreditPool.attach(poolProxy.address);
        await poolContract.initialize(
            hdtContract.address,
            humaConfigContract.address,
            feeManagerContract.address,
            "Base Credit Pool"
        );

        await hdtContract.setPool(poolContract.address);

        await testTokenContract.approve(poolContract.address, 100);

        await poolContract.enablePool();

        await testTokenContract.approve(poolContract.address, 100);

        await poolContract.makeInitialDeposit(100);

        expect(await poolContract.lastDepositTime(owner.address)).to.not.equal(0);
        expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(100);

        await poolContract.addEvaluationAgent(evaluationAgent.address);

        await poolContract.setAPR(1200); //bps
        await poolContract.setMinMaxBorrowAmount(10, 1000);
        await poolContract.enablePool();

        await testTokenContract.give1000To(lender.address);
        await testTokenContract.connect(lender).approve(poolContract.address, 400);
    });

    describe("Huma Pool Settings", function () {
        // todo Verify only pool admins can deployNewPool

        it("Should have correct liquidity post beforeEach() run", async function () {
            expect(await poolContract.lastDepositTime(owner.address)).to.not.equal(0);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(100);
            expect(await hdtContract.balanceOf(owner.address)).to.equal(100);

            const fees = await feeManagerContract.getFees();
            expect(fees._frontLoadingFeeFlat).to.equal(10);
            expect(fees._frontLoadingFeeBps).to.equal(100);
            expect(fees._lateFeeFlat).to.equal(20);
            expect(fees._lateFeeBps).to.equal(100);
        });

        //setPoolLiquidityCap
        it("Should be able to change pool liquidity cap", async function () {
            await poolContract.setPoolLiquidityCap(1000000);
            var [, , , , cap] = await poolContract.getPoolSummary();

            expect(cap).to.equal(1000000);
        });

        it("Should have the right liquidity token and interest", async function () {
            var [token, interest] = await poolContract.getPoolSummary();

            expect(token).to.equal(testTokenContract.address);
            expect(interest).to.equal(1200);
        });

        it("Should be able to set min and max credit size", async function () {
            await poolContract.setMinMaxBorrowAmount(10, 1000);
            var [token, interest, min, max] = await poolContract.getPoolSummary();

            expect(min).to.equal(10);
            expect(max).to.equal(1000);
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
            expect(await humaConfigContract.protocolDefaultGracePeriod()).to.equal(
                poolDefaultGracePeriodInSconds
            );
        });

        it("Shall be able to set new value for the default grace period", async function () {
            await poolContract.setPoolDefaultGracePeriod(30);

            expect(await poolContract.poolDefaultGracePeriodInSeconds()).to.equal(30 * 24 * 3600);
        });
    });

    describe("Deposit", function () {
        afterEach(async function () {
            await humaConfigContract.connect(owner).unpauseProtocol();
        });

        it("Cannot deposit while protocol is paused", async function () {
            await humaConfigContract.connect(owner).pauseProtocol();
            await expect(poolContract.connect(lender).deposit(100)).to.be.revertedWith(
                "PROTOCOL_PAUSED"
            );
        });

        it("Cannot deposit while pool is off", async function () {
            await poolContract.disablePool();
            await expect(poolContract.connect(lender).deposit(100)).to.be.revertedWith(
                "POOL_NOT_ON"
            );
        });

        it("Cannot deposit when pool max liquidity has been reached", async function () {
            // todo implement it
        });

        it("Cannot deposit if the deposit amount is larger than the lender's balance", async function () {
            // todo implement it
        });

        it("Pool deposit works correctly", async function () {
            await poolContract.connect(lender).deposit(100);

            expect(await poolContract.lastDepositTime(lender.address)).to.not.equal(0);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(200);

            expect(await hdtContract.balanceOf(lender.address)).to.equal(100);
            expect(await hdtContract.balanceOf(owner.address)).to.equal(100);
            expect(await hdtContract.totalSupply()).to.equal(200);
        });
    });

    // In beforeEach() of Withdraw, we make sure there is 100 liquidity provided.
    describe("Withdraw", function () {
        beforeEach(async function () {
            await poolContract.connect(lender).deposit(100);
        });

        afterEach(async function () {
            await humaConfigContract.connect(owner).unpauseProtocol();
        });

        it("Should not withdraw while protocol is paused", async function () {
            await humaConfigContract.connect(owner).pauseProtocol();
            await expect(poolContract.connect(lender).withdraw(100)).to.be.revertedWith(
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
            await expect(poolContract.connect(lender).withdraw(100)).to.be.revertedWith(
                "WITHDRAW_TOO_SOON"
            );
        });

        it("Should reject if the withdraw amount is higher than deposit", async function () {
            const loanWithdrawalLockout = await poolContract.withdrawalLockoutPeriodInSeconds();
            await ethers.provider.send("evm_increaseTime", [loanWithdrawalLockout.toNumber()]);
            await expect(poolContract.connect(lender).withdraw(500)).to.be.revertedWith(
                "WITHDRAW_AMT_TOO_GREAT"
            );
        });

        it("Pool withdrawal works correctly", async function () {
            // Increment block by lockout period
            const loanWithdrawalLockout = await poolContract.withdrawalLockoutPeriodInSeconds();
            await ethers.provider.send("evm_increaseTime", [loanWithdrawalLockout.toNumber()]);

            await poolContract.connect(lender).withdraw(100);

            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(100);

            expect(await hdtContract.balanceOf(lender.address)).to.equal(0);
            expect(await hdtContract.balanceOf(owner.address)).to.equal(100);
            expect(await hdtContract.totalSupply()).to.equal(100);
        });
    });
});
