/* eslint-disable no-underscore-dangle */
const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

use(solidity);

let checkResult = function(r, v1, v2, v3, v4, v5, v6) {
  expect(r.principal).to.equal(v1);
  expect(r.interest).to.equal(v2);
  expect(r.fees).to.equal(v3);
  expect(r.isLate).to.equal(v4);
  expect(r.markPaid).to.equal(v5);
  expect(r.paidOff).to.equal(v6);
};

describe.skip("Base Fee Manager", function() {
  let poolContract;
  let humaConfigContract;
  let testToken;
  let feeManager;
  let owner;
  let lender;
  let borrower;
  let treasury;
  let creditApprover;
  let poolOwner;
  let record;
  let lastLateDate;

  before(async function() {
    [
      owner,
      lender,
      borrower,
      treasury,
      creditApprover,
      poolOwner
    ] = await ethers.getSigners();

    // Deploy HumaConfig
    const HumaConfig = await ethers.getContractFactory("HumaConfig");
    humaConfigContract = await HumaConfig.deploy(treasury.address);
    humaConfigContract.setHumaTreasury(treasury.address);

    // Deploy PoolLockerFactory
    const poolLockerFactory = await ethers.getContractFactory(
      "PoolLockerFactory"
    );
    poolLockerFactoryContract = await poolLockerFactory.deploy();

    // Deploy Fee Manager
    const feeManagerFactory = await ethers.getContractFactory("BaseFeeManager");
    feeManager = await feeManagerFactory.deploy();
    await feeManager.setFees(10, 100, 20, 10000);

    // Deploy TestToken, give initial tokens to lender
    const TestToken = await ethers.getContractFactory("TestToken");
    testToken = await TestToken.deploy();
    testToken.give1000To(lender.address);

    // Deploy BaseCreditPool
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

    // Pool setup
    await poolContract.transferOwnership(poolOwner.address);
    await feeManager.transferOwnership(poolOwner.address);

    await testToken.approve(poolContract.address, 100);
    await poolContract.makeInitialDeposit(100);
    await poolContract.enablePool();
    await poolContract.setMinMaxBorrowAmount(10, 1000);
  });

  describe("Huma Pool Settings", function() {
    // todo Verify only pool admins can deployNewPool

    it("Should set the fees correctly", async function() {
      var [f1, f2, f3, f4] = await feeManager.getFees();
      expect(f1).to.equal(10);
      expect(f2).to.equal(100);
      expect(f3).to.equal(20);
      expect(f4).to.equal(10000);
    });

    it("Should disallow non-owner to set the fees", async function() {
      await expect(
        feeManager.connect(treasury).setFees(10, 100, 20, 10000)
      ).to.be.revertedWith("caller is not the owner"); // open zeppelin default error message
    });

    it("Should allow owner to set the fees", async function() {
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
  describe("Installment setting and lookup", function() {
    it("Should disallow non-owner to set payment schedule", async function() {
      await expect(
        feeManager.connect(treasury).addInstallment(24, 500, 43871)
      ).to.be.revertedWith("caller is not the owner");
    });

    it("Should allow a single payment schedule to be added", async function() {
      await feeManager.connect(poolOwner).addInstallment(24, 500, 43871);

      const payment = await feeManager
        .connect(poolOwner)
        .getInstallmentAmount(1000000, 500, 24);
      expect(payment).to.equal(43871);
    });

    it("Should allow existing payment schedule  to be updated", async function() {
      await feeManager.connect(poolOwner).addInstallment(24, 500, 43872);

      const payment = await feeManager
        .connect(poolOwner)
        .getInstallmentAmount(1000000, 500, 24);
      expect(payment).to.equal(43872);
    });

    it("Should reject batch input of installment schedule if array lengths do not match", async function() {
      let terms = [24, 24];
      let aprInBps = [1000, 1025];
      let payments = [46260];

      await expect(
        feeManager
          .connect(poolOwner)
          .addBatchOfInstallments(terms, aprInBps, payments)
      ).to.be.revertedWith("INPUT_ARRAY_SIZE_MISMATCH");
    });

    it("Should allow list of installment schedule to be added", async function() {
      let terms = [12, 12, 12, 12, 12, 12, 12, 24, 24, 24, 24, 24, 24, 24];
      let aprInBps = [
        500,
        600,
        700,
        800,
        900,
        1000,
        1025,
        500,
        600,
        700,
        800,
        900,
        1000,
        1025
      ];
      let payments = [
        85607,
        86066,
        86527,
        86988,
        87451,
        87916,
        88032,
        43871,
        44321,
        44773,
        45227,
        45685,
        46145,
        46260
      ];

      await feeManager
        .connect(poolOwner)
        .addBatchOfInstallments(terms, aprInBps, payments);

      const payment1 = await feeManager
        .connect(poolOwner)
        .getInstallmentAmount(10000000, 500, 12);
      expect(payment1).to.equal(856070);
      const payment2 = await feeManager
        .connect(poolOwner)
        .getInstallmentAmount(100000, 1025, 12);
      expect(payment2).to.equal(8803);
      const payment3 = await feeManager
        .connect(poolOwner)
        .getInstallmentAmount(1000000, 500, 24);
      expect(payment3).to.equal(43871);
    });
  });

  describe("Caclulate dueAmount", function() {
    beforeEach(async function() {
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
      await testToken.connect(lender).approve(poolContract.address, 300);
      await poolContract.connect(lender).deposit(300);
    });

    it("Should calculate interest-only monthly payment correctly", async function() {
      await poolContract.connect(poolOwner).setAPRandPayScheduleOption(1200, 0);
      await poolContract.connect(borrower).requestCredit(400, 30, 12);
      await poolContract
        .connect(creditApprover)
        .approveCredit(borrower.address);
      await testToken.approve(poolContract.address, 400);
      await poolContract.connect(borrower).drawdown(400);

      record = await poolContract.creditRecordMapping(borrower.address);
      expect(record.dueAmount).to.equal(4);
    });

    it("Should revert when installment schedule lookup fails", async function() {
      await feeManager.connect(poolOwner).addInstallment(12, 1000, 87916);
      await poolContract.connect(poolOwner).setAPRandPayScheduleOption(1500, 2);
      await poolContract.connect(borrower).requestCredit(1000, 30, 12);
      await poolContract
        .connect(creditApprover)
        .approveCredit(borrower.address);

      await expect(
        poolContract.connect(borrower).drawdown(1000)
      ).to.revertedWith("PRICE_NOT_EXIST");
    });

    it("Should calculate installment amount correctly", async function() {
      await feeManager.connect(poolOwner).addInstallment(12, 1000, 87916);
      expect(await feeManager.getInstallmentAmount(1000000, 1000, 12)).to.equal(
        87916
      );
      await poolContract.connect(poolOwner).setAPRandPayScheduleOption(1000, 2);
      await poolContract.connect(borrower).requestCredit(1000, 30, 12);
      await poolContract
        .connect(creditApprover)
        .approveCredit(borrower.address);
      await testToken.connect(lender).approve(poolContract.address, 1000);
      await poolContract.connect(lender).deposit(1000);
      await poolContract.connect(borrower).drawdown(1000);

      record = await poolContract.creditRecordMapping(borrower.address);
      expect(record.dueAmount).to.be.within(87, 88);
    });
  });

  // IntOnly := Interest-only, Fixed := Fixed-monthly-payment
  describe("getNextPayment()", function() {
    before(async function() {
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
      await poolContract.connect(poolOwner).setAPRandPayScheduleOption(1200, 0);
      await testToken.connect(lender).approve(poolContract.address, 300);
      await poolContract.connect(lender).deposit(300);
    });

    // For interest-only, we test various scenarios for the 1st, 2nd and the final payment
    // Within each group, we test scenarios with no late fee, followed by late fees
    // After testing scenarios for 1st payment, we will process one payment incl. late fees
    // After testing scenarios for 2nd payment, we will process ten payments to get ready
    // to test the final payment.
    describe("Interest-only", async function() {
      before(async function() {
        // Create a borrowing record
        await poolContract.connect(borrower).requestCredit(400, 30, 12);
        await poolContract
          .connect(creditApprover)
          .approveCredit(borrower.address);
        await testToken.connect(lender).approve(poolContract.address, 300);
        await poolContract.connect(borrower).drawdown(400);
        record = await poolContract.creditRecordMapping(borrower.address);
        lastLateDate = 0;
        // lastLateDate = await poolContract.lastLateFeeDateMapping(
        //   borrower.address
        // );
      });
      describe("1st Payment", async function() {
        // After testing 1st payment, advance the payment schedule by making one payment
        after(async function() {
          let creditInfo = await poolContract.getCreditInformation(
            borrower.address
          );
          let oldDueDate = creditInfo.dueDate;
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
          expect(creditInfo.creditLimit).to.equal(400);
          expect(creditInfo.dueAmount).to.equal(4);
          expect(creditInfo.paymentIntervalInDays).to.equal(30);
          expect(Number(creditInfo.dueDate)).to.equal(newDueDate);
        });

        describe("No late fee", async function() {
          it("IntOnly - 1st pay - amt < monthly payment", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 3);
            checkResult(r, 0, 0, 0, false, false, false);
          });
          it("IntOnly - 1st pay - amt = exact monthly payment", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 4);
            checkResult(r, 0, 4, 0, false, true, false);
          });
          it("IntOnly - 1st pay - amt > monthly payment but short of payoff", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 10);
            checkResult(r, 6, 4, 0, false, true, false);
          });
          it("IntOnly - 1st pay - amt = early payoff", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 404);
            checkResult(r, 400, 4, 0, false, true, true);
          });
          it("IntOnly - 1st pay - amt > early payoff, extra pay", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 500);
            checkResult(r, 400, 4, 0, false, true, true);
          });
        }); // end of "interest-only + 1st payment + no late fee"

        describe("Late fee", async function() {
          before(async function() {
            await ethers.provider.send("evm_increaseTime", [3600 * 24 * 31]);
            await ethers.provider.send("evm_mine", []);
          });
          after(async function() {});
          it("IntOnly - 1st pay - late - amt < monthly payment", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 3);
            checkResult(r, 0, 0, 0, true, false, false);
          });
          it("IntOnly - 1st pay - late - amt = monthly payment", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 28);
            checkResult(r, 0, 4, 24, true, true, false);
          });
          it("IntOnly - 1st pay - late - amt > monthly payment but short of payoff", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 50);
            checkResult(r, 22, 4, 24, true, true, false);
          });
          it("IntOnly - 1st pay - late - amt = early payoff", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 428);
            checkResult(r, 400, 4, 24, true, true, true);
          });
          it("IntOnly - 1st pay - late - amt > early payoff, extra pay", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 500);
            checkResult(r, 400, 4, 24, true, true, true);
          });
        }); // end of "Interest-only + 1st payment + late fee"
      }); // end of 1st payment

      describe("2nd payment", function() {
        before(async function() {
          record = await poolContract.creditRecordMapping(borrower.address);
          lastLateDate = 0;
          // lastLateDate = await poolContract.lastLateFeeDateMapping(
          //   borrower.address
          // );
        });
        after(async function() {
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
            await poolContract
              .connect(borrower)
              .makePayment(testToken.address, 4);
            await ethers.provider.send("evm_increaseTime", [3600 * 24 * 30]);
            await ethers.provider.send("evm_mine", []);
          }
          // Make sure the credit record is correct.
          creditInfo = await poolContract.getCreditInformation(
            borrower.address
          );
          expect(creditInfo.balance).to.equal(400);
          expect(creditInfo.dueAmount).to.equal(404);
          expect(creditInfo.remainingPayments).to.equal(1);
        });

        describe("No late fee", function() {
          it("IntOnly - 2nd pay - amt < monthly payment", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 3);
            checkResult(r, 0, 0, 0, false, false, false);
          });
          it("IntOnly - 2nd pay - amt = monthly payment", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 4);
            checkResult(r, 0, 4, 0, false, true, false);
          });
          it("IntOnly - 2nd pay - amt > monthly payment but short of payoff", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 10);
            checkResult(r, 6, 4, 0, false, true, false);
          });
          it("IntOnly - 2nd pay - amt = early payoff", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 404);
            checkResult(r, 400, 4, 0, false, true, true);
          });
          it("IntOnly - 2nd pay - amt > early payoff, extra pay", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 500);
            checkResult(r, 400, 4, 0, false, true, true);
          });
        }); // interest-only + 2nd payment + no late fee

        describe("Late fee", function() {
          before(async function() {
            await ethers.provider.send("evm_increaseTime", [3600 * 24 * 31]);
            await ethers.provider.send("evm_mine", []);
          });
          after(async function() {});
          it("IntOnly - 2nd pay - late - amt < monthly payment", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 3);
            checkResult(r, 0, 0, 0, true, false, false);
          });
          it("IntOnly - 2nd pay - late - amt = monthly payment", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 28);
            checkResult(r, 0, 4, 24, true, true, false);
          });
          it("IntOnly - 2nd pay - late - amt > monthly payment but short of payoff", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 50);
            checkResult(r, 22, 4, 24, true, true, false);
          });
          it("IntOnly - 2nd pay - late - amt = early payoff", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 428);
            checkResult(r, 400, 4, 24, true, true, true);
          });
          it("IntOnly - 2nd pay - late - amt > early payoff, extra pay", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 500);
            checkResult(r, 400, 4, 24, true, true, true);
          });
        }); // "interest-only + 2nd payment + late fee"
      }); // end of IntOnly + 2nd payment

      describe("Final payment", function() {
        before(async function() {
          record = await poolContract.creditRecordMapping(borrower.address);
          lastLateDate = 0;
          // lastLateDate = await poolContract.lastLateFeeDateMapping(
          //   borrower.address
          // );
        });
        after(async function() {
          // Make the final payment with late fee so that we can delete the credit record
          testToken.give1000To(borrower.address);
          await testToken.connect(borrower).approve(poolContract.address, 828);
          await poolContract
            .connect(borrower)
            .makePayment(testToken.address, 828);
          creditInfo = await poolContract.getCreditInformation(
            borrower.address
          );
          expect(creditInfo.balance).to.equal(0);
          expect(creditInfo.dueAmount).to.equal(0);
          expect(creditInfo.dueDate).to.equal(0);
          expect(creditInfo.state).to.equal(0); // Means "Deleted"
        });

        describe("No fee", function() {
          it("IntOnly - final pay - amt < monthly payment", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 3);
            checkResult(r, 0, 0, 0, false, false, false);
          });
          it("IntOnly - final pay - amt = monthly interest payment", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 4);
            checkResult(r, 0, 0, 0, false, false, false);
          });
          it("IntOnly - final pay - amt = payoff", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 404);
            checkResult(r, 400, 4, 0, false, true, true);
          });
          it("IntOnly - final pay - amt > payoff, extra pay", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 500);
            checkResult(r, 400, 4, 0, false, true, true);
          });
        }); // interest-only + final payment + no late fee

        describe("Late fee", function() {
          before(async function() {
            await ethers.provider.send("evm_increaseTime", [3600 * 24 * 31]);
            await ethers.provider.send("evm_mine", []);
          });
          after(async function() {});
          it("IntOnly - final pay - late - amt < monthly interest payment", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 3);
            checkResult(r, 0, 0, 0, true, false, false);
          });
          it("IntOnly - final pay - late - amt = monthly interest payment + late fee", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 28);
            checkResult(r, 0, 0, 0, true, false, false);
          });
          it("IntOnly - final pay - late - amt = interest + fee + principal (payoff)", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 828);
            checkResult(r, 400, 4, 424, true, true, true);
          });
          it("IntOnly - final pay - late - amt > interest + fee + principal (payoff, extra pay)", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 900);
            checkResult(r, 400, 4, 424, true, true, true);
          });
        }); // end of "interest-only + final payment + late fee"
      }); // end of IntOnly + final payment
    }); // end of IntOnly

    describe("Installment", async function() {
      before(async function() {
        await feeManager.connect(poolOwner).addInstallment(12, 1000, 87916);
        // Set pool type to installment.
        await poolContract.setAPRandPayScheduleOption(1000, 2);
        await testToken.connect(lender).approve(poolContract.address, 10000);
        await poolContract.connect(lender).deposit(10000);

        // Create a borrowing record
        await poolContract.connect(borrower).requestCredit(1000, 30, 12);
        await poolContract
          .connect(creditApprover)
          .approveCredit(borrower.address);
        await testToken.connect(lender).approve(poolContract.address, 1000);
        //await poolContract.connect(lender).deposit(1000);
        await poolContract.connect(borrower).drawdown(1000);

        record = await poolContract.creditRecordMapping(borrower.address);

        lastLateDate = 0;
        // lastLateDate = await poolContract.lastLateFeeDateMapping(
        //   borrower.address
        // );
      });
      describe("1st Payment", async function() {
        // After testing 1st payment, advance the payment schedule by making one payment
        after(async function() {
          let creditInfo = await poolContract.getCreditInformation(
            borrower.address
          );
          let oldDueDate = creditInfo.dueDate;
          await testToken.connect(borrower).approve(poolContract.address, 194);
          await poolContract
            .connect(borrower)
            .makePayment(testToken.address, 194);
          creditInfo = await poolContract.getCreditInformation(
            borrower.address
          );
          let newDueDate =
            Number(oldDueDate) +
            Number(creditInfo.paymentIntervalInDays * 3600 * 24);
          expect(creditInfo.creditLimit).to.equal(1000);
          expect(creditInfo.balance).to.equal(921);
          expect(creditInfo.dueAmount).to.equal(87);
          expect(creditInfo.paymentIntervalInDays).to.equal(30);
          expect(Number(creditInfo.dueDate)).to.equal(newDueDate);
        });
        describe("No late fee", async function() {
          it("Installment - 1st pay - amt < due", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 80);
            checkResult(r, 0, 0, 0, false, false, false);
          });
          it("Installment - 1st pay - amt = due", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 87);
            checkResult(r, 79, 8, 0, false, true, false);
          });
          it("Installment - 1st pay - amt > due && amt < due + balance", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 1000);
            checkResult(r, 992, 8, 0, false, true, false);
          });
          it("Installment - 1st pay - amt = due + balance (early payoff)", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 1008);
            checkResult(r, 1000, 8, 0, false, true, true);
          });
          it("Installment - 1st pay - amt > interest + balance (early payoff, extra pay)", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 1100);
            checkResult(r, 1000, 8, 0, false, true, true);
          });
        }); // end of "interest-only + 1st payment + no late fee"

        describe("Late fee", async function() {
          before(async function() {
            await ethers.provider.send("evm_increaseTime", [3600 * 24 * 31]);
            await ethers.provider.send("evm_mine", []);
          });
          after(async function() {});
          it("Installment - 1st pay - late - amt < monthly payment + late", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 87);
            checkResult(r, 0, 0, 0, true, false, false);
          });
          it("Installment - 1st pay - late - amt = monthly payment + late", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 194);
            checkResult(r, 79, 8, 107, true, true, false);
          });
          it("Installment - 1st pay - late - amt > monthly payment + late && amt < payoff", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 200);
            checkResult(r, 85, 8, 107, true, true, false);
          });
          it("Installment - 1st pay - late - amt = monthly payment + late + principal delta (early payoff)", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 1115);
            checkResult(r, 1000, 8, 107, true, true, true);
          });
          it("Installment - 1st pay - late - amt > monthly payment + late + principal delta (early payoff, extra pay)", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 1200);
            checkResult(r, 1000, 8, 107, true, true, true);
          });
        }); // "interest-only + 1st payment + late fee"
      }); // end of 1st payment

      describe("2nd payment", function() {
        before(async function() {
          record = await poolContract.creditRecordMapping(borrower.address);
          lastLateDate = 0;
          // lastLateDate = await poolContract.lastLateFeeDateMapping(
          //   borrower.address
          // );
        });
        after(async function() {
          // Make 10 more payments to get ready for the final payment test.
          testToken.give1000To(borrower.address);
          await testToken.connect(borrower).approve(poolContract.address, 1000);
          // Make the second payment with late fee.
          await poolContract
            .connect(borrower)
            .makePayment(testToken.address, 194);
          await ethers.provider.send("evm_increaseTime", [3600 * 24 * 27]);
          await ethers.provider.send("evm_mine", []);
          // Make the 3rd to 11th payments, no late fee
          for (let i = 0; i < 9; i++) {
            await poolContract
              .connect(borrower)
              .makePayment(testToken.address, 87);
            await ethers.provider.send("evm_increaseTime", [3600 * 24 * 30]);
            await ethers.provider.send("evm_mine", []);
          }
          // Check if the credit record is correct.
          creditInfo = await poolContract.getCreditInformation(
            borrower.address
          );
          expect(creditInfo.balance).to.equal(92);
          expect(creditInfo.dueAmount).to.equal(92);
          expect(creditInfo.remainingPayments).to.equal(1);
        });

        describe("No late fee", function() {
          it("Installment - 2nd pay - amt < monthlyPayment", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 80);
            checkResult(r, 0, 0, 0, false, false, false);
          });
          it("Installment - 2nd pay - amt = monthlyPayment", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 87);
            checkResult(r, 80, 7, 0, false, true, false);
          });
          it("Installment - 2nd pay - amt > monthlyPayment && amt < payoff", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 100);
            checkResult(r, 93, 7, 0, false, true, false);
          });
          it("Installment - 2nd pay - amt = monthlyPayment + balance (early payoff)", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 928);
            checkResult(r, 921, 7, 0, false, true, true);
          });
          it("Installment - 2nd pay - amt > monthlyPayment + balance (early payoff, extra pay)", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 1000);
            checkResult(r, 921, 7, 0, false, true, true);
          });
        }); // interest-only + 2nd payment + no late fee

        describe("Late fee", function() {
          before(async function() {
            await ethers.provider.send("evm_increaseTime", [3600 * 24 * 31]);
            await ethers.provider.send("evm_mine", []);
          });
          it("Installment - 2nd pay - late - amt < monthly due + fee", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 87);
            checkResult(r, 0, 0, 0, true, false, false);
          });
          it("Installment - 2nd pay - late - amt = monthly due + fee", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 194);
            checkResult(r, 80, 7, 107, true, true, false);
          });
          it("Installment - 2nd pay - late - amt > interest && amt < payoff", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 900);
            checkResult(r, 786, 7, 107, true, true, false);
          });
          it("Installment - 2nd pay - late - amt = interest + balance (early payoff)", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 1035);
            checkResult(r, 921, 7, 107, true, true, true);
          });
          it("Installment - 2nd pay - late - amt > interest + balance (early payoff, extra pay)", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 1100);
            checkResult(r, 921, 7, 107, true, true, true);
          });
        }); // enf of Fixed + 2nd payment + late fee
      }); // end of Fixed + 2nd payment

      describe("Final payment", function() {
        before(async function() {
          record = await poolContract.creditRecordMapping(borrower.address);
          lastLateDate = 0;
          // lastLateDate = await poolContract.lastLateFeeDateMapping(
          //   borrower.address
          // );
        });
        describe("No late fee", function() {
          it("Installment - final pay - amt < due", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 80);
            checkResult(r, 0, 0, 0, false, false, false);
          });
          it("Installment - final pay - amt = due (payoff)", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 92);
            checkResult(r, 92, 0, 0, false, true, true);
          });
          it("Installment - final pay - amt > due (payoff, extra pay)", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 100);
            checkResult(r, 92, 0, 0, false, true, true);
          });
        }); // Installment + final + no late fee
        describe("Late fee", function() {
          before(async function() {
            await ethers.provider.send("evm_increaseTime", [3600 * 24 * 31]);
            await ethers.provider.send("evm_mine", []);
          });
          after(async function() {});
          it("Installment - final pay - late - amt < monthlyPayment < due + interest", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 87);
            checkResult(r, 0, 0, 0, true, false, false);
          });
          it("Installment - final pay - late - amt = due", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 92);
            checkResult(r, 0, 0, 0, true, false, false);
          });
          it("Installment - final pay - late - amt = due + fee (payoff)", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 204);
            checkResult(r, 92, 0, 112, true, true, true);
          });
          it("Installment - final pay - late - amt > due + fee (payoff, extra pay)", async function() {
            let r = await feeManager.getNextPayment(record, lastLateDate, 300);
            checkResult(r, 92, 0, 112, true, true, true);
          });
        }); // end of Installment + final payment + late fee
      }); // end of Installment + final payment
    }); // end of Installment
  });
});
