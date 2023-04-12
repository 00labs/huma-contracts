/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {expect} = require("chai");
const {
    deployContracts,
    deployAndSetupPool,
    evmSnapshot,
    evmRevert,
    toToken,
} = require("./BaseTest");

describe("BaseCreditPoolReceivable", function () {
    let poolContract;
    let poolConfigContract;
    let hdtContract;
    let humaConfigContract;
    let feeManagerContract;
    let testTokenContract;
    let baseCreditPoolReceivableContract;
    let proxyOwner;
    let poolOwner;
    let lender;
    let borrower;
    let treasury;
    let evaluationAgent;
    let protocolOwner;
    let eaNFTContract;
    let eaServiceAccount;
    let pdsServiceAccount;
    let record;
    let recordStatic;
    let poolOperator;
    let poolOwnerTreasury;
    let sId;
    let minterRole;

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
            poolOperator,
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

        const BaseCreditPoolReceivable = await ethers.getContractFactory(
            "BaseCreditPoolReceivable"
        );
        baseCreditPoolReceivableContract = await BaseCreditPoolReceivable.deploy();
        minterRole = await baseCreditPoolReceivableContract.MINTER_ROLE();
        await baseCreditPoolReceivableContract.grantRole(minterRole, borrower.address);
        await poolConfigContract
            .connect(poolOwner)
            .setWhitelistedPaymentContract(baseCreditPoolReceivableContract.address, true);
    });

    beforeEach(async function () {
        sId = await evmSnapshot();
    });

    afterEach(async function () {
        if (sId) {
            const res = await evmRevert(sId);
        }
    });

    describe.only("BaseCreditPoolReceivable", function () {
        it("Only minter role can mint", async function () {
            await expect(
                baseCreditPoolReceivableContract
                    .connect(eaServiceAccount)
                    .safeMint(
                        eaServiceAccount.address,
                        poolContract.address,
                        testTokenContract.address,
                        100,
                        100,
                        "Test URI"
                    )
            ).to.be.revertedWith(
                `AccessControl: account ${eaServiceAccount.address.toLowerCase()} is missing role ${minterRole}`
            );
        });

        it("Safe mint stores correct details on chain", async function () {
            await baseCreditPoolReceivableContract
                .connect(borrower)
                .safeMint(
                    borrower.address,
                    poolContract.address,
                    testTokenContract.address,
                    1000,
                    100,
                    "Test URI"
                );

            expect(await baseCreditPoolReceivableContract.balanceOf(borrower.address)).to.equal(1);

            const tokenId = await baseCreditPoolReceivableContract.tokenOfOwnerByIndex(
                borrower.address,
                0
            );

            const tokenDetails = await baseCreditPoolReceivableContract.receivableInfoMapping(
                tokenId
            );
            expect(tokenDetails.baseCreditPool).to.equal(poolContract.address);
            expect(tokenDetails.paymentToken).to.equal(testTokenContract.address);
            expect(tokenDetails.receivableAmount).to.equal(1000);
            expect(tokenDetails.maturityDate).to.equal(100);
            expect(tokenDetails.balance).to.equal(0);

            const tokenURI = await baseCreditPoolReceivableContract.tokenURI(tokenId);
            expect(tokenURI).to.equal("Test URI");
        });

        it("Safe mint fails if using wrong payment token", async function () {
            await expect(
                baseCreditPoolReceivableContract
                    .connect(borrower)
                    .safeMint(
                        borrower.address,
                        poolContract.address,
                        poolContract.address,
                        1000,
                        100,
                        "Test URI"
                    )
            ).to.be.revertedWith("Payment token does not match pool underlying token");
        });

        describe("makePayment", async function () {
            beforeEach(async function () {
                await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);
                await poolContract
                    .connect(eaServiceAccount)
                    .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
                await poolContract.connect(borrower).drawdown(toToken(1_000_000));

                await baseCreditPoolReceivableContract
                    .connect(borrower)
                    .safeMint(
                        borrower.address,
                        poolContract.address,
                        testTokenContract.address,
                        1000,
                        100,
                        "Test URI"
                    );

                expect(
                    await baseCreditPoolReceivableContract.balanceOf(borrower.address)
                ).to.equal(1);

                await testTokenContract.connect(borrower).mint(borrower.address, toToken(2_000));
                await testTokenContract
                    .connect(borrower)
                    .approve(poolContract.address, toToken(2000));
            });

            it("makePayment emits event and sends funds", async function () {
                const tokenId = await baseCreditPoolReceivableContract.tokenOfOwnerByIndex(
                    borrower.address,
                    0
                );
                await expect(
                    baseCreditPoolReceivableContract.connect(borrower).makePayment(tokenId, 100)
                ).to.emit(poolContract, "PaymentMade");

                const tokenDetails = await baseCreditPoolReceivableContract.receivableInfoMapping(
                    tokenId
                );
                expect(tokenDetails.balance).to.equal(100);
            });

            it("makePayment fails if not being called by token owner", async function () {
                const tokenId = await baseCreditPoolReceivableContract.tokenOfOwnerByIndex(
                    borrower.address,
                    0
                );

                await expect(
                    baseCreditPoolReceivableContract.connect(poolOwner).makePayment(tokenId, 1000)
                ).to.be.revertedWith("Caller is not token owner");
            });

            it("makePayment fails if already paid off", async function () {
                const tokenId = await baseCreditPoolReceivableContract.tokenOfOwnerByIndex(
                    borrower.address,
                    0
                );

                await baseCreditPoolReceivableContract
                    .connect(borrower)
                    .makePayment(tokenId, 1000);

                await expect(
                    baseCreditPoolReceivableContract.connect(borrower).makePayment(tokenId, 1000)
                ).to.be.revertedWith("Receivable already paid");
            });

            it("makePayment fails if BaseCreditPool makePayment fails", async function () {
                const tokenId = await baseCreditPoolReceivableContract.tokenOfOwnerByIndex(
                    borrower.address,
                    0
                );
                await testTokenContract
                    .connect(borrower)
                    .approve(poolContract.address, toToken(0));

                await expect(
                    baseCreditPoolReceivableContract.connect(borrower).makePayment(tokenId, 0)
                ).to.be.revertedWithCustomError(poolContract, "zeroAmountProvided");
            });
        });
    });
});
