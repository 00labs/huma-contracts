/* eslint-disable no-underscore-dangle */
const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

use(solidity);

const getLoanContractFromAddress = async function (address, signer) {
    return ethers.getContractAt("HumaLoan", address, signer);
};

// Let us limit the depth of describe to be 2.
//
// In before() of "Huma Pool", all the key supporting contracts are deployed.
//
// In beforeEach() of "Huma Pool", we deploy a new HumaPool with initial
// liquidity 100 from the owner
describe("Base Fee Manager", function () {
    let poolContract;
    let humaConfigContract;
    let humaPoolLockerFactoryContract;
    let testTokenContract;
    let feeManagerContract;
    let owner;
    let lender;
    let borrower;
    let borrower2;
    let treasury;
    let creditApprover;
    let poolOwner;

    before(async function () {
        [
            owner,
            lender,
            borrower,
            borrower2,
            treasury,
            creditApprover,
            poolOwner,
        ] = await ethers.getSigners();

        const HumaConfig = await ethers.getContractFactory("HumaConfig");
        humaConfigContract = await HumaConfig.deploy(treasury.address);
        humaConfigContract.setHumaTreasury(treasury.address);

        const poolLockerFactory = await ethers.getContractFactory(
            "PoolLockerFactory"
        );
        poolLockerFactoryContract = await poolLockerFactory.deploy();

        // Deploy Fee Manager
        const feeManagerFactory = await ethers.getContractFactory(
            "BaseFeeManager"
        );
        feeManagerContract = await feeManagerFactory.deploy();

        const TestToken = await ethers.getContractFactory("TestToken");
        testTokenContract = await TestToken.deploy();

        // Deploy BaseCreditPool
        const BaseCreditPool = await ethers.getContractFactory(
            "BaseCreditPool"
        );
        poolContract = await BaseCreditPool.deploy(
            testTokenContract.address,
            humaConfigContract.address,
            poolLockerFactoryContract.address,
            feeManagerContract.address,
            "Base Credit Pool",
            "Base HDT",
            "BHDT"
        );
        await poolContract.deployed();

        await testTokenContract.approve(poolContract.address, 100);

        await poolContract.transferOwnership(poolOwner.address);
        await feeManagerContract.transferOwnership(poolOwner.address);

        await poolContract.enablePool();

        await feeManagerContract
            .connect(poolOwner)
            .setFees(10, 100, 20, 100, 30, 100);

        await testTokenContract.approve(poolContract.address, 100);

        await poolContract.makeInitialDeposit(100);
    });

    beforeEach(async function () {});

    describe("Huma Pool Settings", function () {
        // todo Verify only pool admins can deployNewPool

        it("Should set the fees correctly", async function () {
            var [f1, f2, f3, f4, f5, f6] = await feeManagerContract.getFees();
            expect(f1).to.equal(10);
            expect(f2).to.equal(100);
            expect(f3).to.equal(20);
            expect(f4).to.equal(100);
            expect(f5).to.equal(30);
            expect(f6).to.equal(100);
        });

        it("Should disallow non-owner to set the fees", async function () {
            await expect(
                feeManagerContract
                    .connect(treasury)
                    .setFees(15, 150, 25, 250, 35, 350)
            ).to.be.revertedWith("caller is not the owner"); // open zeppelin default error message
        });

        it("Should allow owner to set the fees", async function () {
            await feeManagerContract
                .connect(poolOwner)
                .setFees(15, 150, 25, 250, 35, 350);

            var [f1, f2, f3, f4, f5, f6] = await feeManagerContract.getFees();
            expect(f1).to.equal(15);
            expect(f2).to.equal(150);
            expect(f3).to.equal(25);
            expect(f4).to.equal(250);
            expect(f5).to.equal(35);
            expect(f6).to.equal(350);
        });
    });
});
