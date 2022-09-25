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
            await poolConfigContract.connect(poolOwner).setPoolLiquidityCap(10_000_000);
            var [, , , , cap] = await poolConfigContract.getPoolSummary();

            expect(cap).to.equal(10_000_000);
        });

        it("Should have the right liquidity token and interest", async function () {
            let summary = await poolConfigContract.getPoolSummary();

            expect(summary.token).to.equal(testTokenContract.address);
            expect(summary.apr).to.equal(1217);
            expect(summary.name).to.equal("TestToken");
            expect(summary.symbol).to.equal("USDC");
            expect(summary.decimals).to.equal(6);
            expect(summary.eaId).equal(1);
            expect(summary.eaNFTAddress).equal(eaNFTContract.address);
        });

        it("Should be able to set min and max credit size", async function () {
            await poolConfigContract.connect(poolOwner).setMaxCreditLine(1_000_000);
            var [, , , max] = await poolConfigContract.getPoolSummary();

            expect(max).to.equal(1_000_000);
        });

        it("Shall have the protocol-level default-grace-period", async function () {
            let poolDefaultGracePeriodInSconds =
                await poolConfigContract.poolDefaultGracePeriodInSeconds();
            expect(await humaConfigContract.protocolDefaultGracePeriodInSeconds()).to.equal(
                poolDefaultGracePeriodInSconds
            );
        });

        it("Shall be able to set new value for the default grace period", async function () {
            await poolConfigContract.connect(poolOwner).setPoolDefaultGracePeriod(30);

            expect(await poolConfigContract.poolDefaultGracePeriodInSeconds()).to.equal(
                30 * 24 * 3600
            );
        });

        it("Shall be able to set the pay period for the pool", async function () {
            await poolConfigContract.connect(poolOwner).setPoolPayPeriod(20);
            expect(await poolConfigContract.payPeriodInDays()).to.equal(20);
            await poolConfigContract.connect(poolOwner).setPoolPayPeriod(30);
            expect(await poolConfigContract.payPeriodInDays()).to.equal(30);
        });
    });

    describe("Change Evaluation Agent", async function () {
        before(async function () {
            newNFTTokenId = 2;
            // // Mint EANFT to the borrower
            // const tx = await eaNFTContract.mintNFT(evaluationAgent2.address, "");
            // const receipt = await tx.wait();
            // for (const evt of receipt.events) {
            //     if (evt.event === "NFTGenerated") {
            //         newNFTTokenId = evt.args[0];
            //     }
            // }
        });
        it("Should reject when non-poolOwner requests to change EA", async function () {
            await expect(
                poolConfigContract
                    .connect(treasury)
                    .setEvaluationAgent(newNFTTokenId, evaluationAgent2.address)
            ).to.be.revertedWith("permissionDeniedNotAdmin()");
        });
        it("Should reject when the new evaluation agent has not met the liquidity requirements", async function () {
            await expect(
                poolConfigContract
                    .connect(poolOwner)
                    .setEvaluationAgent(newNFTTokenId, evaluationAgent2.address)
            ).to.be.revertedWith("evaluationAgentNotEnoughLiquidity()");
        });
        it("Should allow evaluation agent to be replaced when the old EA has no rewards", async function () {
            await testTokenContract.mint(evaluationAgent2.address, 2_000_000);

            await testTokenContract
                .connect(evaluationAgent2)
                .approve(poolContract.address, 2_000_000);
            await poolContract.connect(poolOwner).addApprovedLender(evaluationAgent2.address);
            await expect(poolContract.connect(evaluationAgent2).deposit(2_000_000)).to.emit(
                poolContract,
                "LiquidityDeposited"
            );
            await expect(
                poolConfigContract
                    .connect(poolOwner)
                    .setEvaluationAgent(newNFTTokenId, evaluationAgent2.address)
            )
                .to.emit(poolConfigContract, "EvaluationAgentChanged")
                .withArgs(evaluationAgent.address, evaluationAgent2.address, poolOwner.address)
                .to.not.emit(poolConfigContract, "EvaluationAgentRewardsWithdrawn");
        });

        // todo need to add a test case to show reward distribution for the old evaluationAgent
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

        it("Unapproved lenders cannot deposit", async function () {
            await expect(poolContract.connect(borrower).deposit(1_000_000)).to.be.revertedWith(
                "permissionDeniedNotLender"
            );
        });

        it("Removed lenders cannot deposit", async function () {
            await poolContract.connect(poolOwner).removeApprovedLender(lender.address);
            await expect(poolContract.connect(lender).deposit(1_000_000)).to.be.revertedWith(
                "permissionDeniedNotLender"
            );
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
