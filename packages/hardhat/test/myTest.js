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
  let humaPoolLockerFactoryContract;
  let testTokenContract;
  let humaPoolContract;
  let owner;
  let lender;
  let borrower;

  before(async function () {
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

  describe("HumaPool", function () {
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

      await humaPoolContract.setInterestRateBasis(10);
      await humaPoolContract.setMaxLoanAmount(100);
      await humaPoolContract.enablePool();

      await testTokenContract.give1000To(lender.address);
      await testTokenContract
        .connect(lender)
        .approve(humaPoolContract.address, 99999);
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

    describe("Depositing and withdrawal", function () {
      it("Cannot deposit while pool is off", async function () {
        await humaPoolContract.disablePool();
        await expect(
          humaPoolContract.connect(lender).deposit(100)
        ).to.be.revertedWith("HumaPool:POOL_NOT_ON");
      });

      it("Pool deposit works correctly", async function () {
        await humaPoolContract.connect(lender).deposit(100);
        const lenderInfo = await humaPoolContract
          .connect(lender)
          .getLenderInfo(lender.address);
        expect(lenderInfo.amount).to.equal(100);
        expect(lenderInfo.mostRecentLoanTimestamp).to.not.equal(0);
        expect(await humaPoolContract.getPoolLiquidity()).to.equal(100);
      });

      it("Pool withdrawal works correctly", async function () {
        await humaPoolContract.connect(lender).deposit(100);

        // Test withdrawing before the lockout passes
        await expect(
          humaPoolContract.connect(lender).withdraw(100)
        ).to.be.revertedWith("HumaPool:WITHDRAW_TOO_SOON");

        // Increment block by lockout period
        const loanWithdrawalLockout =
          await humaPoolContract.getLoanWithdrawalLockoutPeriod();
        await ethers.provider.send("evm_increaseTime", [
          loanWithdrawalLockout.toNumber(),
        ]);

        // Test withdrawing more than deposited fails
        await expect(
          humaPoolContract.connect(lender).withdraw(9999)
        ).to.be.revertedWith("HumaPool:WITHDRAW_AMT_TOO_GREAT");

        // Test success case
        await humaPoolContract.connect(lender).withdraw(100);

        const lenderInfo = await humaPoolContract
          .connect(lender)
          .getLenderInfo(lender.address);
        expect(lenderInfo.amount).to.equal(0);
      });
    });

    describe("Borrowing and payback", function () {
      beforeEach(async function () {
        await humaPoolContract.connect(lender).deposit(100);
        await testTokenContract
          .connect(borrower)
          .approve(humaPoolContract.address, 99999);
      });

      it("Cannot borrow while pool is off", async function () {
        await humaPoolContract.disablePool();
        await expect(
          humaPoolContract.connect(borrower).borrow(99, 1000, 10)
        ).to.be.revertedWith("HumaPool:POOL_NOT_ON");
      });

      it("Cannot borrow greater than limit", async function () {
        await expect(
          humaPoolContract.connect(borrower).borrow(9999, 1000, 10)
        ).to.be.revertedWith("HumaPool:DENY_BORROW_GREATER_THAN_LIMIT");
      });

      it("Borrowing works correctly", async function () {
        expect(await testTokenContract.balanceOf(borrower.address)).to.equal(0);

        await humaPoolContract.connect(borrower).borrow(99, 1000, 10);

        const loanAddress = await humaPoolContract.creditMapping(
          borrower.address
        );
        const loanContract = await getLoanContractFromAddress(
          loanAddress,
          borrower
        );
        const loanInformation = await loanContract.getLoanInformation();
        expect(loanInformation._amount).to.equal(99);
        expect(loanInformation._amountPaidBack).to.equal(0);
        expect(loanInformation._issuedTimestamp).to.not.equal(0);
        expect(loanInformation._lastPaymentTimestamp).to.equal(0);
        expect(loanInformation._paybackPerInterval).to.equal(10);
        expect(loanInformation._paybackInterval).to.equal(1000);
        expect(loanInformation._interestRateBasis).to.equal(10);

        expect(await testTokenContract.balanceOf(borrower.address)).to.equal(
          99
        );

        expect(await humaPoolContract.getPoolLiquidity()).to.equal(1);

        // Borrowing with existing loans should fail
        await expect(
          humaPoolContract.connect(borrower).borrow(99, 1000, 10)
        ).to.be.revertedWith("HumaPool:DENY_BORROW_EXISTING_LOAN");
      });

      it("Payback works correctly", async function () {
        // Borrow with a single payback
        await humaPoolContract.connect(borrower).borrow(99, 1000, 99);
        await expect(
          humaPoolContract
            .connect(borrower)
            .makeIntervalPayback(borrower.address)
        ).to.be.revertedWith("HumaPool:MAKE_INTERVAL_PAYBACK_TOO_EARLY");

        await ethers.provider.send("evm_increaseTime", [1000]);

        await humaPoolContract
          .connect(borrower)
          .makeIntervalPayback(borrower.address);

        const loanAddress = await humaPoolContract.creditMapping(
          borrower.address
        );
        const loanContract = await getLoanContractFromAddress(
          loanAddress,
          borrower
        );
        const loanInformation = await loanContract.getLoanInformation();
        expect(loanInformation._amountPaidBack).to.equal(99);
        expect(loanInformation._lastPaymentTimestamp).to.not.equal(0);
        expect(await humaPoolContract.getPoolLiquidity()).to.equal(100);
      });
    });
  });
});
