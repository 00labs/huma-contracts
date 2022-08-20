/* eslint-disable no-underscore-dangle */
const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

use(solidity);

// Let us limit the depth of describe to be 2.
//
// In before() of "Huma Pool", all the key supporting contracts are deployed.
//
// In beforeEach() of "Huma Pool", we deploy a new HumaPool with initial
// liquidity 100 from the owner
describe.only("Base Fee Manager", function () {
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

  const deployPool = async function () {
    console.log("Enter deployPool.");
    const BaseCreditPool = await ethers.getContractFactory("BaseCreditPool");
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

    await testTokenContract.approve(poolContract.address, 100);

    await poolContract.makeInitialDeposit(100);
  };

  before(async function () {
    [owner, lender, borrower, borrower2, treasury, creditApprover, poolOwner] =
      await ethers.getSigners();

    const HumaConfig = await ethers.getContractFactory("HumaConfig");
    humaConfigContract = await HumaConfig.deploy(treasury.address);
    humaConfigContract.setHumaTreasury(treasury.address);

    const poolLockerFactory = await ethers.getContractFactory(
      "PoolLockerFactory"
    );
    poolLockerFactoryContract = await poolLockerFactory.deploy();

    // Deploy Fee Manager
    const feeManagerFactory = await ethers.getContractFactory("BaseFeeManager");
    feeManagerContract = await feeManagerFactory.deploy();
    await feeManagerContract.setFees(10, 100, 20, 100);

    const TestToken = await ethers.getContractFactory("TestToken");
    testTokenContract = await TestToken.deploy();

    deployPool();
  });

  beforeEach(async function () {});

  describe("Huma Pool Settings", function () {
    // todo Verify only pool admins can deployNewPool

    it("Should set the fees correctly", async function () {
      var [f1, f2, f3, f4] = await feeManagerContract.getFees();
      expect(f1).to.equal(10);
      expect(f2).to.equal(100);
      expect(f3).to.equal(20);
      expect(f4).to.equal(100);
    });

    it("Should disallow non-owner to set the fees", async function () {
      await expect(
        feeManagerContract.connect(treasury).setFees(15, 150, 25, 250)
      ).to.be.revertedWith("caller is not the owner"); // open zeppelin default error message
    });

    it("Should allow owner to set the fees", async function () {
      await feeManagerContract.connect(poolOwner).setFees(15, 150, 25, 250);

      var [f1, f2, f3, f4, f5, f6] = await feeManagerContract.getFees();
      expect(f1).to.equal(15);
      expect(f2).to.equal(150);
      expect(f3).to.equal(25);
      expect(f4).to.equal(250);
    });
  });

  //  * @notice Calculates monthly payment for a loan.
  //  * M = P [ i(1 + i)^n ] / [ (1 + i)^n – 1].
  //  * M = Total monthly payment
  //  * P = The total amount of the loan
  //  * I = Interest rate, as a monthly percentage
  //  * N = Number of payments.
  // payment lookup table: shorturl.at/fY015
  describe("Fixed Payment Setting and Lookup", function () {
    it("Should disallow non-owner to set the payment", async function () {
      await expect(
        feeManagerContract.connect(treasury).addFixedPayment(24, 500, 43871)
      ).to.be.revertedWith("caller is not the owner");
    });

    it("Should allow a single payment to be added", async function () {
      await feeManagerContract
        .connect(poolOwner)
        .addFixedPayment(24, 500, 43871);

      const payment = await feeManagerContract
        .connect(poolOwner)
        .getFixedPaymentAmount(1000000, 500, 24);
      expect(payment).to.equal(43871);
    });

    it("Should allow existing record to be updated", async function () {
      await feeManagerContract
        .connect(poolOwner)
        .addFixedPayment(24, 500, 43872);

      const payment = await feeManagerContract
        .connect(poolOwner)
        .getFixedPaymentAmount(1000000, 500, 24);
      expect(payment).to.equal(43872);
    });

    it("Should reject batch input of fixed payment schedule if array lengths do not match", async function () {
      let terms = [24, 24];
      let aprInBps = [1000, 1025];
      let payments = [46260];

      await expect(
        feeManagerContract
          .connect(poolOwner)
          .addBatchOfFixedPayments(terms, aprInBps, payments)
      ).to.be.revertedWith("INPUT_ARRAY_SIZE_MISMATCH");
    });

    it("Should allow list of fixed payment schedule to be added", async function () {
      let terms = [12, 12, 12, 12, 12, 12, 12, 24, 24, 24, 24, 24, 24, 24];
      let aprInBps = [
        500, 600, 700, 800, 900, 1000, 1025, 500, 600, 700, 800, 900, 1000,
        1025,
      ];
      let payments = [
        85607, 86066, 86527, 86988, 87451, 87916, 88032, 43871, 44321, 44773,
        45227, 45685, 46145, 46260,
      ];

      await feeManagerContract
        .connect(poolOwner)
        .addBatchOfFixedPayments(terms, aprInBps, payments);

      const payment1 = await feeManagerContract
        .connect(poolOwner)
        .getFixedPaymentAmount(10000000, 500, 12);
      expect(payment1).to.equal(856070);
      const payment2 = await feeManagerContract
        .connect(poolOwner)
        .getFixedPaymentAmount(100000, 1025, 12);
      expect(payment2).to.equal(8803);
      const payment3 = await feeManagerContract
        .connect(poolOwner)
        .getFixedPaymentAmount(1000000, 500, 24);
      expect(payment3).to.equal(43871);
    });
  });

  describe("Caclulate nextDueAmount", function () {
    beforeEach(async function () {
      deployPool;
    });
    afterEach(async function () {});
    it("Should calculate interest only correctly", async function () {});
    it("Should calculate fixed payment amount correctly", async function () {});
    it("Should fallback properly when fixed payment amount lookup failed", async function () {});
  });

  // IntOnly := Interest Only, Fixed := Fixed monthly payment, backFee := backFee,
  describe("getNextPayment() - interest only + 1st payment", function () {
    it("IntOnly - 1st pay - amt < interest", async function () {});
    it("IntOnly - 1st pay - amt = interest", async function () {});
    it("IntOnly - 1st pay - amt < interest && < interest + principal]", async function () {});
    it("IntOnly - 1st pay - amt = interest + principal (early payoff)", async function () {});
    it("IntOnly - 1st pay - amt > interest + principal (early payoff, extra pay)", async function () {});
    it("IntOnly - 1st pay - late - amt = interest, thus < interst + late fee", async function () {});
    it("IntOnly - 1st pay - late - amt = interest + late fee", async function () {});
    it("IntOnly - 1st pay - late - amt = interest + principal && < interest + late + principal", async function () {});
    it("IntOnly - 1st pay - late - amt = interest + late + principal", async function () {});
    it("IntOnly - 1st pay - late - amt > interest + late + principal", async function () {});
  });
  describe("getNextPayment() - interest only + 2nd payment", function () {
    it("IntOnly - 2nd pay - amt < interest", async function () {});
    it("IntOnly - 2nd pay - amt = interest", async function () {});
    it("IntOnly - 2nd pay - amt < interest && < interest + principal]", async function () {});
    it("IntOnly - 2nd pay - amt = interest + principal (early payoff)", async function () {});
    it("IntOnly - 2nd pay - amt > interest + principal (early payoff, extra pay)", async function () {});
    it("IntOnly - 2nd pay - late - amt = interest, thus < interst + late fee", async function () {});
    it("IntOnly - 2nd pay - late - amt = interest + late fee", async function () {});
    it("IntOnly - 2nd pay - late - amt = interest + principal && < interest + late + principal", async function () {});
    it("IntOnly - 2nd pay - late - amt = interest + late + principal", async function () {});
    it("IntOnly - 2nd pay - late - amt > interest + late + principal", async function () {});
  });
  describe("getNextPayment() - interest only + final payment", function () {
    it("IntOnly - final pay - amt < interest", async function () {});
    it("IntOnly - final pay - amt = interest", async function () {});
    it("IntOnly - final pay - amt < interest && < interest + principal]", async function () {});
    it("IntOnly - final pay - amt = interest + principal (early payoff)", async function () {});
    it("IntOnly - final pay - amt > interest + principal (early payoff, extra pay)", async function () {});
    it("IntOnly - final pay - late - amt = interest, thus < interst + late fee", async function () {});
    it("IntOnly - final pay - late - amt = interest + late fee", async function () {});
    it("IntOnly - final pay - late - amt = interest + principal && < interest + late + principal", async function () {});
    it("IntOnly - final pay - late - amt = interest + late + principal", async function () {});
    it("IntOnly - final pay - late - amt > interest + late + principal", async function () {});
  });

  describe("getNextPayment() - fixed payment + 1st payment", function () {
    it("Fixed - 1st pay - amt < interest", async function () {});
    it("Fixed - 1st pay - amt = interest", async function () {});
    it("Fixed - 1st pay - amt < interest && < interest + principal]", async function () {});
    it("Fixed - 1st pay - amt = interest + principal (early payoff)", async function () {});
    it("Fixed - 1st pay - amt > interest + principal (early payoff, extra pay)", async function () {});
    it("Fixed - 1st pay - late - amt = interest, thus < interst + late fee", async function () {});
    it("Fixed - 1st pay - late - amt = interest + late fee", async function () {});
    it("Fixed - 1st pay - late - amt = interest + principal && < interest + late + principal", async function () {});
    it("Fixed - 1st pay - late - amt = interest + late + principal", async function () {});
    it("Fixed - 1st pay - late - amt > interest + late + principal", async function () {});
  });
  describe("getNextPayment() - fixed payment + 2nd payment", function () {
    it("Fixed - 2nd pay - amt < interest", async function () {});
    it("Fixed - 2nd pay - amt = interest", async function () {});
    it("Fixed - 2nd pay - amt < interest && < interest + principal]", async function () {});
    it("Fixed - 2nd pay - amt = interest + principal (early payoff)", async function () {});
    it("Fixed - 2nd pay - amt > interest + principal (early payoff, extra pay)", async function () {});
    it("Fixed - 2nd pay - late - amt = interest, thus < interst + late fee", async function () {});
    it("Fixed - 2nd pay - late - amt = interest + late fee", async function () {});
    it("Fixed - 2nd pay - late - amt = interest + principal && < interest + late + principal", async function () {});
    it("Fixed - 2nd pay - late - amt = interest + late + principal", async function () {});
    it("Fixed - 2nd pay - late - amt > interest + late + principal", async function () {});
  });
  describe("getNextPayment() - fixed payment + final payment", function () {
    it("Fixed - final pay - amt < interest", async function () {});
    it("Fixed - final pay - amt = interest", async function () {});
    it("Fixed - final pay - amt < interest && < interest + principal]", async function () {});
    it("Fixed - final pay - amt = interest + principal (early payoff)", async function () {});
    it("Fixed - final pay - amt > interest + principal (early payoff, extra pay)", async function () {});
    it("Fixed - final pay - late - amt = interest, thus < interst + late fee", async function () {});
    it("Fixed - final pay - late - amt = interest + late fee", async function () {});
    it("Fixed - final pay - late - amt = interest + principal && < interest + late + principal", async function () {});
    it("Fixed - final pay - late - amt = interest + late + principal", async function () {});
    it("Fixed - final pay - late - amt > interest + late + principal", async function () {});
  });
});
