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

describe.only("RealWorldReceivable Contract", function () {
    let poolContract;
    let poolConfigContract;
    let humaConfigContract;
    let feeManagerContract;
    let testTokenContract;
    let realWorldReceivableContract;
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

        const TransparentUpgradeableProxy = await ethers.getContractFactory(
            "TransparentUpgradeableProxy"
        );

        const RealWorldReceivable = await ethers.getContractFactory("RealWorldReceivable");
        const rwrImpl = await RealWorldReceivable.deploy();
        await rwrImpl.deployed();
        const rwrProxy = await TransparentUpgradeableProxy.deploy(
            rwrImpl.address,
            proxyOwner.address,
            []
        );
        await rwrProxy.deployed();
        realWorldReceivableContract = RealWorldReceivable.attach(rwrProxy.address);
        await realWorldReceivableContract.initialize();

        minterRole = await realWorldReceivableContract.MINTER_ROLE();
        await realWorldReceivableContract.grantRole(minterRole, borrower.address);
    });

    beforeEach(async function () {
        sId = await evmSnapshot();
    });

    afterEach(async function () {
        if (sId) {
            const res = await evmRevert(sId);
        }
    });

    describe("RealWorldReceivable", function () {
        it("Only minter role can mint", async function () {
            await expect(
                realWorldReceivableContract
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
            await realWorldReceivableContract
                .connect(borrower)
                .safeMint(
                    borrower.address,
                    poolContract.address,
                    testTokenContract.address,
                    1000,
                    100,
                    "Test URI"
                );

            expect(await realWorldReceivableContract.balanceOf(borrower.address)).to.equal(1);

            const tokenId = await realWorldReceivableContract.tokenOfOwnerByIndex(
                borrower.address,
                0
            );

            const tokenDetails = await realWorldReceivableContract.receivableInfoMapping(tokenId);
            expect(tokenDetails.poolAddress).to.equal(poolContract.address);
            expect(tokenDetails.paymentToken).to.equal(testTokenContract.address);
            expect(tokenDetails.receivableAmount).to.equal(1000);
            expect(tokenDetails.maturityDate).to.equal(100);
            expect(tokenDetails.paidAmount).to.equal(0);

            const tokenURI = await realWorldReceivableContract.tokenURI(tokenId);
            expect(tokenURI).to.equal("Test URI");
        });

        describe("declarePayment", async function () {
            beforeEach(async function () {
                await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);
                await poolContract
                    .connect(eaServiceAccount)
                    .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
                await poolContract.connect(borrower).drawdown(toToken(1_000_000));

                await realWorldReceivableContract
                    .connect(borrower)
                    .safeMint(
                        borrower.address,
                        poolContract.address,
                        testTokenContract.address,
                        1000,
                        100,
                        "Test URI"
                    );

                expect(await realWorldReceivableContract.balanceOf(borrower.address)).to.equal(1);

                await testTokenContract.connect(borrower).mint(borrower.address, toToken(2_000));
                await testTokenContract
                    .connect(borrower)
                    .approve(poolContract.address, toToken(2000));
            });

            it("declarePayment emits event and sends funds", async function () {
                const tokenId = await realWorldReceivableContract.tokenOfOwnerByIndex(
                    borrower.address,
                    0
                );
                await expect(
                    realWorldReceivableContract.connect(borrower).declarePayment(tokenId, 100)
                ).to.emit(realWorldReceivableContract, "PaymentDeclared");

                const tokenDetails = await realWorldReceivableContract.receivableInfoMapping(
                    tokenId
                );
                expect(tokenDetails.paidAmount).to.equal(100);
            });

            it("declarePayment fails if not being called by token owner", async function () {
                const tokenId = await realWorldReceivableContract.tokenOfOwnerByIndex(
                    borrower.address,
                    0
                );

                await expect(
                    realWorldReceivableContract.connect(poolOwner).declarePayment(tokenId, 1000)
                ).to.be.revertedWithCustomError(realWorldReceivableContract, "notNFTOwner");
            });

            it("declarePayment fails if already paid off", async function () {
                const tokenId = await realWorldReceivableContract.tokenOfOwnerByIndex(
                    borrower.address,
                    0
                );

                await realWorldReceivableContract.connect(borrower).declarePayment(tokenId, 1000);

                await expect(
                    realWorldReceivableContract.connect(borrower).declarePayment(tokenId, 1000)
                ).to.be.revertedWithCustomError(
                    realWorldReceivableContract,
                    "receivableAlreadyPaid"
                );
            });
        });
    });
});
