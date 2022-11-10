/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {use, expect} = require("chai");
const {solidity} = require("ethereum-waffle");
const {deployContracts, deployAndSetupPool, advanceClock} = require("./BaseTest");

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
let poolConfigContract;
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
let eaServiceAccount;
let pdsServiceAccount;
let newNFTTokenId;
let evaluationAgent2;
let poolOperator;
let lender2;

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
            eaServiceAccount,
            pdsServiceAccount,
            evaluationAgent2,
            poolOperator,
            lender2,
        ] = await ethers.getSigners();
    });

    beforeEach(async function () {
        [humaConfigContract, feeManagerContract, testTokenContract, eaNFTContract] =
            await deployContracts(
                poolOwner,
                treasury,
                lender,
                protocolOwner,
                evaluationAgent,
                evaluationAgent
            );

        [hdtContract, poolConfigContract, poolContract] = await deployAndSetupPool(
            poolOwner,
            proxyOwner,
            evaluationAgent,
            lender,
            humaConfigContract,
            feeManagerContract,
            testTokenContract,
            0,
            eaNFTContract,
            false,
            poolOperator
        );
    });

    describe("Approve lenders", function () {
        it("Non-operator shall not be able to approve lenders ", async function () {
            await expect(
                poolContract.connect(borrower).addApprovedLender(lender2.address)
            ).to.be.revertedWith("poolOperatorRequired()");
        });
        it("Shall be able to approve lenders successfully ", async function () {
            await expect(poolContract.connect(poolOperator).addApprovedLender(lender2.address))
                .to.emit(poolContract, "AddApprovedLender")
                .withArgs(lender2.address, poolOperator.address);
            expect(
                await poolContract.connect(poolOperator).isApprovedLender(lender2.address)
            ).to.equal(true);
        });
        it("Non-operator shall not be able to remove approved lenders ", async function () {
            await expect(
                poolContract.connect(borrower).removeApprovedLender(lender2.address)
            ).to.be.revertedWith("poolOperatorRequired()");
        });
        it("Shall be able to remove approved lenders successfully ", async function () {
            await expect(poolContract.connect(poolOperator).removeApprovedLender(lender2.address))
                .to.emit(poolContract, "RemoveApprovedLender")
                .withArgs(lender2.address, poolOperator.address);
            expect(
                await poolContract.connect(poolOperator).isApprovedLender(lender2.address)
            ).to.equal(false);
        });
    });

    describe("Deposit", function () {
        afterEach(async function () {
            if (await humaConfigContract.connect(protocolOwner).paused())
                await humaConfigContract.connect(protocolOwner).unpause();
        });

        it("Cannot deposit while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pause();
            await expect(poolContract.connect(lender).deposit(1_000_000)).to.be.revertedWith(
                "protocolIsPaused()"
            );
        });

        it("Cannot deposit while pool is off", async function () {
            await poolContract.connect(poolOwner).disablePool();
            await expect(poolContract.connect(lender).deposit(1_000_000)).to.be.revertedWith(
                "poolIsNotOn()"
            );
        });

        it("Cannot deposit when pool max liquidity has been reached", async function () {
            let poolLiquidityCap = await poolConfigContract.poolLiquidityCap();
            let poolValue = await poolContract.totalPoolValue();
            let additionalCap = poolLiquidityCap - poolValue + 1;
            await testTokenContract.connect(lender).approve(poolContract.address, additionalCap);
            await expect(poolContract.connect(lender).deposit(additionalCap)).to.be.revertedWith(
                "exceededPoolLiquidityCap"
            );
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

        it("Unapproved lenders cannot deposit", async function () {
            await expect(poolContract.connect(borrower).deposit(1_000_000)).to.be.revertedWith(
                "permissionDeniedNotLender"
            );
        });

        it("Removed lenders cannot deposit", async function () {
            await poolContract.connect(poolOperator).removeApprovedLender(lender.address);
            await expect(poolContract.connect(lender).deposit(1_000_000)).to.be.revertedWith(
                "permissionDeniedNotLender"
            );
        });
    });

    // In beforeEach() of Withdraw, we make sure there is 100 liquidity provided.
    describe("Withdraw", function () {
        afterEach(async function () {
            if (await humaConfigContract.connect(protocolOwner).paused())
                await humaConfigContract.connect(protocolOwner).unpause();
        });

        it("Should not withdraw while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pause();
            await expect(poolContract.connect(lender).withdraw(1_000_000)).to.be.revertedWith(
                "protocolIsPaused()"
            );
        });

        it("Should reject if the protocol is off", async function () {
            // to do. HumaPool.Withdraw shall reject with a code.
        });

        it("Should reject if the pool is off", async function () {
            // to do. HumaPool.Withdraw shall reject with a code.
        });

        it("Should reject when withdraw amount is 0", async function () {
            await expect(poolContract.connect(lender).withdraw(0)).to.be.revertedWith(
                "zeroAmountProvided()"
            );
        });

        it("Should reject when withdraw too early", async function () {
            await expect(poolContract.connect(lender).withdraw(1_000_000)).to.be.revertedWith(
                "withdrawTooSoon()"
            );
        });

        it("Should reject if the withdraw amount is higher than deposit", async function () {
            const loanWithdrawalLockout =
                await poolConfigContract.withdrawalLockoutPeriodInSeconds();
            await ethers.provider.send("evm_increaseTime", [loanWithdrawalLockout.toNumber()]);
            await ethers.provider.send("evm_mine", []);

            await expect(poolContract.connect(lender).withdraw(3_000_000)).to.be.revertedWith(
                "withdrawnAmountHigherThanBalance()"
            );
        });

        it("Pool withdrawal works correctly", async function () {
            const loanWithdrawalLockout =
                await poolConfigContract.withdrawalLockoutPeriodInSeconds();
            await ethers.provider.send("evm_increaseTime", [loanWithdrawalLockout.toNumber()]);
            await ethers.provider.send("evm_mine", []);

            await poolContract.connect(lender).withdraw(1_000_000);

            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(4_000_000);

            expect(await hdtContract.balanceOf(lender.address)).to.equal(1_000_000);
            expect(await hdtContract.balanceOf(poolOwner.address)).to.equal(1_000_000);
            expect(await hdtContract.totalSupply()).to.equal(4_000_000);
        });

        it("Minimum liquidity requirements for pool owner and EA", async function () {
            const loanWithdrawalLockout =
                await poolConfigContract.withdrawalLockoutPeriodInSeconds();
            await ethers.provider.send("evm_increaseTime", [loanWithdrawalLockout.toNumber()]);
            await ethers.provider.send("evm_mine", []);

            await expect(poolContract.connect(poolOwner).withdraw(10)).to.be.revertedWith(
                "poolOwnerNotEnoughLiquidity()"
            );

            // Should succeed
            await poolContract.connect(evaluationAgent).withdraw(10);
            // Should fail
            await expect(
                poolContract.connect(evaluationAgent).withdraw(1_000_000)
            ).to.be.revertedWith("evaluationAgentNotEnoughLiquidity");
            // Update liquidity rate for EA to be lower
            await poolConfigContract.connect(poolOwner).setEARewardsAndLiquidity(625, 5);
            // Should succeed
            await poolContract.connect(evaluationAgent).withdraw(1_000_000);

            // Update liquidity rate for pool owner to be lower
            await poolConfigContract.connect(poolOwner).setPoolOwnerRewardsAndLiquidity(625, 1);
            // Should succeed
            await poolContract.connect(poolOwner).withdraw(10);
        });
    });
});
