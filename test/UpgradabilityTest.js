const {ethers} = require("hardhat");

describe("BaseCreditPoolUp Test", function () {
    let poolContract;
    let hdtContract;
    let humaConfigContract;
    let feeManagerContract;
    let testTokenContract;
    let owner;
    let poolOwner;
    let lender;
    let borrower;
    let borrower2;
    let treasury;
    let evaluationAgent;

    before(async function () {
        [owner, poolOwner, lender, borrower, borrower2, treasury, evaluationAgent] =
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

        const HDT = await ethers.getContractFactory("HDT");
        hdtContract = await HDT.deploy("Base Credit HDT", "CHDT", testTokenContract.address);
        await hdtContract.deployed();

        const BaseCreditPool = await ethers.getContractFactory("BaseCreditPool");
        let poolImpl = await BaseCreditPool.deploy();
        await poolImpl.deployed();

        const TransparentUpgradeableProxy = await ethers.getContractFactory(
            "TransparentUpgradeableProxy"
        );
        let poolProxy = await TransparentUpgradeableProxy.deploy(
            poolImpl.address,
            owner.address,
            []
        );
        await poolProxy.deployed();

        poolContract = BaseCreditPool.attach(poolProxy.address).connect(poolOwner);
        await poolContract.initialize(
            hdtContract.address,
            humaConfigContract.address,
            feeManagerContract.address,
            "Base Credit Pool"
        );

        await hdtContract.setPool(poolContract.address);

        await testTokenContract.approve(poolContract.address, 100);

        await poolContract.enablePool();

        // const tx = await poolLockerFactoryContract.deployNewLocker(
        //     poolContract.address,
        //     testTokenContract.address
        // );
        // const receipt = await tx.wait();
        // let lockerAddress;
        // for (const evt of receipt.events) {
        //     if (evt.event === "PoolLockerDeployed") {
        //         lockerAddress = evt.args[0];
        //     }
        // }

        await poolContract.addEvaluationAgent(evaluationAgent.address);
    });

    it("Test Gas", async function () {
        await poolContract.disablePool();

        console.log("done");
    });
});
