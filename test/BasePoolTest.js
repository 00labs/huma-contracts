/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {expect} = require("chai");
const {
    deployContracts,
    deployAndSetupPool,
    toToken,
    evmSnapshot,
    evmRevert,
} = require("./BaseTest");

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
let poolOwnerTreasury;
let poolConfigContract2;
let sId;

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
            poolOwnerTreasury,
        ] = await ethers.getSigners();

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
            poolOperator,
            poolOwnerTreasury
        );
    });

    beforeEach(async function () {
        sId = await evmSnapshot();
    });

    afterEach(async function () {
        if (sId) {
            const res = await evmRevert(sId);
        }
    });

    describe("Approve lenders", function () {
        it("Non-operator shall not be able to approve lenders ", async function () {
            await expect(
                poolContract.connect(borrower).addApprovedLender(lender2.address)
            ).to.be.revertedWithCustomError(poolContract, "poolOperatorRequired");
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
            ).to.be.revertedWithCustomError(poolContract, "poolOperatorRequired");
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

    describe("Update and query core data", function () {
        it("Non-owner shall not be able to call updateCoreData", async function () {
            await expect(
                poolContract.connect(evaluationAgent).updateCoreData()
            ).to.be.revertedWithCustomError(poolConfigContract, "permissionDeniedNotAdmin");
        });
        it("Pool owner shall be able to call updateCoreData", async function () {
            await expect(poolContract.connect(poolOwner).updateCoreData())
                .to.emit(poolContract, "PoolCoreDataChanged")
                .withArgs(
                    poolOwner.address,
                    testTokenContract.address,
                    hdtContract.address,
                    humaConfigContract.address,
                    feeManagerContract.address
                );
            let result = await poolContract.connect(poolOwner).getCoreData();
            expect(result.underlyingToken_).to.equal(testTokenContract.address);
            expect(result.poolToken_).to.equal(hdtContract.address);
            expect(result.humaConfig_).to.equal(humaConfigContract.address);
            expect(result.feeManager_).to.equal(feeManagerContract.address);
        });
        it("Protocol owner shall be able to call updateCoreData", async function () {
            await expect(poolContract.connect(protocolOwner).updateCoreData())
                .to.emit(poolContract, "PoolCoreDataChanged")
                .withArgs(
                    protocolOwner.address,
                    testTokenContract.address,
                    hdtContract.address,
                    humaConfigContract.address,
                    feeManagerContract.address
                );
            let result = await poolContract.connect(protocolOwner).getCoreData();
            expect(result.underlyingToken_).to.equal(testTokenContract.address);
            expect(result.poolToken_).to.equal(hdtContract.address);
            expect(result.humaConfig_).to.equal(humaConfigContract.address);
            expect(result.feeManager_).to.equal(feeManagerContract.address);
        });
    });

    describe("Update and query Pool Config", function () {
        beforeEach(async function () {
            const BasePoolConfig = await ethers.getContractFactory("BasePoolConfig");
            poolConfigContract2 = await BasePoolConfig.connect(poolOwner).deploy();
            await poolConfigContract2.deployed();
            await poolConfigContract2.initialize(
                "Base Credit Pool2",
                hdtContract.address,
                humaConfigContract.address,
                feeManagerContract.address
            );
            await poolConfigContract2.connect(poolOwner).setAPR(1217);
        });
        it("Non-owner shall not be able to call pool config", async function () {
            await expect(
                poolContract.connect(evaluationAgent).setPoolConfig(poolConfigContract2.address)
            ).to.be.revertedWithCustomError(poolConfigContract, "permissionDeniedNotAdmin");
        });
        it("Shall reject setting pool config to the current value", async function () {
            await expect(
                poolContract.connect(poolOwner).setPoolConfig(poolConfigContract.address)
            ).to.be.revertedWithCustomError(poolContract, "sameValue");
        });

        it("Pool owner shall be able to call setPoolConfig", async function () {
            await expect(
                poolContract.connect(poolOwner).setPoolConfig(poolConfigContract2.address)
            )
                .to.emit(poolContract, "PoolConfigChanged")
                .withArgs(poolOwner.address, poolConfigContract2.address);
            expect(await poolContract.poolConfig()).to.equal(poolConfigContract2.address);
        });
        it("Protocol owner shall be able to call setPoolConfig", async function () {
            await expect(
                poolContract.connect(protocolOwner).setPoolConfig(poolConfigContract2.address)
            )
                .to.emit(poolContract, "PoolConfigChanged")
                .withArgs(protocolOwner.address, poolConfigContract2.address);
            expect(await poolContract.poolConfig()).to.equal(poolConfigContract2.address);
        });
    });

    describe("Deposit", function () {
        it("Cannot makeInitialDeposit while account is not pool owner or EA", async function () {
            await expect(
                poolContract.connect(lender).makeInitialDeposit(toToken(1))
            ).to.be.revertedWithCustomError(poolConfigContract, "notPoolOwnerTreasuryOrEA");
        });

        it("Cannot deposit while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pause();
            await expect(
                poolContract.connect(lender).deposit(toToken(1_000_000))
            ).to.be.revertedWithCustomError(poolContract, "protocolIsPaused");
        });

        it("Cannot deposit while pool is off", async function () {
            await poolContract.connect(poolOwner).disablePool();
            await expect(
                poolContract.connect(lender).deposit(toToken(1_000_000))
            ).to.be.revertedWithCustomError(poolContract, "poolIsNotOn");
        });

        it("Cannot deposit when pool max liquidity has been reached", async function () {
            let poolLiquidityCap = await poolConfigContract.poolLiquidityCap();
            let poolValue = await poolContract.totalPoolValue();
            let additionalCap = poolLiquidityCap - poolValue + 1;
            await testTokenContract.connect(lender).approve(poolContract.address, additionalCap);
            await expect(
                poolContract.connect(lender).deposit(additionalCap)
            ).to.be.revertedWithCustomError(poolContract, "exceededPoolLiquidityCap");
        });

        it("Cannot deposit zero amount", async function () {
            await testTokenContract
                .connect(lender)
                .approve(poolContract.address, toToken(1_000_000));
            await expect(poolContract.connect(lender).deposit(0)).to.be.revertedWithCustomError(
                poolContract,
                "zeroAmountProvided"
            );
        });

        it("Pool deposit works correctly", async function () {
            await testTokenContract
                .connect(lender)
                .approve(poolContract.address, toToken(1_000_000));
            await poolContract.connect(lender).deposit(toToken(1_000_000));

            expect(await poolContract.lastDepositTime(lender.address)).to.not.equal(0);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                toToken(6_000_000)
            );

            expect(await hdtContract.balanceOf(lender.address)).to.equal(toToken(3_000_000));
            expect(await hdtContract.balanceOf(poolOwnerTreasury.address)).to.equal(
                toToken(1_000_000)
            );
            expect(await hdtContract.totalSupply()).to.equal(toToken(6_000_000));
        });

        it("Unapproved lenders cannot deposit", async function () {
            await expect(
                poolContract.connect(borrower).deposit(toToken(1_000_000))
            ).to.be.revertedWithCustomError(poolContract, "permissionDeniedNotLender");
        });

        it("Removed lenders cannot deposit", async function () {
            await poolContract.connect(poolOperator).removeApprovedLender(lender.address);
            await expect(
                poolContract.connect(lender).deposit(toToken(1_000_000))
            ).to.be.revertedWithCustomError(poolContract, "permissionDeniedNotLender");
        });
    });

    // In beforeEach() of Withdraw, we make sure there is 100 liquidity provided.
    describe("Withdraw", function () {
        it("Should not withdraw while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pause();
            await expect(
                poolContract.connect(lender).withdraw(toToken(1_000_000))
            ).to.be.revertedWithCustomError(poolContract, "protocolIsPaused");
        });

        it("Should reject if the protocol is off", async function () {
            // to do. HumaPool.Withdraw shall reject with a code.
        });

        it("Should reject if the pool is off", async function () {
            // to do. HumaPool.Withdraw shall reject with a code.
        });

        it("Should reject when withdraw amount is 0", async function () {
            await expect(poolContract.connect(lender).withdraw(0)).to.be.revertedWithCustomError(
                poolContract,
                "zeroAmountProvided"
            );
        });

        it("Should reject when withdraw too early", async function () {
            await expect(
                poolContract.connect(lender).withdraw(toToken(1_000_000))
            ).to.be.revertedWithCustomError(poolContract, "withdrawTooSoon");
        });

        it("Should reject if the withdraw amount is higher than deposit", async function () {
            const loanWithdrawalLockout =
                await poolConfigContract.withdrawalLockoutPeriodInSeconds();
            await ethers.provider.send("evm_increaseTime", [loanWithdrawalLockout.toNumber()]);
            await ethers.provider.send("evm_mine", []);

            await expect(
                poolContract.connect(lender).withdraw(toToken(3_000_000))
            ).to.be.revertedWithCustomError(poolContract, "withdrawnAmountHigherThanBalance");
        });

        it("Pool withdrawal works correctly", async function () {
            const loanWithdrawalLockout =
                await poolConfigContract.withdrawalLockoutPeriodInSeconds();
            await ethers.provider.send("evm_increaseTime", [loanWithdrawalLockout.toNumber()]);
            await ethers.provider.send("evm_mine", []);

            await poolContract.connect(lender).withdraw(toToken(1_000_000));

            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                toToken(4_000_000)
            );

            expect(await hdtContract.balanceOf(lender.address)).to.equal(toToken(1_000_000));
            expect(await hdtContract.balanceOf(poolOwnerTreasury.address)).to.equal(
                toToken(1_000_000)
            );
            expect(await hdtContract.totalSupply()).to.equal(toToken(4_000_000));
        });

        it("Shall withdraw all balance successfully", async function () {
            const loanWithdrawalLockout =
                await poolConfigContract.withdrawalLockoutPeriodInSeconds();
            await ethers.provider.send("evm_increaseTime", [loanWithdrawalLockout.toNumber()]);
            await ethers.provider.send("evm_mine", []);

            await poolContract.connect(lender).withdrawAll();

            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                toToken(3_000_000)
            );

            expect(await hdtContract.balanceOf(lender.address)).to.equal(0);
            expect(await hdtContract.balanceOf(poolOwnerTreasury.address)).to.equal(
                toToken(1_000_000)
            );
            expect(await hdtContract.totalSupply()).to.equal(toToken(3_000_000));
        });

        it("Minimum liquidity requirements for pool owner and EA", async function () {
            const loanWithdrawalLockout =
                await poolConfigContract.withdrawalLockoutPeriodInSeconds();
            await ethers.provider.send("evm_increaseTime", [loanWithdrawalLockout.toNumber()]);
            await ethers.provider.send("evm_mine", []);

            await expect(
                poolContract.connect(poolOwnerTreasury).withdraw(toToken(10))
            ).to.be.revertedWithCustomError(poolConfigContract, "poolOwnerNotEnoughLiquidity");

            // Should succeed
            await poolContract.connect(evaluationAgent).withdraw(toToken(10));
            // Should fail
            await expect(
                poolContract.connect(evaluationAgent).withdraw(toToken(1_000_000))
            ).to.be.revertedWithCustomError(
                poolConfigContract,
                "evaluationAgentNotEnoughLiquidity"
            );
            // Update liquidity rate for EA to be lower
            await poolConfigContract.connect(poolOwner).setEARewardsAndLiquidity(625, 5);
            // Should succeed
            await poolContract.connect(evaluationAgent).withdraw(toToken(1_000_000));

            // Update liquidity rate for pool owner to be lower
            await poolConfigContract.connect(poolOwner).setPoolOwnerRewardsAndLiquidity(625, 1);
            // Should succeed
            await poolContract.connect(poolOwnerTreasury).withdraw(toToken(10));
        });
    });
});
