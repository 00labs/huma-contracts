const {ethers} = require("hardhat");
const {expect} = require("chai");
const {
    deployContracts,
    deployAndSetupPool,
    toToken,
    evmSnapshot,
    evmRevert,
} = require("./BaseTest");

let deployer, proxyOwner, pool;
let hdtContract, testTokenContract;

describe("HDT - some negative cases", function () {
    before(async function () {
        [deployer, proxyOwner] = await ethers.getSigners();

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
        // await hdtContract.initialize("Base Credit HDT", "CHDT", testTokenContract.address);
    });

    it("Cannot initialize zero underlying token address", async function () {
        await expect(
            hdtContract.initialize("Base Credit HDT", "CHDT", ethers.constants.AddressZero)
        ).to.be.revertedWithCustomError(hdtContract, "zeroAddressProvided");
    });

    describe("operation functions", async function () {
        before(async function () {
            await hdtContract.initialize("Base Credit HDT", "CHDT", testTokenContract.address);
            const MockPool = await ethers.getContractFactory("MockPool");
            pool = await MockPool.deploy(hdtContract.address);
            await pool.deployed();
            await hdtContract.setPool(pool.address);

            expect(await hdtContract.withdrawableFundsOf(deployer.address)).to.equal(0);
        });

        it("Cannot mint zero amount", async function () {
            await expect(pool.mintAmount(deployer.address, 0)).to.be.revertedWithCustomError(
                hdtContract,
                "zeroAmountProvided"
            );
        });

        it("Cannot burn zero amount", async function () {
            await expect(pool.burnAmount(deployer.address, 0)).to.be.revertedWithCustomError(
                hdtContract,
                "zeroAmountProvided"
            );
        });
    });
});
