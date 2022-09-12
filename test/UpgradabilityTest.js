const {ethers} = require("hardhat");
const {expect} = require("chai");

describe("Upgradability Test", function () {
    let poolContract;
    let hdtContract;
    let humaConfigContract;
    let feeManagerContract;
    let testTokenContract;
    let proxyOwner;
    let owner;
    let lender;
    let borrower;
    let borrower2;
    let treasury;
    let evaluationAgent;
    let poolImpl;
    let poolProxy;

    before(async function () {
        [owner, proxyOwner, lender, borrower, borrower2, treasury, evaluationAgent] =
            await ethers.getSigners();

        const HumaConfig = await ethers.getContractFactory("HumaConfig");
        humaConfigContract = await HumaConfig.deploy(treasury.address);
        humaConfigContract.setHumaTreasury(treasury.address);

        const feeManagerFactory = await ethers.getContractFactory("BaseFeeManager");
        feeManagerContract = await feeManagerFactory.deploy();

        await feeManagerContract.setFees(10, 100, 20, 100);

        const InvoiceNFT = await ethers.getContractFactory("InvoiceNFT");
        invoiceNFTContract = await InvoiceNFT.deploy();
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
        poolImpl = await BaseCreditPool.deploy();
        await poolImpl.deployed();
        poolProxy = await TransparentUpgradeableProxy.deploy(
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

        await poolContract.setMaxCreditLine(1000);
        await poolContract.setEvaluationAgent(evaluationAgent.address);
        await poolContract.enablePool();
    });

    describe("V1", async function () {
        it("Should not initialize impl", async function () {
            await expect(
                poolImpl.initialize(
                    hdtContract.address,
                    humaConfigContract.address,
                    feeManagerContract.address,
                    "Base Credit Pool"
                )
            ).to.be.revertedWith("Initializable: contract is already initialized");
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
                poolProxy.connect(owner).upgradeTo(newPoolImpl.address)
            ).to.be.revertedWith(
                "function selector was not recognized and there's no fallback function"
            );
        });

        it("Should call existing function successfully", async function () {
            const r1 = await poolContract.poolDefaultGracePeriodInSeconds();
            await poolProxy.connect(proxyOwner).upgradeTo(newPoolImpl.address);
            const r2 = await poolContract.poolDefaultGracePeriodInSeconds();
            expect(r1).equals(r2);
        });

        it("Should call deleted function failed", async function () {
            await poolProxy.connect(proxyOwner).upgradeTo(newPoolImpl.address);
            await expect(poolContract.approveCredit(owner.address)).to.be.revertedWith(
                "function selector was not recognized and there's no fallback function"
            );
        });

        it("Should call changed function and new function successfully", async function () {
            await poolProxy.connect(proxyOwner).upgradeTo(newPoolImpl.address);
            await poolContract.connect(evaluationAgent).changeCreditLine(owner.address, 100);
            poolContract = MockBaseCreditPoolV2.attach(poolContract.address);
            const cl = await poolContract.getCreditLine(owner.address);
            expect(cl).equals(200);
        });
    });
});
