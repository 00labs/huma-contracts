/* eslint-disable no-underscore-dangle */
const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

use(solidity);

let checkResult = function (r, v1, v2, v3, v4, v5, v6) {
  expect(r.principal).to.equal(v1);
  expect(r.interest).to.equal(v2);
  expect(r.fees).to.equal(v3);
  expect(r.isLate).to.equal(v4);
  expect(r.markPaid).to.equal(v5);
  expect(r.paidOff).to.equal(v6);
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
  let testToken;
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
    await feeManager.setFees(10, 100, 20, 10000);

    const TestToken = await ethers.getContractFactory("TestToken");
    testToken = await TestToken.deploy();
    testToken.give1000To(lender.address);

    const BaseCreditPool = await ethers.getContractFactory("BaseCreditPool");
    poolContract = await BaseCreditPool.deploy(
      testToken.address,
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

    await testToken.approve(poolContract.address, 100);
    await poolContract.makeInitialDeposit(100);
    await poolContract.enablePool();
    await poolContract.setMinMaxBorrowAmount(10, 1000);

    await testToken.approve(poolContract.address, 100);
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
      await feeManager.connect(poolOwner).setFees(15, 150, 25, 250);

      var [f1, f2, f3, f4] = await feeManager.getFees();
      expect(f1).to.equal(15);
      expect(f2).to.equal(150);
      expect(f3).to.equal(25);
      expect(f4).to.equal(250);

      await feeManager.connect(poolOwner).setFees(10, 100, 20, 10000);
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
        testToken.address,
        humaConfigContract.address,
        poolLockerFactoryContract.address,
        feeManager.address,
        "Base Credit Pool",
        "Base HDT",
        "BHDT"
      );
      await poolContract.deployed();
      poolContract.addCreditApprover(creditApprover.address);

      await testToken.approve(poolContract.address, 100);
      await poolContract.makeInitialDeposit(100);
      await poolContract.enablePool();
      await poolContract.setMinMaxBorrowAmount(10, 1000);
      await poolContract.connect(owner).transferOwnership(poolOwner.address);

      await poolContract.connect(poolOwner).setAPRandInterestOnly(1200, true);
      await poolContract.connect(borrower).requestCredit(400, 30, 12);
      await poolContract
        .connect(creditApprover)
        .approveCredit(borrower.address);
      await testToken.connect(lender).approve(poolContract.address, 300);
      await poolContract.connect(lender).deposit(300);
      await testToken.approve(poolContract.address, 400);
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
  // If before(), deploy and setup the pool
  // In describe(interest-only),
  describe("getNextPayment()", function () {
    before(async function () {
      const BaseCreditPool = await ethers.getContractFactory("BaseCreditPool");
      poolContract = await BaseCreditPool.deploy(
        testToken.address,
        humaConfigContract.address,
        poolLockerFactoryContract.address,
        feeManager.address,
        "Base Credit Pool",
        "Base HDT",
        "BHDT"
      );
      await poolContract.deployed();
      poolContract.addCreditApprover(creditApprover.address);

      // Setup the pool
      await testToken.approve(poolContract.address, 100);
      await poolContract.makeInitialDeposit(100);
      await poolContract.enablePool();
      await poolContract.setMinMaxBorrowAmount(10, 1000);
      await poolContract.transferOwnership(poolOwner.address);
      await poolContract.connect(poolOwner).setAPRandInterestOnly(1200, true);
      await testToken.connect(lender).approve(poolContract.address, 300);
      await poolContract.connect(lender).deposit(300);
    });
    describe.only("Interest-only", async function () {
      before(async function () {
        // Create a borrowing record
        await poolContract.connect(borrower).requestCredit(400, 30, 12);
        await poolContract
          .connect(creditApprover)
          .approveCredit(borrower.address);
        await testToken.connect(lender).approve(poolContract.address, 300);
        await poolContract.connect(borrower).originateCredit(400);

        record = await poolContract.creditRecordMapping(borrower.address);
        lastLateDate = await poolContract.lastLateFeeDateMapping(
          borrower.address
        );
      });
      describe("Interest-only + 1st Payment", async function () {
        // After testing 1st payment, advance the payment schedule by making one payment
        after(async function () {
          console.log("*** In after interest-only+1st");
          let creditInfo = await poolContract.getCreditInformation(
            borrower.address
          );
          let oldDueDate = creditInfo.nextDueDate;
          await testToken.connect(borrower).approve(poolContract.address, 28);
          await poolContract
            .connect(borrower)
            .makePayment(testToken.address, 28);
          creditInfo = await poolContract.getCreditInformation(
            borrower.address
          );
          let newDueDate =
            Number(oldDueDate) +
            Number(creditInfo.paymentIntervalInDays * 3600 * 24);
          expect(creditInfo.loanAmount).to.equal(400);
          expect(creditInfo.nextAmountDue).to.equal(4);
          expect(creditInfo.paymentIntervalInDays).to.equal(30);
          expect(Number(creditInfo.nextDueDate)).to.equal(newDueDate);
        });
        describe("interest only + 1st payment + no late fee", async function () {
          it("IntOnly - 1st pay - amt < interest", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 3);
            checkResult(r, 0, 0, 0, false, false, false);
          });
          it("IntOnly - 1st pay - amt = interest", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 4);
            checkResult(r, 0, 4, 0, false, true, false);
          });
          it("IntOnly - 1st pay - amt > interest && amt < interest + principal]", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 10);
            checkResult(r, 6, 4, 0, false, true, false);
          });
          it("IntOnly - 1st pay - amt = interest + principal (early payoff)", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 404);
            checkResult(r, 400, 4, 0, false, true, true);
          });
          it("IntOnly - 1st pay - amt > interest + principal (early payoff, extra pay)", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 500);
            checkResult(r, 400, 4, 0, false, true, true);
          });
        }); // end of "interest only + 1st payment + no late fee"
        describe("interest only + 1st payment + late fee", async function () {
          before(async function () {
            await ethers.provider.send("evm_increaseTime", [3600 * 24 * 31]);
            await ethers.provider.send("evm_mine", []);
          });
          after(async function () {});
          it("IntOnly - 1st pay - late - amt < interest", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 3);
            checkResult(r, 0, 0, 0, true, false, false);
          });
          it("IntOnly - 1st pay - late - amt = interest", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 28);
            checkResult(r, 0, 4, 24, true, true, false);
          });
          it("IntOnly - 1st pay - late - amt > interest && amt < interest + principal]", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 50);
            checkResult(r, 22, 4, 24, true, true, false);
          });
          it("IntOnly - 1st pay - late - amt = interest + principal (early payoff)", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 428);
            checkResult(r, 400, 4, 24, true, true, true);
          });
          it("IntOnly - 1st pay - late - amt > interest + principal (early payoff, extra pay)", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 500);
            checkResult(r, 400, 4, 24, true, true, true);
          });
        }); // "interest only + 1st payment + late fee"
      }); // end of 1st payment

      describe("IntOnly + 2nd payment", function () {
        before(async function () {
          record = await poolContract.creditRecordMapping(borrower.address);
          lastLateDate = await poolContract.lastLateFeeDateMapping(
            borrower.address
          );
        });
        after(async function () {
          // Make 10 more payments to get ready for the final payment test.
          await testToken.connect(borrower).approve(poolContract.address, 64);
          // Make the second payment with late fee.
          await poolContract
            .connect(borrower)
            .makePayment(testToken.address, 28);
          await ethers.provider.send("evm_increaseTime", [3600 * 24 * 27]);
          await ethers.provider.send("evm_mine", []);

          // Make the 3rd to 11th payments, no late fee
          for (let i = 0; i < 9; i++) {
            console.log("i=", i);
            await poolContract
              .connect(borrower)
              .makePayment(testToken.address, 4);
            await ethers.provider.send("evm_increaseTime", [3600 * 24 * 30]);
            await ethers.provider.send("evm_mine", []);
          }
          // Check if the credit record is correct.
          creditInfo = await poolContract.getCreditInformation(
            borrower.address
          );
          expect(creditInfo.remainingPrincipal).to.equal(400);
          expect(creditInfo.nextAmountDue).to.equal(404);
          expect(creditInfo.remainingPayments).to.equal(1);
        });
        describe("interest only + 2nd payment + no fee", function () {
          it("IntOnly - 2nd pay - amt < interest", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 3);
            checkResult(r, 0, 0, 0, false, false, false);
          });
          it("IntOnly - 2nd pay - amt = interest", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 4);
            checkResult(r, 0, 4, 0, false, true, false);
          });
          it("IntOnly - 2nd pay - amt > interest && amt < interest + principal]", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 10);
            checkResult(r, 6, 4, 0, false, true, false);
          });
          it("IntOnly - 2nd pay - amt = interest + principal (early payoff)", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 404);
            checkResult(r, 400, 4, 0, false, true, true);
          });
          it("IntOnly - 2nd pay - amt > interest + principal (early payoff, extra pay)", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 500);
            checkResult(r, 400, 4, 0, false, true, true);
          });
        }); // interest only + 2nd payment + no late fee
        describe("interest only + 2nd payment + late fee", function () {
          before(async function () {
            await ethers.provider.send("evm_increaseTime", [3600 * 24 * 31]);
            await ethers.provider.send("evm_mine", []);
          });
          after(async function () {});
          it("IntOnly - 2nd pay - late - amt < interest", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 3);
            checkResult(r, 0, 0, 0, true, false, false);
          });
          it("IntOnly - 2nd pay - late - amt = interest", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 28);
            checkResult(r, 0, 4, 24, true, true, false);
          });
          it("IntOnly - 2nd pay - late - amt > interest && amt < interest + principal]", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 50);
            checkResult(r, 22, 4, 24, true, true, false);
          });
          it("IntOnly - 2nd pay - late - amt = interest + principal (early payoff)", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 428);
            checkResult(r, 400, 4, 24, true, true, true);
          });
          it("IntOnly - 2nd pay - late - amt > interest + principal (early payoff, extra pay)", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 500);
            checkResult(r, 400, 4, 24, true, true, true);
          });
        }); // "interest only + 2nd payment + late fee"
      }); // end of IntOnly + 2nd payment

      describe("Final payment + IntOnly", function () {
        before(async function () {
          record = await poolContract.creditRecordMapping(borrower.address);
          lastLateDate = await poolContract.lastLateFeeDateMapping(
            borrower.address
          );
        });
        after(async function () {
          // Make the final payment with late fee
          testToken.give1000To(borrower.address);

          await testToken.connect(borrower).approve(poolContract.address, 828);
          console.log("");
          await poolContract
            .connect(borrower)
            .makePayment(testToken.address, 828);
          creditInfo = await poolContract.getCreditInformation(
            borrower.address
          );
          expect(creditInfo.remainingPrincipal).to.equal(0);
          expect(creditInfo.nextAmountDue).to.equal(0);
          expect(creditInfo.nextDueDate).to.equal(0);
          expect(creditInfo.deleted).to.equal(true);
        });
        describe("interest only + final payment + no fee", function () {
          it("IntOnly - final pay - amt < interest", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 3);
            checkResult(r, 0, 0, 0, false, false, false);
          });
          it("IntOnly - final pay - amt < interest + principal", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 4);
            checkResult(r, 0, 0, 0, false, false, false);
          });
          it("IntOnly - final pay - amt = interest + principal (payoff)", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 404);
            checkResult(r, 400, 4, 0, false, true, true);
          });
          it("IntOnly - final pay - amt > interest + principal (payoff, extra pay)", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 500);
            checkResult(r, 400, 4, 0, false, true, true);
          });
        }); // interest only + final payment + no late fee
        describe("interest only + final payment + late fee", function () {
          before(async function () {
            await ethers.provider.send("evm_increaseTime", [3600 * 24 * 31]);
            await ethers.provider.send("evm_mine", []);
          });
          after(async function () {});
          it("IntOnly - final pay - late - amt < interest", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 3);
            checkResult(r, 0, 0, 0, true, false, false);
          });
          it("IntOnly - final pay - late - amt = int. + fees < int. + fee + principal", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 28);
            checkResult(r, 0, 0, 0, true, false, false);
          });
          it("IntOnly - final pay - late - amt = int. + fee + principal (payoff)", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 828);
            checkResult(r, 400, 4, 424, true, true, true);
          });
          it("IntOnly - final pay - late - amt > interest + fee + principal (payoff, extra pay)", async function () {
            let r = await feeManager.getNextPayment(record, lastLateDate, 900);
            checkResult(r, 400, 4, 424, true, true, true);
          });
        }); // "interest only + final payment + late fee"
      }); // end of IntOnly + final payment
    }); // end of IntOnly

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
