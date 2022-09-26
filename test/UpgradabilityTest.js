const {ethers} = require("hardhat");
const {expect} = require("chai");

describe("Upgradability Test", function () {
    let poolContract;
    let poolConfigContract;
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
            owner,
            protocolOwner,
            eaServiceAccount,
            pdsServiceAccount,
        ] = await ethers.getSigners();

        // Deploy EvaluationAgentNFT
        const EvaluationAgentNFT = await ethers.getContractFactory("EvaluationAgentNFT");
        eaNFTContract = await EvaluationAgentNFT.deploy();

        const HumaConfig = await ethers.getContractFactory("HumaConfig");
        humaConfigContract = await HumaConfig.deploy(treasury.address);
        await humaConfigContract.setHumaTreasury(treasury.address);
        await humaConfigContract.setEANFTContractAddress(eaNFTContract.address);
        await humaConfigContract.setEAServiceAccount(eaServiceAccount.address);
        await humaConfigContract.setPDSServiceAccount(pdsServiceAccount.address);
        await humaConfigContract.transferOwnership(protocolOwner.address);

        const feeManagerFactory = await ethers.getContractFactory("BaseFeeManager");
        feeManagerContract = await feeManagerFactory.deploy();

        await feeManagerContract.setFees(10, 100, 20, 100, 0);

        const TestToken = await ethers.getContractFactory("TestToken");
        testTokenContract = await TestToken.deploy();

        const InvoiceNFT = await ethers.getContractFactory("InvoiceNFT");
        invoiceNFTContract = await InvoiceNFT.deploy(testTokenContract.address);
    });

    beforeEach(async function () {
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

        const BasePoolConfig = await ethers.getContractFactory("BasePoolConfig");
        poolConfigContract = await BasePoolConfig.deploy(
            "Base Credit Pool",
            hdtContract.address,
            humaConfigContract.address,
            feeManagerContract.address
        );
        await poolConfigContract.deployed();

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
        await poolContract.initialize(poolConfigContract.address);

        await poolConfigContract.setPool(poolContract.address);
        await hdtContract.setPool(poolContract.address);

        await testTokenContract.approve(poolContract.address, 100);

        await poolConfigContract.setMaxCreditLine(1000);

        let eaNFTTokenId;
        // Mint EANFT to the borrower
        const tx = await eaNFTContract.mintNFT(evaluationAgent.address, "");
        const receipt = await tx.wait();
        for (const evt of receipt.events) {
            if (evt.event === "NFTGenerated") {
                eaNFTTokenId = evt.args.tokenId;
            }
        }

        await poolConfigContract.setEvaluationAgent(eaNFTTokenId, evaluationAgent.address);

        await poolContract.enablePool();
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
                poolProxy.connect(owner).upgradeTo(newPoolImpl.address)
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
            await expect(poolContract.approveCredit(owner.address)).to.be.revertedWith(
                "function selector was not recognized and there's no fallback function"
            );
        });

        it("Should call changed function and new function successfully", async function () {
            await poolProxy.connect(proxyOwner).upgradeTo(newPoolImpl.address);
            await poolContract.connect(eaServiceAccount).changeCreditLine(owner.address, 100);
            poolContract = MockBaseCreditPoolV2.attach(poolContract.address);
            const cl = await poolContract.getCreditLine(owner.address);
            expect(cl).equals(200);
        });
    });
});
