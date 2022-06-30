const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

use(solidity);

describe("Base Contracts", function () {
  let humaPoolAdminsContract;
  let humaPoolFactoryContract;
  let humaPoolLockerFactoryContract;
  let testTokenContract;
  let humaPoolContract;
  let owner;
  let lender;
  let borrower;

  beforeEach(async function () {
    [owner, lender, borrower] = await ethers.getSigners();

    const HumaPoolAdmins = await ethers.getContractFactory("HumaPoolAdmins");
    humaPoolAdminsContract = await HumaPoolAdmins.deploy();

    const HumaPoolLockerFactory = await ethers.getContractFactory(
      "HumaPoolLockerFactory"
    );
    humaPoolLockerFactoryContract = await HumaPoolLockerFactory.deploy();

    const HumaPoolFactory = await ethers.getContractFactory("HumaPoolFactory");
    humaPoolFactoryContract = await HumaPoolFactory.deploy(
      humaPoolAdminsContract.address,
      humaPoolLockerFactoryContract.address
    );

    const TestToken = await ethers.getContractFactory("TestToken");
    testTokenContract = await TestToken.deploy();
  });

  describe("Deployment", function () {
    it("Should have correct owners", async function () {
      expect(await humaPoolAdminsContract.owner()).to.equal(owner.address);
    });
  });

  describe("HumaPoolAdmins", function () {
    it("Only huma master admin can create new pools", async function () {
      await testTokenContract.approve(humaPoolFactoryContract.address, 99999);
      await expect(
        humaPoolFactoryContract.deployNewPool(testTokenContract.address, 100)
      ).to.emit(humaPoolFactoryContract, "PoolDeployed");
    });

    it("Other users cannot create new pools", async function () {
      await testTokenContract
        .connect(borrower)
        .approve(humaPoolFactoryContract.address, 99999);
      await testTokenContract.approve(humaPoolFactoryContract.address, 99999);
      await expect(
        humaPoolFactoryContract
          .connect(borrower)
          .deployNewPool(testTokenContract.address, 100)
      ).to.be.revertedWith("HumaPoolFactory:CALLER_NOT_APPROVED");
    });
  });

  describe.only("HumaPool", function () {
    beforeEach(async function () {
      await testTokenContract.approve(humaPoolFactoryContract.address, 99999);
      const tx = await humaPoolFactoryContract.deployNewPool(
        testTokenContract.address,
        100
      );
      const receipt = await tx.wait();
      let poolAddress;
      // eslint-disable-next-line no-restricted-syntax
      for (const evt of receipt.events) {
        if (evt.event === "PoolDeployed") {
          poolAddress = evt.args[0];
        }
      }

      humaPoolContract = await ethers.getContractAt(
        "HumaPool",
        poolAddress,
        owner
      );
    });

    it("Only pool owner and master admin can edit pool settings", async function () {
      // Transfer ownership of pool to other account
      await humaPoolContract.transferOwnership(lender.address);

      // Master admin should succeed
      await humaPoolContract.setHumaPoolLoanHelper(
        "0x0000000000000000000000000000000000000000"
      );

      // Owner should succeed
      await humaPoolContract
        .connect(lender)
        .setHumaPoolLoanHelper("0x0000000000000000000000000000000000000000");

      // Non-owner should fail
      await expect(
        humaPoolContract
          .connect(borrower)
          .setHumaPoolLoanHelper("0x0000000000000000000000000000000000000000")
      ).to.be.revertedWith("HumaPool:PERMISSION_DENIED_NOT_ADMIN");
    });
  });
});
