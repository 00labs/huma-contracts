/* eslint-disable no-underscore-dangle */
const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

use(solidity);

const getLoanContractFromAddress = async function (address, signer) {
    return ethers.getContractAt("HumaLoan", address, signer);
};

describe("Base Contracts", function () {
    let humaPoolAdminsContract;
    let humaPoolFactoryContract;
    let humaPoolContract;
    let humaConfigContract;
    let humaCreditFactoryContract;
    let humaPoolLockerFactoryContract;
    let humaAPIClientContract;
    let testTokenContract;
    let owner;
    let lender;
    let borrower;
    let borrower2;

    before(async function () {
        [owner, lender, borrower, borrower2] = await ethers.getSigners();

        const HumaPoolAdmins = await ethers.getContractFactory(
            "HumaPoolAdmins"
        );
        humaPoolAdminsContract = await HumaPoolAdmins.deploy();

        const HumaConfig = await ethers.getContractFactory("HumaConfig");
        humaConfigContract = await HumaConfig.deploy(
            owner.address,
            owner.address
        );

        const HumaCreditFactory = await ethers.getContractFactory(
            "HumaCreditFactory"
        );
        humaCreditFactoryContract = await HumaCreditFactory.deploy();

        const HumaPoolLockerFactory = await ethers.getContractFactory(
            "HumaPoolLockerFactory"
        );
        humaPoolLockerFactoryContract = await HumaPoolLockerFactory.deploy();

        const HumaAPIClient = await ethers.getContractFactory("HumaAPIClient");
        humaAPIClientContract = await HumaAPIClient.deploy();

        const HumaPoolFactory = await ethers.getContractFactory(
            "HumaPoolFactory"
        );
        humaPoolFactoryContract = await HumaPoolFactory.deploy(
            humaPoolAdminsContract.address,
            humaConfigContract.address,
            humaCreditFactoryContract.address,
            humaPoolLockerFactoryContract.address,
            humaAPIClientContract.address
        );

        const TestToken = await ethers.getContractFactory("TestToken");
        testTokenContract = await TestToken.deploy();
    });

    describe("Deployment", function () {
        it("Should have correct owners", async function () {
            expect(await humaPoolAdminsContract.owner()).to.equal(
                owner.address
            );
        });
    });

    describe("HumaPoolAdmins", function () {
        it("Only huma master admin can create new pools", async function () {
            await testTokenContract.approve(
                humaPoolFactoryContract.address,
                99999
            );
            await expect(
                humaPoolFactoryContract.deployNewPool(
                    testTokenContract.address,
                    100
                )
            ).to.emit(humaPoolFactoryContract, "PoolDeployed");
        });

        it("Other users cannot create new pools", async function () {
            await testTokenContract
                .connect(borrower)
                .approve(humaPoolFactoryContract.address, 99999);
            await testTokenContract.approve(
                humaPoolFactoryContract.address,
                99999
            );
            await expect(
                humaPoolFactoryContract
                    .connect(borrower)
                    .deployNewPool(testTokenContract.address, 100)
            ).to.be.revertedWith("HumaPoolFactory:CALLER_NOT_APPROVED");
        });
    });
});
