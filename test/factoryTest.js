/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {expect} = require("chai");

describe("Huma Config", function () {
    let poolAddress;
    before(async function () {
        [
            deployer, 
            poolOwner,
            protocolOwner,
        ] = await ethers.getSigners();

        // Deploy EvaluationAgentNFT
        // console.log("deploying EANFT");
        const EvaluationAgentNFT = await ethers.getContractFactory("EvaluationAgentNFT");
        eaNFTContract = await EvaluationAgentNFT.deploy();

        // console.log("deploying HumaConfig");
        const HumaConfig = await ethers.getContractFactory("HumaConfig");
        configContract = await HumaConfig.deploy();


        // Deploy TestToken, give initial tokens to lender
        // console.log("deploying TestToken");
        const TestToken = await ethers.getContractFactory("TestToken");
        testTokenContract = await TestToken.deploy();

        await configContract.setLiquidityAsset(testTokenContract.address, true);

        // console.log("deploying HDTImpl");
        const HDTImpl = await ethers.getContractFactory("HDT");
        hdtImpl = await HDTImpl.deploy();
        
        // deploy basecreditpool implementation
        // console.log("deploying BaseCreditPoolImpl");
        const BaseCreditPoolImpl = await ethers.getContractFactory("BaseCreditPool");
        baseCreditPoolImpl = await BaseCreditPoolImpl.deploy();

        const ReceivableFactoringPoolImpl = await ethers.getContractFactory("ReceivableFactoringPool");
        receivableFactoringPoolImpl = await ReceivableFactoringPoolImpl.deploy();

        // console.log("deploying LibFeeManager");
        const LibFeeManager = await ethers.getContractFactory("LibFeeManager");
        libFeeManager = await LibFeeManager.deploy();

        // console.log("deploying LibPoolConfig");
        const LibPoolConfig = await ethers.getContractFactory("LibPoolConfig");
        libPoolConfig = await LibPoolConfig.deploy();

        const LibHDT = await ethers.getContractFactory("LibHDT");
        libHDT = await LibHDT.deploy();

        const LibPool = await ethers.getContractFactory("LibPool");
        libPool = await LibPool.deploy();

        // console.log("deploying PoolFactory");
        const PoolFactory = await ethers.getContractFactory("PoolFactory",{libraries: {
            LibFeeManager: libFeeManager.address,
            LibPoolConfig: libPoolConfig.address,
            LibHDT: libHDT.address,
            LibPool: libPool.address,
        },});

        poolFactory = await PoolFactory.deploy(
            protocolOwner.address, configContract.address, hdtImpl.address, 
            baseCreditPoolImpl.address, receivableFactoringPoolImpl.address
            );
    });

    describe("Factory Ownership", function () {
        it("Protocol owner should own the factory", async function () {
            // await poolFactory.transferOwnership(protocolOwner.address);
            const role = await poolFactory.OWNER_ROLE();
            await expect(await poolFactory.hasRole(role, protocolOwner.address)).to.equal(true);
        });
    });

    describe("Deployer Role", function () {
        it("Protocol owner can grant and revoke deployer role", async function () {
            const role = await poolFactory.DEPLOYER_ROLE();
            await expect(await poolFactory.hasRole(role, deployer.address)).to.equal(false);
            await poolFactory.connect(protocolOwner).addDeployer(deployer.address);
            await expect(await poolFactory.hasRole(role, deployer.address)).to.equal(true);
            await poolFactory.connect(protocolOwner).removeDeployer(deployer.address);
            await expect(await poolFactory.hasRole(role, deployer.address)).to.equal(false);
            await poolFactory.connect(protocolOwner).addDeployer(deployer.address);
        });
        it("Other accounts cannot grant and revoke deployer role", async function () {
            const role = await poolFactory.DEPLOYER_ROLE();
            await expect(
                poolFactory.addDeployer(deployer.address)
            ).to.be.revertedWith(/AccessControl: account .* is missing role .*/);
            await expect(
                poolFactory.removeDeployer(deployer.address)
            ).to.be.revertedWith(/AccessControl: account .* is missing role .*/);
        });
    });

    describe("Setting implementation address", function () {
        it("Owner can set new HDTimpl", async function () {
            const newHDTImpl = await ethers.getContractFactory("HDT");
            hdtImpl = await newHDTImpl.deploy();
            await poolFactory.connect(protocolOwner).setHDTImplAddress(hdtImpl.address);
            await expect(await poolFactory.hdtImplAddress()).to.equal(hdtImpl.address);
        });
        it("Other accounts cannot set new HDTimpl", async function () {
            const newHDTImpl = await ethers.getContractFactory("HDT");
            newhdtImpl = await newHDTImpl.deploy();
            await expect(
                poolFactory.setHDTImplAddress(newhdtImpl.address)
                ).to.be.revertedWith(/AccessControl: account .* is missing role .*/);
        });
        it("Owner can set new BaseCredtiPoolImpl Address", async function () {
            const NewImpl = await ethers.getContractFactory("BaseCreditPool");
            newBaseCreditPoolImpl = await NewImpl.deploy();
            await poolFactory.connect(protocolOwner).setBaseCredtiPoolImplAddress(newBaseCreditPoolImpl.address);
            await expect(await poolFactory.baseCreditPoolImplAddress()).to.equal(newBaseCreditPoolImpl.address);
            console.log(await poolFactory.baseCreditPoolImplAddress());
        });
        it("Other accounts cannot set new BaseCredtiPoolImpl", async function () {
            const NewImpl = await ethers.getContractFactory("BaseCreditPool");
            newImpl = await NewImpl.deploy();
            await expect(
                poolFactory.setHDTImplAddress(newImpl.address)
                ).to.be.revertedWith(/AccessControl: account .* is missing role .*/);
            console.log(await poolFactory.baseCreditPoolImplAddress());
        });
        it("Owner can set new receivableFactoringPoolImpl Address", async function () {
            const NewImpl = await ethers.getContractFactory("ReceivableFactoringPool");
            newReceivableFactoringPoolImpl = await NewImpl.deploy();
            await poolFactory.connect(
                protocolOwner
                ).setReceivableFactoringPoolImplAddress(
                    newReceivableFactoringPoolImpl.address
                    );
            await expect(
                await poolFactory.receivableFactoringPoolImplAddress()
                ).to.equal(
                    newReceivableFactoringPoolImpl.address
                    );
        });
        it("Other accounts cannot set new BaseCredtiPoreceivableFactoringPoolImplolImpl", async function () {
            const NewImpl = await ethers.getContractFactory("ReceivableFactoringPool");
            newImpl = await NewImpl.deploy();
            await expect(
                poolFactory.setHDTImplAddress(newImpl.address)
                ).to.be.revertedWith(/AccessControl: account .* is missing role .*/);
        });
    });
    describe("Creating pools", function () {
        it("Non-deployer cannot create pools", async function () {
            console.log(await poolFactory.baseCreditPoolImplAddress());
            await expect(
                poolFactory.connect(protocolOwner).createBaseCreditPool(
                    'Testing pool',
                    [poolOwner.address],
                    [poolOwner.address],
                    )).to.be.revertedWith(/AccessControl: account .* is missing role .*/);
        });
        it("Deployer creates base credit pool", async function () {
            const tnx = await poolFactory.createBaseCreditPool(
                'Testing pool',
                [poolOwner.address],
                [poolOwner.address],
                ); 
            const receipt = await tnx.wait();
            const poolAddress = await receipt.events.pop().args[0];
            const poolRecord = await poolFactory.checkPool(poolAddress);
            await expect(
                poolRecord['poolName']
            ).to.equal(
                    'Testing pool',
                    );
            await expect(
                poolRecord['poolStatus']
            ).to.equal(
                    0,
                    );
        });
        it("Deployer creates receivable pool", async function () {
            const tnx = await poolFactory.createReceivableFactoringPool(
                'Testing pool 2',
                [poolOwner.address],
                [poolOwner.address],
                ); 
            const receipt = await tnx.wait();
            poolAddress = await receipt.events.pop().args[0];
            const poolRecord = await poolFactory.checkPool(poolAddress);
            await expect(
                poolRecord['poolName']
            ).to.equal(
                    'Testing pool 2',
                    );
            await expect(
                poolRecord['poolStatus']
            ).to.equal(
                    0,
                    );
        });
    });
    describe("Initialize pools", function () {
        it("Initialize Fee Manager", async function () {
            await poolFactory.initializePoolFeeManager(
                poolAddress,
                0,
                0,
                0,
                0,
                0,
                0,
            );
        });
        it("Initialize HDT", async function () {
            await poolFactory.initializeHDT(
                poolAddress,
                "Test HDT",
                "THDT",
                testTokenContract.address
            );
        });
        it("Initialize Pool Config", async function () {
            await poolFactory.initializePoolConfigOne(
                poolAddress,
                poolOwner.address,
                30,
                30
            );
            await poolFactory.initializePoolConfigTwo(
                poolAddress,
                1_000_000_000_000,
                0,
                0,
                0,
                0,
                1000_000_000,
                1000,
                0
            );
        });
        it("Initialize Pool", async function () {
            await poolFactory.initializeReceivableFactoringPool(
                poolAddress
            );
        });
    });
});
