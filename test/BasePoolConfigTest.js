/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {expect} = require("chai");
const {BigNumber: BN} = require("ethers");
const {deployContracts, deployAndSetupPool, toToken} = require("./BaseTest");

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
let poolOperator2;
let poolOwnerTreasury;
let poolConfig2;

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
            poolOperator,
            poolOperator2,
            poolOwnerTreasury,
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
    });

    describe("Pool config initialization", async function () {
        before(async function () {
            const BasePoolConfig = await ethers.getContractFactory("BasePoolConfig");
            poolConfig2 = await BasePoolConfig.connect(poolOwner).deploy();
            await poolConfig2.deployed();
        });
        it("Shall reject non-owner to call initialize()", async function () {
            await expect(
                poolConfig2
                    .connect(lender)
                    .initialize(
                        "Base Credit Pool",
                        hdtContract.address,
                        humaConfigContract.address,
                        feeManagerContract.address
                    )
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
        it("Shall reject zero address for poolToken", async function () {
            await expect(
                poolConfig2
                    .connect(poolOwner)
                    .initialize(
                        "Base Credit Pool",
                        ethers.constants.AddressZero,
                        humaConfigContract.address,
                        feeManagerContract.address
                    )
            ).to.be.revertedWithCustomError(poolConfig2, "zeroAddressProvided");
        });
        it("Shall reject zero address for pool config", async function () {
            await expect(
                poolConfig2
                    .connect(poolOwner)
                    .initialize(
                        "Base Credit Pool",
                        hdtContract.address,
                        ethers.constants.AddressZero,
                        feeManagerContract.address
                    )
            ).to.be.revertedWithCustomError(poolConfig2, "zeroAddressProvided");
        });
        it("Shall reject zero address for fee manager", async function () {
            await expect(
                poolConfig2
                    .connect(poolOwner)
                    .initialize(
                        "Base Credit Pool",
                        hdtContract.address,
                        humaConfigContract.address,
                        ethers.constants.AddressZero
                    )
            ).to.be.revertedWithCustomError(poolConfig2, "zeroAddressProvided");
        });
        it("Shall reject if the pool token is not supported by the protocol", async function () {
            await humaConfigContract
                .connect(protocolOwner)
                .setLiquidityAsset(testTokenContract.address, false);
            await expect(
                poolConfig2
                    .connect(poolOwner)
                    .initialize(
                        "Base Credit Pool",
                        hdtContract.address,
                        humaConfigContract.address,
                        feeManagerContract.address
                    )
            ).to.be.revertedWithCustomError(
                poolConfig2,
                "underlyingTokenNotApprovedForHumaProtocol"
            );
            await humaConfigContract
                .connect(protocolOwner)
                .setLiquidityAsset(testTokenContract.address, true);
        });
        it("Shall initialize successfull", async function () {
            await poolConfig2
                .connect(poolOwner)
                .initialize(
                    "Base Credit Pool",
                    hdtContract.address,
                    humaConfigContract.address,
                    feeManagerContract.address
                );
            expect(await poolConfig2.poolAprInBps()).to.equal(1500);
        });
        it("Shall reject repeated call to initialize()", async function () {
            await expect(
                poolConfig2
                    .connect(poolOwner)
                    .initialize(
                        "Base Credit Pool",
                        hdtContract.address,
                        humaConfigContract.address,
                        feeManagerContract.address
                    )
            ).to.revertedWith("Initializable: contract is already initialized");
        });
    });

    describe("Pool config admin functions", async function () {
        before(async function () {
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
                false, // BaseCreditPool
                poolOperator,
                poolOwnerTreasury
            );

            await poolConfigContract.connect(poolOwner).setWithdrawalLockoutPeriod(90);
            await poolConfigContract.connect(poolOwner).setPoolDefaultGracePeriod(60);
        });

        describe("Huma Pool Config Settings", function () {
            it("Should have correct liquidity post beforeEach() run", async function () {
                expect(await poolContract.lastDepositTime(poolOwnerTreasury.address)).to.not.equal(
                    0
                );
                expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                    toToken(5_000_000)
                );
                expect(await hdtContract.balanceOf(poolOwnerTreasury.address)).to.equal(
                    toToken(1_000_000)
                );
                const fees = await feeManagerContract.getFees();
                expect(fees._frontLoadingFeeFlat).to.equal(toToken(1000));
                expect(fees._frontLoadingFeeBps).to.equal(100);
                expect(fees._lateFeeFlat).to.equal(toToken(2000));
                expect(fees._lateFeeBps).to.equal(100);
            });

            //setPoolLiquidityCap
            describe("setPoolLiquidityCap", async function () {
                it("Should reject 0 pool liquidity cap", async function () {
                    await expect(
                        poolConfigContract.connect(poolOwner).setPoolLiquidityCap(0)
                    ).to.be.revertedWithCustomError(poolConfigContract, "zeroAmountProvided");
                });
                it("Should be able to change pool liquidity cap", async function () {
                    await poolConfigContract
                        .connect(poolOwner)
                        .setPoolLiquidityCap(toToken(10_000_000));
                    var [, , , , cap] = await poolConfigContract.getPoolSummary();

                    expect(cap).to.equal(toToken(10_000_000));
                });
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
            it("Should reject zaro amount as the max credit size", async function () {
                await expect(
                    poolConfigContract.connect(poolOwner).setMaxCreditLine(0)
                ).to.be.revertedWithCustomError(poolConfigContract, "zeroAmountProvided");
            });

            it("Should reject max credit size equal to or larger than 2^88", async function () {
                await expect(
                    poolConfigContract
                        .connect(poolOwner)
                        .setMaxCreditLine(BN.from(2).pow(BN.from(88)))
                ).to.be.revertedWithCustomError(poolConfigContract, "creditLineTooHigh");
            });

            it("Should be able to set max credit size", async function () {
                await poolConfigContract.connect(poolOwner).setMaxCreditLine(toToken(1_000_000));
                var [, , , max] = await poolConfigContract.getPoolSummary();

                expect(max).to.equal(toToken(1_000_000));
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

            describe("setPoolPayPeriod", async function () {
                it("Shall disallow non-admin to change pool pay period", async function () {
                    await expect(
                        poolConfigContract.connect(lender).setPoolPayPeriod(5)
                    ).to.be.revertedWithCustomError(
                        poolConfigContract,
                        "permissionDeniedNotAdmin"
                    );
                });
                it("Shall disallow zero-day pool pay period", async function () {
                    await expect(
                        poolConfigContract.connect(poolOwner).setPoolPayPeriod(0)
                    ).to.be.revertedWithCustomError(poolConfigContract, "zeroAmountProvided");
                });
                it("Shall be able to set the pay period for the pool", async function () {
                    await poolConfigContract.connect(poolOwner).setPoolPayPeriod(20);
                    expect(await poolConfigContract.payPeriodInDays()).to.equal(20);
                    await poolConfigContract.connect(poolOwner).setPoolPayPeriod(30);
                    expect(await poolConfigContract.payPeriodInDays()).to.equal(30);
                });
            });

            it("Should reject setting APR higher than 10000", async function () {
                await expect(
                    poolConfigContract.connect(poolOwner).setAPR(12170)
                ).to.revertedWithCustomError(
                    poolConfigContract,
                    "invalidBasisPointHigherThan10000"
                );
            });

            it("Should not allow non-pool-owner-or-huma-admin to change credit expiration before first drawdown", async function () {
                await expect(
                    poolConfigContract.connect(lender).setCreditApprovalExpiration(5)
                ).to.be.revertedWithCustomError(poolConfigContract, "permissionDeniedNotAdmin");
            });

            it("Should allow pool owner to change credit expiration before first drawdown", async function () {
                await expect(poolConfigContract.connect(poolOwner).setCreditApprovalExpiration(5))
                    .to.emit(poolConfigContract, "CreditApprovalExpirationChanged")
                    .withArgs(432000, poolOwner.address);
            });

            it("Should not set pool to zero address", async function () {
                await expect(
                    poolConfigContract.connect(poolOwner).setPool(ethers.constants.AddressZero)
                ).to.be.revertedWithCustomError(poolConfigContract, "zeroAddressProvided");
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
            it("Should reject zero address EA", async function () {
                await expect(
                    poolConfigContract
                        .connect(poolOwner)
                        .setEvaluationAgent(newNFTTokenId, ethers.constants.AddressZero)
                ).to.be.revertedWithCustomError(poolConfigContract, "zeroAddressProvided");
            });

            it("Should reject when non-poolOwner requests to change EA", async function () {
                await expect(
                    poolConfigContract
                        .connect(treasury)
                        .setEvaluationAgent(newNFTTokenId, evaluationAgent2.address)
                ).to.be.revertedWithCustomError(poolConfigContract, "permissionDeniedNotAdmin");
            });

            it("Should reject when the new evaluation agent has not met the liquidity requirements", async function () {
                await expect(
                    poolConfigContract
                        .connect(poolOwner)
                        .setEvaluationAgent(newNFTTokenId, evaluationAgent2.address)
                ).to.be.revertedWithCustomError(
                    poolConfigContract,
                    "evaluationAgentNotEnoughLiquidity"
                );
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

                await testTokenContract.mint(evaluationAgent2.address, toToken(2_000_000));
                await testTokenContract
                    .connect(evaluationAgent2)
                    .approve(poolContract.address, toToken(2_000_000));
                await poolContract
                    .connect(poolOperator)
                    .addApprovedLender(evaluationAgent2.address);
                await expect(
                    poolContract.connect(evaluationAgent2).deposit(toToken(2_000_000))
                ).to.emit(poolContract, "LiquidityDeposited");
                await expect(
                    poolConfigContract
                        .connect(poolOwner)
                        .setEvaluationAgent(yetAnotherNFTTokenId, evaluationAgent2.address)
                ).to.revertedWithCustomError(
                    poolConfigContract,
                    "proposedEADoesNotOwnProvidedEANFT"
                );
            });

            it("Should allow evaluation agent to be replaced when the old EA has rewards", async function () {
                const eaNFTId = await poolConfigContract.evaluationAgentId();

                // change to new EA
                await testTokenContract.mint(evaluationAgent2.address, toToken(2_000_000));
                await testTokenContract
                    .connect(evaluationAgent2)
                    .approve(poolContract.address, toToken(2_000_000));
                await poolContract
                    .connect(poolOperator)
                    .addApprovedLender(evaluationAgent2.address);
                await expect(
                    poolContract.connect(evaluationAgent2).deposit(toToken(2_000_000))
                ).to.emit(poolContract, "LiquidityDeposited");
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
                    );

                // change back to old EA
                await expect(
                    poolConfigContract
                        .connect(poolOwner)
                        .setEvaluationAgent(eaNFTId, evaluationAgent.address)
                )
                    .to.emit(poolConfigContract, "EvaluationAgentChanged")
                    .withArgs(
                        evaluationAgent2.address,
                        evaluationAgent.address,
                        eaNFTId,
                        poolOwner.address
                    );

                await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);
                console.log("done");
                await poolContract
                    .connect(eaServiceAccount)
                    .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
                console.log("done");
                await poolContract.connect(borrower).drawdown(toToken(1_000_000));
                console.log("done");
                // origination fee: 11000000000
                // first month interest: 10002739726
                let accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(4200547945);
                const eaIncome = BN.from("3150410958");
                expect(accruedIncome.eaIncome).to.equal(eaIncome);
                expect(accruedIncome.poolOwnerIncome).to.equal(1050136986);
                let oldBalance = await testTokenContract.balanceOf(evaluationAgent.address);

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
                    .withArgs(evaluationAgent.address, eaIncome, poolOwner.address);
                expect(await testTokenContract.balanceOf(evaluationAgent.address)).to.equal(
                    oldBalance.add(eaIncome)
                );
            });
            describe("Add and Remove Pool Operator", function () {
                it("Should disallow non-owner to add operators", async function () {
                    await expect(
                        poolConfigContract.connect(lender).addPoolOperator(poolOperator2.address)
                    ).to.be.revertedWith("Ownable: caller is not the owner");
                });

                it("Should reject 0 address operator", async function () {
                    await expect(
                        poolConfigContract
                            .connect(poolOwner)
                            .addPoolOperator(ethers.constants.AddressZero)
                    ).to.be.revertedWithCustomError(poolConfigContract, "zeroAddressProvided");
                });

                it("Should allow operator to be added", async function () {
                    expect(
                        await poolConfigContract
                            .connect(poolOwner)
                            .addPoolOperator(poolOperator2.address)
                    )
                        .to.emit(poolConfigContract, "PoolOperatorAdded")
                        .withArgs(poolOperator2.address, poolOwner.address);

                    expect(
                        await poolConfigContract
                            .connect(poolOwner)
                            .isOperator(poolOperator2.address)
                    ).to.equal(true);
                });

                it("Should reject add operator request if it is already an operator", async function () {
                    await expect(
                        poolConfigContract
                            .connect(poolOwner)
                            .addPoolOperator(poolOperator2.address)
                    ).to.be.revertedWithCustomError(poolConfigContract, "alreadyAnOperator");
                });

                it("Should disallow non-owner to remove a operator", async function () {
                    await expect(
                        poolConfigContract
                            .connect(lender)
                            .removePoolOperator(poolOperator2.address)
                    ).to.be.revertedWith("Ownable: caller is not the owner");

                    expect(await poolConfigContract.isOperator(poolOperator2.address)).to.equal(
                        true
                    );

                    await expect(
                        poolConfigContract
                            .connect(poolOperator2)
                            .removePoolOperator(poolOperator2.address)
                    ).to.be.revertedWith("Ownable: caller is not the owner");

                    expect(await poolConfigContract.isOperator(poolOperator2.address)).to.equal(
                        true
                    );
                });

                it("Should disallow removal of operator using zero address", async function () {
                    await expect(
                        poolConfigContract
                            .connect(poolOwner)
                            .removePoolOperator(ethers.constants.AddressZero)
                    ).to.be.revertedWithCustomError(poolConfigContract, "zeroAddressProvided");
                });

                it("Should reject attemp to removal a operator who is not a operator", async function () {
                    await expect(
                        poolConfigContract.connect(poolOwner).removePoolOperator(treasury.address)
                    ).to.be.revertedWithCustomError(poolConfigContract, "notOperator");
                });

                it("Should remove a operator successfully", async function () {
                    await expect(
                        poolConfigContract
                            .connect(poolOwner)
                            .removePoolOperator(poolOperator2.address)
                    )
                        .to.emit(poolConfigContract, "PoolOperatorRemoved")
                        .withArgs(poolOperator2.address, poolOwner.address);

                    expect(
                        await poolConfigContract
                            .connect(poolOwner)
                            .isOperator(poolOperator2.address)
                    ).to.equal(false);
                });

                it("Should allow removed operator to be added back", async function () {
                    expect(
                        await poolConfigContract
                            .connect(poolOwner)
                            .addPoolOperator(poolOperator2.address)
                    )
                        .to.emit(poolConfigContract, "PoolOperatorAdded")
                        .withArgs(poolOperator2.address, poolOwner.address);

                    expect(
                        await poolConfigContract
                            .connect(poolOwner)
                            .isOperator(poolOperator2.address)
                    ).to.equal(true);
                });
            });
        });
        describe("Distribute and reverse income outside pool contract", async function () {
            it("Shall reject distributeIncome call if not from the pool contract", async function () {
                await expect(
                    poolConfigContract.distributeIncome(10000)
                ).to.revertedWithCustomError(poolConfigContract, "notPool");
            });
            it("Shall reject reverseIncome call if not from the pool contract", async function () {
                await expect(poolConfigContract.reverseIncome(10000)).to.revertedWithCustomError(
                    poolConfigContract,
                    "notPool"
                );
            });
        });
        describe("setEARewardsAndLiquidity", async function () {
            it("Shall reject non-admin call setEARewardsAndLiquidity", async function () {
                await expect(
                    poolConfigContract.connect(lender).setEARewardsAndLiquidity(1000, 1000)
                ).to.revertedWithCustomError(poolConfigContract, "permissionDeniedNotAdmin");
            });
            it("Shall reject high than 10000 bps EA reward rate", async function () {
                await expect(
                    poolConfigContract.connect(poolOwner).setEARewardsAndLiquidity(15000, 1000)
                ).to.revertedWithCustomError(
                    poolConfigContract,
                    "invalidBasisPointHigherThan10000"
                );
            });
            it("Shall reject high than 10000 bps EA liquidity rate", async function () {
                await expect(
                    poolConfigContract.connect(poolOwner).setEARewardsAndLiquidity(1000, 15000)
                ).to.revertedWithCustomError(
                    poolConfigContract,
                    "invalidBasisPointHigherThan10000"
                );
            });

            it("Shall set reward rate and liquidity rate successfully", async function () {
                await expect(
                    poolConfigContract.connect(poolOwner).setEARewardsAndLiquidity(1000, 1000)
                )
                    .to.emit(poolConfigContract, "EARewardsAndLiquidityChanged")
                    .withArgs(1000, 1000, poolOwner.address);

                let result = await poolConfigContract.rewardsAndLiquidityRateForEA();
                expect(result.rewardRateInBpsForEA).to.equal(1000);
                expect(result.liquidityRateInBpsByEA).to.equal(1000);
            });
        });
        describe("setPoolOwnerRewardsAndLiquidity", async function () {
            it("Shall reject non-admin call setPoolOwnerRewardsAndLiquidity", async function () {
                await expect(
                    poolConfigContract.connect(lender).setPoolOwnerRewardsAndLiquidity(1000, 1000)
                ).to.revertedWithCustomError(poolConfigContract, "permissionDeniedNotAdmin");
            });
            it("Shall reject high than 10000 bps pool owner reward rate", async function () {
                await expect(
                    poolConfigContract
                        .connect(poolOwner)
                        .setPoolOwnerRewardsAndLiquidity(15000, 1000)
                ).to.revertedWithCustomError(
                    poolConfigContract,
                    "invalidBasisPointHigherThan10000"
                );
            });
            it("Shall reject high than 10000 bps pool owner liquidity rate", async function () {
                await expect(
                    poolConfigContract
                        .connect(poolOwner)
                        .setPoolOwnerRewardsAndLiquidity(1000, 15000)
                ).to.revertedWithCustomError(
                    poolConfigContract,
                    "invalidBasisPointHigherThan10000"
                );
            });

            it("Shall set reward rate and liquidity rate successfully", async function () {
                await expect(
                    poolConfigContract
                        .connect(poolOwner)
                        .setPoolOwnerRewardsAndLiquidity(1000, 1000)
                )
                    .to.emit(poolConfigContract, "PoolOwnerRewardsAndLiquidityChanged")
                    .withArgs(1000, 1000, poolOwner.address);

                let result = await poolConfigContract.rewardsAndLiquidityRateForPoolOwner();
                expect(result.rewardRateInBpsForPoolOwner).equal(1000);
                expect(result.liquidityRateInBpsByPoolOwner).equal(1000);
            });
        });
        describe("setFeeManager", async function () {
            it("Shall reject non-admin call seeFeeManager", async function () {
                await expect(
                    poolConfigContract.connect(lender).setFeeManager(feeManagerContract.address)
                ).to.revertedWithCustomError(poolConfigContract, "permissionDeniedNotAdmin");
            });
            it("Shall reject fee manager with zero address", async function () {
                await expect(
                    poolConfigContract
                        .connect(poolOwner)
                        .setFeeManager(ethers.constants.AddressZero)
                ).to.revertedWithCustomError(poolConfigContract, "zeroAddressProvided");
            });
            it("Shall allow pool owner to set fee manager successfully", async function () {
                await expect(
                    poolConfigContract.connect(poolOwner).setFeeManager(feeManagerContract.address)
                )
                    .to.emit(poolConfigContract, "FeeManagerChanged")
                    .withArgs(feeManagerContract.address, poolOwner.address);
            });
            it("Shall allow protocol owner to set fee manager successfully", async function () {
                await expect(
                    poolConfigContract
                        .connect(protocolOwner)
                        .setFeeManager(feeManagerContract.address)
                )
                    .to.emit(poolConfigContract, "FeeManagerChanged")
                    .withArgs(feeManagerContract.address, protocolOwner.address);
            });
        });
        describe("setHumaConfig", async function () {
            it("Shall reject non-admin call setHumaConfig", async function () {
                await expect(
                    poolConfigContract.connect(lender).setHumaConfig(humaConfigContract.address)
                ).to.revertedWithCustomError(poolConfigContract, "permissionDeniedNotAdmin");
            });
            it("Shall reject huma config with zero address", async function () {
                await expect(
                    poolConfigContract
                        .connect(poolOwner)
                        .setHumaConfig(ethers.constants.AddressZero)
                ).to.revertedWithCustomError(poolConfigContract, "zeroAddressProvided");
            });
            it("Shall allow pool owner to set Huma config", async function () {
                await expect(
                    poolConfigContract.connect(poolOwner).setHumaConfig(humaConfigContract.address)
                )
                    .to.emit(poolConfigContract, "HumaConfigChanged")
                    .withArgs(humaConfigContract.address, poolOwner.address);
            });
            it("Shall allow protocol owner to set Huma Config", async function () {
                await expect(
                    poolConfigContract
                        .connect(protocolOwner)
                        .setHumaConfig(humaConfigContract.address)
                )
                    .to.emit(poolConfigContract, "HumaConfigChanged")
                    .withArgs(humaConfigContract.address, protocolOwner.address);
            });
        });
        describe("setPoolName", async function () {
            it("Shall reject non-admin to call setPoolName", async function () {
                await expect(
                    poolConfigContract.connect(lender).setPoolName("NewName")
                ).to.revertedWithCustomError(poolConfigContract, "permissionDeniedNotAdmin");
            });
            it("Shall allow pool owner to set pool name", async function () {
                await expect(poolConfigContract.connect(poolOwner).setPoolName("NewName"))
                    .to.emit(poolConfigContract, "PoolNameChanged")
                    .withArgs("NewName", poolOwner.address);
            });
        });
        describe("setPoolOwnerTreasury", async function () {
            it("Shall reject non-admin to call setPoolOwnerTreasury", async function () {
                await expect(
                    poolConfigContract
                        .connect(lender)
                        .setPoolOwnerTreasury(poolOwnerTreasury.address)
                ).to.revertedWithCustomError(poolConfigContract, "permissionDeniedNotAdmin");
            });
            it("Shall disallow zero address for pool owner treasury", async function () {
                await expect(
                    poolConfigContract
                        .connect(poolOwner)
                        .setPoolOwnerTreasury(ethers.constants.AddressZero)
                ).to.revertedWithCustomError(poolConfigContract, "zeroAddressProvided");
            });
            it("Shall allow pool owner to call setPoolOwnerTreasury", async function () {
                await expect(
                    poolConfigContract
                        .connect(poolOwner)
                        .setPoolOwnerTreasury(poolOwnerTreasury.address)
                )
                    .to.emit(poolConfigContract, "PoolOwnerTreasuryChanged")
                    .withArgs(poolOwnerTreasury.address, poolOwner.address);
            });
        });
        describe("setPoolToken", async function () {
            it("Shall reject non-admin to call setPoolToken", async function () {
                await expect(
                    poolConfigContract.connect(lender).setPoolToken(hdtContract.address)
                ).to.revertedWithCustomError(poolConfigContract, "permissionDeniedNotAdmin");
            });
            it("Shall disallow zero address for pool token", async function () {
                await expect(
                    poolConfigContract
                        .connect(poolOwner)
                        .setPoolToken(ethers.constants.AddressZero)
                ).to.revertedWithCustomError(poolConfigContract, "zeroAddressProvided");
            });
            it("Shall allow pool owner to call setPoolToken", async function () {
                await expect(
                    poolConfigContract.connect(poolOwner).setPoolToken(hdtContract.address)
                )
                    .to.emit(poolConfigContract, "HDTChanged")
                    .withArgs(hdtContract.address, testTokenContract.address, poolOwner.address);
            });
        });
    });
});
