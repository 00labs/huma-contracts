/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {expect} = require("chai");
const {deployContracts, deployAndSetupPool, advanceClock} = require("./BaseTest");

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

describe("Base Pool Config", function () {
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

        [humaConfigContract, feeManagerContract, testTokenContract, eaNFTContract] =
            await deployContracts(
                poolOwner,
                treasury,
                lender,
                protocolOwner,
                eaServiceAccount,
                pdsServiceAccount
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
            false // BaseCreditPool
        );

        await poolConfigContract.connect(poolOwner).setWithdrawalLockoutPeriod(90);
        await poolConfigContract.connect(poolOwner).setPoolDefaultGracePeriod(60);
    });

    describe("Huma Pool Config Settings", function () {
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

        it("Should reject setting APR higher than 10000", async function () {
            await expect(poolConfigContract.connect(poolOwner).setAPR(12170)).to.revertedWith(
                "invalidBasisPointHigherThan10000"
            );
        });

        it("Should not allow non-pool-owner-or-huma-admin to change credit expiration before first drawdown", async function () {
            await expect(
                poolConfigContract.connect(lender).setCreditApprovalExpiration(5)
            ).to.be.revertedWith("permissionDeniedNotAdmin");
        });

        it("Should allow pool owner to change credit expiration before first drawdown", async function () {
            await expect(poolConfigContract.connect(poolOwner).setCreditApprovalExpiration(5))
                .to.emit(poolConfigContract, "CreditApprovalExpirationChanged")
                .withArgs(432000, poolOwner.address);
        });
    });

    describe("Change Evaluation Agent", async function () {
        before(async function () {
            // Mint EANFT to the borrower
            const tx = await eaNFTContract.mintNFT(evaluationAgent2.address);
            const receipt = await tx.wait();
            for (const evt of receipt.events) {
                if (evt.event === "NFTGenerated") {
                    newNFTTokenId = evt.args.tokenId;
                }
            }
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

        it("Should reject when the proposed new EA does not own the EANFT", async function () {
            let yetAnotherNFTTokenId;
            const tx = await eaNFTContract.mintNFT(evaluationAgent.address);
            const receipt = await tx.wait();
            for (const evt of receipt.events) {
                if (evt.event === "NFTGenerated") {
                    yetAnotherNFTTokenId = evt.args.tokenId;
                }
            }

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
                    .setEvaluationAgent(yetAnotherNFTTokenId, evaluationAgent2.address)
            ).to.revertedWith("proposedEADoesNotOwnProvidedEANFT");
        });

        it("Should allow evaluation agent to be replaced when the old EA has rewards", async function () {
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(1_000_000);
            // origination fee: 11000
            // first month interest: 10002
            let accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(4200);
            expect(accruedIncome.eaIncome).to.equal(3150);
            expect(accruedIncome.poolOwnerIncome).to.equal(1050);
            let oldBalance = await testTokenContract.balanceOf(evaluationAgent.address);

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
                .withArgs(
                    evaluationAgent.address,
                    evaluationAgent2.address,
                    newNFTTokenId,
                    poolOwner.address
                )
                .to.emit(poolConfigContract, "EvaluationAgentRewardsWithdrawn")
                .withArgs(evaluationAgent.address, 3150, poolOwner.address);
            expect(await testTokenContract.balanceOf(evaluationAgent.address)).to.equal(
                3150 + Number(oldBalance)
            );
        });
    });
});
