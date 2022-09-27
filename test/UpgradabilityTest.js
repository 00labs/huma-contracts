const {ethers} = require("hardhat");
const {expect} = require("chai");
const {deployContracts, deployAndSetupPool} = require("./BaseTest");

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
        ] = await ethers.getSigners();
    });

    beforeEach(async function () {
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
                eaNFTContract
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
            await expect(
                poolProxy.connect(protocolOwner).upgradeTo(newPoolImpl.address)
            ).to.be.revertedWith(
                "function selector was not recognized and there's no fallback function"
            );
        });

        it("Should call existing function successfully", async function () {
            const r1 = await poolConfigContract.poolDefaultGracePeriodInSeconds();
            await poolProxy.connect(proxyOwner).upgradeTo(newPoolImpl.address);
            const r2 = await poolConfigContract.poolDefaultGracePeriodInSeconds();
            expect(r1).equals(r2);
        });

        it("Should call deleted function failed", async function () {
            await poolProxy.connect(proxyOwner).upgradeTo(newPoolImpl.address);
            await expect(poolContract.approveCredit(protocolOwner.address)).to.be.revertedWith(
                "function selector was not recognized and there's no fallback function"
            );
        });

        it("Should call changed function and new function successfully", async function () {
            await poolProxy.connect(proxyOwner).upgradeTo(newPoolImpl.address);
            await poolContract
                .connect(eaServiceAccount)
                .changeCreditLine(protocolOwner.address, 100);
            poolContract = MockBaseCreditPoolV2.attach(poolContract.address);
            const cl = await poolContract.getCreditLine(protocolOwner.address);
            expect(cl).equals(200);
        });
    });
});
