/* eslint-disable no-underscore-dangle */
const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

use(solidity);

let checkResult = function(r, v1, v2, v3, v4) {
  expect(r.periodsPassed).to.equal(v1);
  expect(r.feesAndInterestDue).to.equal(v2);
  expect(r.totalDue).to.equal(v3);
  expect(r.payoffAmount).to.equal(v4);
};

describe("Base Fee Manager", function() {
  let poolContract;
  let humaConfigContract;
  let testToken;
  let feeManager;
  let owner;
  let lender;
  let borrower;
  let treasury;
  let evaluationAgent;
  let poolOwner;
  let record;
  let lastLateDate;
  let initialTimestamp;

  before(async function() {
    [owner, lender, borrower, treasury, evaluationAgent, poolOwner] = await ethers.getSigners();

    // Deploy HumaConfig
    const HumaConfig = await ethers.getContractFactory("HumaConfig");
    humaConfigContract = await HumaConfig.deploy(treasury.address);
    humaConfigContract.setHumaTreasury(treasury.address);

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

  describe("Base Fee Manager", function() {
    // todo Verify only pool admins can deployNewPool
    describe("setFees()", function() {
      it("Should set the fees correctly", async function() {
        var [f1, f2, f3, f4] = await feeManager.getFees();
        expect(f1).to.equal(10);
        expect(f2).to.equal(100);
        expect(f3).to.equal(20);
        expect(f4).to.equal(10000);
      });

      it("Should disallow non-owner to set the fees", async function() {
        await expect(feeManager.connect(treasury).setFees(10, 100, 20, 10000)).to.be.revertedWith(
          "caller is not the owner"
        ); // open zeppelin default error message
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

    describe("setMinPrincipalRateInBps()", async function() {
      it("Should disallow non-poolOwner to set min principal rate", async function() {
        await expect(
          feeManager.connect(treasury).setMinPrincipalRateInBps(6000)
        ).to.be.revertedWith("caller is not the owner");
      });

      it("Should reject if the rate is too high", async function() {
        await expect(
          feeManager.connect(poolOwner).setMinPrincipalRateInBps(6000)
        ).to.be.revertedWith("RATE_TOO_HIGH");
      });

      it("Should be able to set min principal payment rate", async function() {
        await feeManager.connect(poolOwner).setMinPrincipalRateInBps(500);
        expect(await feeManager.connect(poolOwner).minPrincipalRateInBps()).to.equal(500);
      });
    });
  });

  describe("getDueInfo()", async function() {
    before(async function() {
      const BaseCreditPool = await ethers.getContractFactory("BaseCreditPool");
      poolContract = await BaseCreditPool.deploy(
        testToken.address,
        humaConfigContract.address,
        feeManager.address,
        "Base Credit Pool",
        "Base HDT",
        "BHDT"
      );
      await poolContract.deployed();
      poolContract.addEvaluationAgent(evaluationAgent.address);
      // Setup the pool
      await testToken.approve(poolContract.address, 100);
      await poolContract.makeInitialDeposit(100);
      await poolContract.enablePool();
      await poolContract.setMinMaxBorrowAmount(10, 1000);
      await poolContract.transferOwnership(poolOwner.address);
      await poolContract.connect(poolOwner).setAPR(1200);
      await testToken.connect(lender).approve(poolContract.address, 300);
      await poolContract.connect(lender).deposit(300);
      await feeManager.connect(poolOwner).setFees(10, 100, 20, 500);

      // Create a borrowing record
      await poolContract.connect(borrower).requestCredit(400, 30, 12);
      await poolContract.connect(evaluationAgent).approveCredit(borrower.address);
      await testToken.connect(lender).approve(poolContract.address, 300);
      await poolContract.connect(borrower).drawdown(400);
      record = await poolContract.creditRecordMapping(borrower.address);
      lastLateDate = 0;
      await feeManager.connect(poolOwner).setMinPrincipalRateInBps(0);
      let r = await feeManager.getDueInfo(record);
      console.log("r=", r);
      checkResult(r, 0, 0, 0, 404);
      let blockNumBefore = await ethers.provider.getBlockNumber();
      let blockBefore = await ethers.provider.getBlock(blockNumBefore);
      initialTimestamp = blockBefore.timestamp;
      console.log("initialTimestamp=", initialTimestamp);
      await ethers.provider.send("evm_increaseTime", [3600 * 24 * 30]);
      await ethers.provider.send("evm_mine", []);
      blockNumBefore = await ethers.provider.getBlockNumber();
      blockBefore = await ethers.provider.getBlock(blockNumBefore);
      initialTimestamp = blockBefore.timestamp;
      console.log("After evm_increaseTime, initialTimestamp=", initialTimestamp);
    });
    describe("1st statement", async function() {
      describe("No late fee", async function() {
        it("IntOnly", async function() {
          await feeManager.connect(poolOwner).setMinPrincipalRateInBps(0);
          let r = await feeManager.getDueInfo(record);
          console.log("r=", r);
          checkResult(r, 1, 4, 4, 408);
        });
        it("WithMinPrincipal", async function() {
          await feeManager.connect(poolOwner).setMinPrincipalRateInBps(500);
          let r = await feeManager.getDueInfo(record);
          checkResult(r, 1, 4, 24, 408);
        });
      });
      describe("Late fee scenarios", async function() {
        describe("Late for 1 period", async function() {
          before(async function() {
            await ethers.provider.send("evm_increaseTime", [3600 * 24 * 30]);
            await ethers.provider.send("evm_mine", []);
          });
          it("IntOnly", async function() {
            await feeManager.connect(poolOwner).setMinPrincipalRateInBps(0);
            let r = await feeManager.getDueInfo(record);
            checkResult(r, 2, 44, 44, 452); // late fee = 20 flat + 20 bps
          });
          it("WithMinPrincipal", async function() {
            await feeManager.connect(poolOwner).setMinPrincipalRateInBps(500);
            let r = await feeManager.getDueInfo(record);
            checkResult(r, 2, 44, 64, 452); // principal =
          });
        });
        describe("Late for 2 periods", async function() {
          before(async function() {
            await ethers.provider.send("evm_increaseTime", [3600 * 24 * 30]);
            await ethers.provider.send("evm_mine", []);
          });
          it("IntOnly", async function() {
            await feeManager.connect(poolOwner).setMinPrincipalRateInBps(0);
            let r = await feeManager.getDueInfo(record);
            checkResult(r, 3, 46, 46, 498);
          });
          it("WithMinPrincipal", async function() {
            await feeManager.connect(poolOwner).setMinPrincipalRateInBps(500);
            let r = await feeManager.getDueInfo(record);
            checkResult(r, 3, 46, 68, 498);
          });
        });
        describe("Late for 3 periods", async function() {
          before(async function() {
            await ethers.provider.send("evm_increaseTime", [3600 * 24 * 30]);
            await ethers.provider.send("evm_mine", []);
          });
          it("IntOnly", async function() {
            await feeManager.connect(poolOwner).setMinPrincipalRateInBps(0);
            let r = await feeManager.getDueInfo(record);
            checkResult(r, 4, 48, 48, 546);
          });
          it("WithMinPrincipal", async function() {
            await feeManager.connect(poolOwner).setMinPrincipalRateInBps(500);
            let r = await feeManager.getDueInfo(record);
            checkResult(r, 4, 48, 72, 546);
          });
        });
      });
    });
  });

  describe.skip("applyPayment()", function() {
    before(async function() {
      const BaseCreditPool = await ethers.getContractFactory("BaseCreditPool");
      poolContract = await BaseCreditPool.deploy(
        testToken.address,
        humaConfigContract.address,
        feeManager.address,
        "Base Credit Pool",
        "Base HDT",
        "BHDT"
      );
      await poolContract.deployed();
      poolContract.addEvaluationAgent(evaluationAgent.address);
      // Setup the pool
      await testToken.approve(poolContract.address, 100);
      await poolContract.makeInitialDeposit(100);
      await poolContract.enablePool();
      await poolContract.setMinMaxBorrowAmount(10, 1000);
      await poolContract.transferOwnership(poolOwner.address);
      await poolContract.connect(poolOwner).setAPR(1200);
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
        await feeManager.connect(poolOwner).setMinPrincipalRateInBps(0);
        // Create a borrowing record
        await poolContract.connect(borrower).requestCredit(400, 30, 12);
        await poolContract.connect(evaluationAgent).approveCredit(borrower.address);
        await testToken.connect(lender).approve(poolContract.address, 300);
        await poolContract.connect(borrower).drawdown(400);
        record = await poolContract.creditRecordMapping(borrower.address);
        lastLateDate = 0;
      });
      describe("1st Payment", async function() {
        // After testing 1st payment, advance the payment schedule by making one payment
        after(async function() {
          let creditInfo = await poolContract.getCreditInformation(borrower.address);
          let oldDueDate = creditInfo.dueDate;
          await testToken.connect(borrower).approve(poolContract.address, 28);
          await poolContract.connect(borrower).makePayment(testToken.address, 28);
          creditInfo = await poolContract.getCreditInformation(borrower.address);
          let newDueDate = Number(oldDueDate) + Number(creditInfo.intervalInDays * 3600 * 24);
          expect(creditInfo.creditLimit).to.equal(400);
          expect(creditInfo.totalDue).to.equal(4);
          expect(creditInfo.intervalInDays).to.equal(30);
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
          await poolContract.connect(borrower).makePayment(testToken.address, 28);
          await ethers.provider.send("evm_increaseTime", [3600 * 24 * 27]);
          await ethers.provider.send("evm_mine", []);
          // Make the 3rd to 11th payments, no late fee
          for (let i = 0; i < 9; i++) {
            await poolContract.connect(borrower).makePayment(testToken.address, 4);
            await ethers.provider.send("evm_increaseTime", [3600 * 24 * 30]);
            await ethers.provider.send("evm_mine", []);
          }
          // Make sure the credit record is correct.
          creditInfo = await poolContract.getCreditInformation(borrower.address);
          expect(creditInfo.balance).to.equal(400);
          expect(creditInfo.totalDue).to.equal(404);
          expect(creditInfo.remainingPeriods).to.equal(1);
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
          await poolContract.connect(borrower).makePayment(testToken.address, 828);
          creditInfo = await poolContract.getCreditInformation(borrower.address);
          expect(creditInfo.balance).to.equal(0);
          expect(creditInfo.totalDue).to.equal(0);
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
  });
});
