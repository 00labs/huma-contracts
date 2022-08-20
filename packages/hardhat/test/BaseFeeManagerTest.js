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
describe("Base Fee Manager", function () {
  let poolContract;
  let humaConfigContract;
  let humaPoolLockerFactoryContract;
  let testTokenContract;
  let feeManager;
  let owner;
  let lender;
  let borrower;
  let borrower2;
  let treasury;
  let creditApprover;
  let poolOwner;
  let record;
  let lastLateDate;

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
    feeManager = await feeManagerFactory.deploy();
    await feeManager.setFees(15, 150, 25, 250);

    const TestToken = await ethers.getContractFactory("TestToken");
    testTokenContract = await TestToken.deploy();
    testTokenContract.give1000To(lender.address);

    const BaseCreditPool = await ethers.getContractFactory("BaseCreditPool");
    poolContract = await BaseCreditPool.deploy(
      testTokenContract.address,
      humaConfigContract.address,
      poolLockerFactoryContract.address,
      feeManager.address,
      "Base Credit Pool",
      "Base HDT",
      "BHDT"
    );
    await poolContract.deployed();

    await poolContract.transferOwnership(poolOwner.address);
    await feeManager.transferOwnership(poolOwner.address);

    await testTokenContract.approve(poolContract.address, 100);
    await poolContract.makeInitialDeposit(100);
    await poolContract.enablePool();
    await poolContract.setMinMaxBorrowAmount(10, 1000);

    await testTokenContract.approve(poolContract.address, 100);
  });

  beforeEach(async function () {});

  describe("Huma Pool Settings", function () {
    // todo Verify only pool admins can deployNewPool

    it("Should set the fees correctly", async function () {
      var [f1, f2, f3, f4] = await feeManager.getFees();
      expect(f1).to.equal(15);
      expect(f2).to.equal(150);
      expect(f3).to.equal(25);
      expect(f4).to.equal(250);
    });

    it("Should disallow non-owner to set the fees", async function () {
      await expect(
        feeManager.connect(treasury).setFees(10, 100, 20, 10000)
      ).to.be.revertedWith("caller is not the owner"); // open zeppelin default error message
    });

    it("Should allow owner to set the fees", async function () {
      await feeManager.connect(poolOwner).setFees(10, 100, 20, 10000);

      var [f1, f2, f3, f4, f5, f6] = await feeManager.getFees();
      expect(f1).to.equal(10);
      expect(f2).to.equal(100);
      expect(f3).to.equal(20);
      expect(f4).to.equal(10000);
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
        feeManager.connect(treasury).addFixedPayment(24, 500, 43871)
      ).to.be.revertedWith("caller is not the owner");
    });

    it("Should allow a single payment to be added", async function () {
      await feeManager.connect(poolOwner).addFixedPayment(24, 500, 43871);

      const payment = await feeManager
        .connect(poolOwner)
        .getFixedPaymentAmount(1000000, 500, 24);
      expect(payment).to.equal(43871);
    });

    it("Should allow existing record to be updated", async function () {
      await feeManager.connect(poolOwner).addFixedPayment(24, 500, 43872);

      const payment = await feeManager
        .connect(poolOwner)
        .getFixedPaymentAmount(1000000, 500, 24);
      expect(payment).to.equal(43872);
    });

    it("Should reject batch input of fixed payment schedule if array lengths do not match", async function () {
      let terms = [24, 24];
      let aprInBps = [1000, 1025];
      let payments = [46260];

      await expect(
        feeManager
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

      await feeManager
        .connect(poolOwner)
        .addBatchOfFixedPayments(terms, aprInBps, payments);

      const payment1 = await feeManager
        .connect(poolOwner)
        .getFixedPaymentAmount(10000000, 500, 12);
      expect(payment1).to.equal(856070);
      const payment2 = await feeManager
        .connect(poolOwner)
        .getFixedPaymentAmount(100000, 1025, 12);
      expect(payment2).to.equal(8803);
      const payment3 = await feeManager
        .connect(poolOwner)
        .getFixedPaymentAmount(1000000, 500, 24);
      expect(payment3).to.equal(43871);
    });
  });

  describe("Caclulate nextDueAmount", function () {
    beforeEach(async function () {
      const BaseCreditPool = await ethers.getContractFactory("BaseCreditPool");
      poolContract = await BaseCreditPool.deploy(
        testTokenContract.address,
        humaConfigContract.address,
        poolLockerFactoryContract.address,
        feeManager.address,
        "Base Credit Pool",
        "Base HDT",
        "BHDT"
      );
      await poolContract.deployed();
      poolContract.addCreditApprover(creditApprover.address);

      await testTokenContract.approve(poolContract.address, 100);
      await poolContract.makeInitialDeposit(100);
      await poolContract.enablePool();
      await poolContract.setMinMaxBorrowAmount(10, 1000);
      await poolContract.connect(owner).transferOwnership(poolOwner.address);

      await poolContract.connect(poolOwner).setAPRandInterestOnly(1200, true);
      await poolContract.connect(borrower).requestCredit(400, 30, 12);
      await poolContract
        .connect(creditApprover)
        .approveCredit(borrower.address);
      await testTokenContract
        .connect(lender)
        .approve(poolContract.address, 300);
      await poolContract.connect(lender).deposit(300);
      await testTokenContract.approve(poolContract.address, 400);
      await poolContract.connect(borrower).originateCredit(400);

      record = await poolContract.creditRecordMapping(borrower.address);
      lastLateDate = await poolContract.lastLateFeeDateMapping(
        borrower.address
      );
    });
    it("Should calculate interest only correctly", async function () {});
    it("Should calculate fixed payment amount correctly", async function () {});
    it("Should fallback properly when fixed payment amount lookup failed", async function () {});
  });

  // IntOnly := Interest Only, Fixed := Fixed monthly payment, backFee := backFee,
  describe("getNextPayment()", function () {
    before(async function () {
      const BaseCreditPool = await ethers.getContractFactory("BaseCreditPool");
      poolContract = await BaseCreditPool.deploy(
        testTokenContract.address,
        humaConfigContract.address,
        poolLockerFactoryContract.address,
        feeManager.address,
        "Base Credit Pool",
        "Base HDT",
        "BHDT"
      );
      await poolContract.deployed();
      poolContract.addCreditApprover(creditApprover.address);

      await testTokenContract.approve(poolContract.address, 100);
      await poolContract.makeInitialDeposit(100);
      await poolContract.enablePool();
      await poolContract.setMinMaxBorrowAmount(10, 1000);
      await poolContract.connect(owner).transferOwnership(poolOwner.address);

      await poolContract.connect(poolOwner).setAPRandInterestOnly(1200, true);
      await poolContract.connect(borrower).requestCredit(400, 30, 12);
      await poolContract
        .connect(creditApprover)
        .approveCredit(borrower.address);
      await testTokenContract
        .connect(lender)
        .approve(poolContract.address, 300);
      await poolContract.connect(lender).deposit(300);
      await testTokenContract.approve(poolContract.address, 400);
      await poolContract.connect(borrower).originateCredit(400);

      record = await poolContract.creditRecordMapping(borrower.address);
      lastLateDate = await poolContract.lastLateFeeDateMapping(
        borrower.address
      );
    });
    describe("getNextPayment() - interest only + 1st payment", function () {
      it("IntOnly - 1st pay - amt < interest", async function () {
        let result = await feeManager.getNextPayment(record, lastLateDate, 3);
        expect(result.principal).to.equal(0);
        expect(result.interest).to.equal(0);
        expect(result.fees).to.equal(0);
        expect(result.isLate).to.equal(false);
        expect(result.markPaid).to.equal(false);
        expect(result.paidOff).to.equal(false);
      });
      it("IntOnly - 1st pay - amt = interest", async function () {
        let result = await feeManager.getNextPayment(record, lastLateDate, 4);
        expect(result.principal).to.equal(0);
        expect(result.interest).to.equal(4);
        expect(result.fees).to.equal(0);
        expect(result.isLate).to.equal(false);
        expect(result.markPaid).to.equal(true);
        expect(result.paidOff).to.equal(false);
      });
      it("IntOnly - 1st pay - amt > interest && amt < interest + principal]", async function () {
        let result = await feeManager.getNextPayment(record, lastLateDate, 10);
        expect(result.principal).to.equal(6);
        expect(result.interest).to.equal(4);
        expect(result.fees).to.equal(0);
        expect(result.isLate).to.equal(false);
        expect(result.markPaid).to.equal(true);
        expect(result.paidOff).to.equal(false);
      });
      it("IntOnly - 1st pay - amt = interest + principal (early payoff)", async function () {
        let result = await feeManager.getNextPayment(record, lastLateDate, 404);
        expect(result.principal).to.equal(400);
        expect(result.interest).to.equal(4);
        expect(result.fees).to.equal(0);
        expect(result.isLate).to.equal(false);
        expect(result.markPaid).to.equal(true);
        expect(result.paidOff).to.equal(true);
      });
      it("IntOnly - 1st pay - amt > interest + principal (early payoff, extra pay)", async function () {
        let result = await feeManager.getNextPayment(record, lastLateDate, 500);
        expect(result.principal).to.equal(400);
        expect(result.interest).to.equal(4);
        expect(result.fees).to.equal(0);
        expect(result.isLate).to.equal(false);
        expect(result.markPaid).to.equal(true);
        expect(result.paidOff).to.equal(true);
      });
    });
    describe("getNextPayment() - interest only + 1st payment + late fee", function () {
      before(async function () {
        await ethers.provider.send("evm_increaseTime", [3600 * 24 * 31]);
        await ethers.provider.send("evm_mine", []);
      });
      it("IntOnly - 1st pay - late - amt < interest", async function () {
        let result = await feeManager.getNextPayment(record, lastLateDate, 3);
        console.log("result=", result);
        expect(result.principal).to.equal(0);
        expect(result.interest).to.equal(0);
        expect(result.fees).to.equal(0);
        expect(result.isLate).to.equal(true);
        expect(result.markPaid).to.equal(false);
        expect(result.paidOff).to.equal(false);
      });
      it("IntOnly - 1st pay - late - amt = interest", async function () {
        let result = await feeManager.getNextPayment(record, lastLateDate, 28);
        expect(result.principal).to.equal(0);
        expect(result.interest).to.equal(4);
        expect(result.fees).to.equal(24);
        expect(result.isLate).to.equal(true);
        expect(result.markPaid).to.equal(true);
        expect(result.paidOff).to.equal(false);
      });
      it("IntOnly - 1st pay - late - amt > interest && amt < interest + principal]", async function () {
        let result = await feeManager.getNextPayment(record, lastLateDate, 50);
        expect(result.principal).to.equal(22);
        expect(result.interest).to.equal(4);
        expect(result.fees).to.equal(24);
        expect(result.isLate).to.equal(true);
        expect(result.markPaid).to.equal(true);
        expect(result.paidOff).to.equal(false);
      });
      it("IntOnly - 1st pay - late - amt = interest + principal (early payoff)", async function () {
        let result = await feeManager.getNextPayment(record, lastLateDate, 428);
        expect(result.principal).to.equal(400);
        expect(result.interest).to.equal(4);
        expect(result.fees).to.equal(24);
        expect(result.isLate).to.equal(true);
        expect(result.markPaid).to.equal(true);
        expect(result.paidOff).to.equal(true);
      });
      it("IntOnly - 1st pay - late - amt > interest + principal (early payoff, extra pay)", async function () {
        let result = await feeManager.getNextPayment(record, lastLateDate, 500);
        expect(result.principal).to.equal(400);
        expect(result.interest).to.equal(4);
        expect(result.fees).to.equal(24);
        expect(result.isLate).to.equal(true);
        expect(result.markPaid).to.equal(true);
        expect(result.paidOff).to.equal(true);
      });
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
});
