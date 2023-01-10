const {ethers} = require("hardhat");
const {expect} = require("chai");
const {deployContracts, deployAndSetupPool, evmSnapshot, evmRevert} = require("./BaseTest");

describe("Upgradability Test", function () {
    let poolContract;
    let poolConfigContract;
    let hdtContract;
    let humaConfigContract;
    let feeManagerContract;
    let testTokenContract;
    let proxyOwner;
    let lender;
    let borrower;
    let treasury;
    let evaluationAgent;
    let poolImpl;
    let poolProxy;
    let protocolOwner;
    let eaNFTContract;
    let eaServiceAccount;
    let pdsServiceAccount;
    let poolOperator;
    let poolOwnerTreasury;

    let sId;

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

        [hdtContract, poolConfigContract, poolContract, poolImpl, poolProxy] =
            await deployAndSetupPool(
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

        const TimelockController = await ethers.getContractFactory("TimelockController");
        timelockContract = await TimelockController.deploy(
            0,
            [protocolOwner.address],
            [protocolOwner.address]
        );
        await timelockContract.deployed();

        // set timelock as HDT's owner
        await hdtContract.transferOwnership(timelockContract.address);

        // deployer renounces admin role
        const adminRole = await timelockContract.TIMELOCK_ADMIN_ROLE();
        await timelockContract.renounceRole(adminRole, defaultDeployer.address);
    });

    beforeEach(async function () {
        sId = await evmSnapshot();
    });

    afterEach(async function () {
        if (sId) {
            const res = await evmRevert(sId);
        }
    });

    describe("V1", async function () {
        it("Should not initialize impl", async function () {
            await expect(poolImpl.initialize(poolConfigContract.address)).to.be.revertedWith(
                "Initializable: contract is already initialized"
            );
        });
    });

    describe("V2", async function () {
        let newPoolImpl, MockBaseCreditPoolV2;
        beforeEach(async function () {
            MockBaseCreditPoolV2 = await ethers.getContractFactory("MockBaseCreditPoolV2");
            newPoolImpl = await MockBaseCreditPoolV2.deploy();
            await newPoolImpl.deployed();
        });

        it("Should not upgrade without pool owner", async function () {
            await expect(poolProxy.connect(protocolOwner).upgradeTo(newPoolImpl.address)).to.be
                .reverted;
        });

        it("Should call existing function successfully", async function () {
            const r1 = await poolConfigContract.poolDefaultGracePeriodInSeconds();
            await poolProxy.connect(proxyOwner).upgradeTo(newPoolImpl.address);
            const r2 = await poolConfigContract.poolDefaultGracePeriodInSeconds();
            expect(r1).equals(r2);
        });

        it("Should call deleted function failed", async function () {
            await poolProxy.connect(proxyOwner).upgradeTo(newPoolImpl.address);
            await expect(poolContract.approveCredit(protocolOwner.address, 5000, 30, 12, 1217)).to
                .be.reverted;
        });

        it("Should call changed function and new function successfully", async function () {
            await poolProxy.connect(proxyOwner).upgradeTo(newPoolImpl.address);
            await poolContract
                .connect(eaServiceAccount)
                .changeCreditLine(protocolOwner.address, 100);
            poolContract = MockBaseCreditPoolV2.attach(poolContract.address);
            expect(await poolContract.getCreditLine(protocolOwner.address)).to.equal(200n);
        });
    });
});
