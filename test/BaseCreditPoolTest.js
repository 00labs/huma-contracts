/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {use, expect} = require("chai");
const {solidity} = require("ethereum-waffle");
const {deployContracts, deployAndSetupPool, advanceClock} = require("./BaseTest");

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
//
// The full testing scenario is designed as:
// m0-1: Owner contributes 100 initial liquidity
// m0-2: Set up fees=(10, 100, 20, 100), APR=1217, protocol fee=50.
// m0-3: Lender contributes 300, together with owner's 100, the pool size is 400. PPS=1
// m0-4. Borrower borrows 400 with interest-only. 14 fee charged (12 pool fee, 2 protocol fee). Borrower get 386
//       PPS=1.03, withdrawable(owner, lender)=(103,309)
// m1.   Borrower makes a regular payment of 4 interest fee
//       PPS=1.04, withdrawable(owner, lender)=(104,312)
// m2.   Borrower was late to make the payment, gets charged 24 late fee, plus 4 interest, total fee 28
//       PPS=1.11, withdrawable(owner, lender)=(111,333)
// m3-1. Borrower pays makes a regular payment of 4 interest fee
//       PPS=1.12, withdrawable(owner, lender)=(112,336)
// m3-2. Owner deposits another 200
//       FDT(owner, lender)=(300, 300)
//       PPS=1.12, correction(owner, lender)=(-24,0), withdrawable(owner, lender)=(312,336)
// m3-2. Lender withdraws 224, which is 200 * PPS
//       FDT(owner, lender)=(300, 100), pool liquidity is 24
//       PPS=1.12, correction(owner, lender)=(-24,0, 224), withdrawable(owner, lender)=(312,112)
// m3-3. Borrower pays makes a regular payment of 4 interest fee
//       PPS=1.12, withdrawable(owner, lender)=(312,112)
// m4.   Borrower pays off with a fee of 38 (early payoff penalty 34, interest 4), total 438 incl. principal
//       PPS=1.215, correction(owner, lender)=(-24,0, 224),withdrawable(owner, lender)=(340.5,121.5)
// m5.   Lender withdraw 121.5, pool liquidity is now 340.5
//       PPS=1.215, correction(owner, lender)=(-24,0, 345.5),withdrawable(owner, lender)=(340.5,0)
//
// Numbers in Google Sheet: more detail: (shorturl.at/dfqrT)
//
describe("Base Credit Pool", function () {
    let poolContract;
    let hdtContract;
    let humaConfigContract;
    let feeManagerContract;
    let testTokenContract;
    let proxyOwner;
    let lender;
    let borrower;
    let treasury;
    let evaluationAgent;
    let protocolOwner;
    let eaNFTContract;
    let eaServiceAccount;
    let pdsServiceAccount;

    before(async function () {
        [
            defaultDeployer,
            proxyOwner,
            lender,
            borrower,
            treasury,
            evaluationAgent,
            poolOwner,
            protocolOwner,
            eaServiceAccount,
            pdsServiceAccount,
        ] = await ethers.getSigners();

        [humaConfigContract, feeManagerContract, testTokenContract, eaNFTContract] =
            await deployContracts(
                poolOwner,
                treasury,
                lender,
                protocolOwner,
                eaServiceAccount,
                pdsServiceAccount
            );
    });

    beforeEach(async function () {
        [hdtContract, poolContract] = await deployAndSetupPool(
            poolOwner,
            proxyOwner,
            evaluationAgent,
            lender,
            humaConfigContract,
            feeManagerContract,
            testTokenContract,
            0,
            eaNFTContract
        );

        await poolContract.connect(poolOwner).setWithdrawalLockoutPeriod(90);
        await poolContract.connect(poolOwner).setPoolDefaultGracePeriod(60);
    });

    afterEach(async function () {});

    describe("BaseCreditPool settings", function () {
        it("Should not allow credit line to be changed when protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pauseProtocol();
            await expect(
                poolContract.connect(eaServiceAccount).changeCreditLine(borrower.address, 1000000)
            ).to.be.revertedWith("PROTOCOL_PAUSED");
            await humaConfigContract.connect(protocolOwner).unpauseProtocol();
        });
        it("Should not allow non-EA to change credit line", async function () {
            await expect(
                poolContract.connect(borrower).changeCreditLine(borrower.address, 1000000)
            ).to.be.revertedWith("evaluationAgentServiceAccountRequired()");
        });
        it("Should not allow credit line to be changed to above maximal credit line", async function () {
            await expect(
                poolContract.connect(eaServiceAccount).changeCreditLine(borrower.address, 50000000)
            ).to.be.revertedWith("greaterThanMaxCreditLine()");
        });
        it("Should allow credit limit to be changed", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .changeCreditLine(borrower.address, 1000000);
            let result = await poolContract.creditRecordStaticMapping(borrower.address);
            expect(result.creditLimit).to.equal(1000000);
        });
        it("Should not allow non-pool-owner-or-huma-admin to change credit expiration before first drawdown", async function () {
            await expect(
                poolContract.connect(lender).setCreditApprovalExpiration(5)
            ).to.be.revertedWith("PERMISSION_DENIED_NOT_ADMIN");
        });
        it("Should allow pool owner to change credit expiration before first drawdown", async function () {
            await expect(poolContract.connect(poolOwner).setCreditApprovalExpiration(5))
                .to.emit(poolContract, "CreditApprovalExpirationChanged")
                .withArgs(432000, poolOwner.address);
        });
    });

    // Borrowing tests are grouped into two suites: Borrowing Request and Funding.
    // In beforeEach() of "Borrowing request", we make sure there is 100 liquidity.
    describe("Borrowing request", function () {
        afterEach(async function () {
            await humaConfigContract.connect(protocolOwner).unpauseProtocol();
        });

        it("Should reject loan requests while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pauseProtocol();
            await expect(
                poolContract.connect(borrower).requestCredit(1_000_000, 30, 12)
            ).to.be.revertedWith("PROTOCOL_PAUSED");
        });

        it("Shall reject request loan while pool is off", async function () {
            await poolContract.connect(poolOwner).disablePool();
            await expect(
                poolContract.connect(borrower).requestCredit(1_000_000, 30, 12)
            ).to.be.revertedWith("POOL_NOT_ON");
        });

        it("Shall reject request loan greater than limit", async function () {
            await expect(
                poolContract.connect(borrower).requestCredit(10_000_001, 30, 12)
            ).to.be.revertedWith("greaterThanMaxCreditLine()");
        });

        it("Shall allow loan request", async function () {
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(0);

            await poolContract.connect(poolOwner).setAPR(1217);

            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);

            const loanInformation = await poolContract.getCreditInformation(borrower.address);
            expect(loanInformation.creditLimit).to.equal(1_000_000);
            expect(loanInformation.intervalInDays).to.equal(30);
            expect(loanInformation.aprInBps).to.equal(1217);
            expect(loanInformation.state).to.equal(1);
        });

        it("Shall reject loan requests if there is an outstanding laon", async function () {
            await poolContract.connect(borrower).requestCredit(1_000, 30, 12);

            await expect(
                poolContract.connect(borrower).requestCredit(1_000, 30, 12)
            ).to.be.revertedWith("creditLineAlreadyExists()");
        });
    });

    describe("Drawdown", function () {
        beforeEach(async function () {
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
        });

        afterEach(async function () {
            await humaConfigContract.connect(protocolOwner).unpauseProtocol();
        });

        it("Should not allow loan funding while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pauseProtocol();
            await expect(poolContract.connect(borrower).drawdown(400)).to.be.revertedWith(
                "PROTOCOL_PAUSED"
            );
        });

        it("Should reject drawdown before approval", async function () {
            await expect(poolContract.connect(borrower).drawdown(1_000_000)).to.be.revertedWith(
                "creditLineNotInApprovedOrGoodStandingState()"
            );
        });

        it("Should reject drawdown when account is deleted", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .invalidateApprovedCredit(borrower.address);
            await expect(poolContract.connect(borrower).drawdown(400)).to.be.revertedWith(
                "creditLineNotInApprovedOrGoodStandingState()"
            );
        });

        it("Should reject drawdown if the combined balance is higher than the credit limit", async function () {
            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);
            await poolContract.connect(borrower).drawdown(1_000_000);

            await expect(poolContract.connect(borrower).drawdown(4000)).to.be.revertedWith(
                "creditLineExceeded()"
            );
            await testTokenContract.mint(borrower.address, 11000);
            await testTokenContract.connect(borrower).approve(poolContract.address, 1_000_000);
            await poolContract
                .connect(borrower)
                .makePayment(borrower.address, testTokenContract.address, 1_000_000);
        });

        it("Should reject if the borrowing amount is less than platform fees", async function () {
            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);
            await expect(poolContract.connect(borrower).drawdown(100)).to.be.revertedWith(
                "borrowingAmountLessThanPlatformFees()"
            );
        });

        it("Borrow less than approved amount", async function () {
            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);
            expect(await poolContract.isApproved(borrower.address)).to.equal(true);

            // Should return false when no loan exists
            expect(await poolContract.isApproved(evaluationAgent.address)).to.equal(false);

            await poolContract.connect(borrower).drawdown(100_000);

            // Two streams of income
            // fees: 2000. {protocol, poolOwner, EA, Pool}: {400, 100, 300, 1200}
            // interest income: 1000 {protocol, poolOwner, EA, Pool}: {200, 50, 150, 600}
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(98_000);

            let accruedIncome = await poolContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(600);
            expect(accruedIncome.poolOwnerIncome).to.equal(150);
            expect(accruedIncome.eaIncome).to.equal(450);
            expect(await poolContract.totalPoolValue()).to.equal(5_001_800);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(4_902_000);

            await testTokenContract.mint(borrower.address, 2000);

            // Please note since the credit is paid back instantly, no interest is actually charged.
            await testTokenContract.connect(borrower).approve(poolContract.address, 100000);
            await poolContract
                .connect(borrower)
                .makePayment(borrower.address, testTokenContract.address, 100000);
        });

        it("Borrow full amount that has been approved", async function () {
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(0);
            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);
            expect(await poolContract.isApproved(borrower.address)).to.equal(true);

            expect(await poolContract.isApproved(borrower.address)).to.equal(true);

            await poolContract.connect(borrower).drawdown(1_000_000);

            // fees: 11_000. protocol: 2200, pool owner: 550, EA: 1650, pool: 6600
            // borrower balance: 98000 + 989000 = 1_087_000
            // interest income: 10,002. {proto, poolowner, ea, pool} = {2000, 500, 1500, 6002}
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(989_000);

            let accruedIncome = await poolContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(4200);
            expect(accruedIncome.poolOwnerIncome).to.equal(1050);
            expect(accruedIncome.eaIncome).to.equal(3150);
            expect(await poolContract.totalPoolValue()).to.equal(5_012_602);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(4_011_000);

            await testTokenContract.mint(borrower.address, 11000);
            await testTokenContract.connect(borrower).approve(poolContract.address, 1_000_000);
            await poolContract
                .connect(borrower)
                .makePayment(borrower.address, testTokenContract.address, 1_000_000);
        });

        it("Should reject drawdown in the final pay period of the credit line", async function () {
            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);
            await poolContract.connect(borrower).drawdown(1_000_000);
            await testTokenContract.mint(borrower.address, 21002);
            await testTokenContract.connect(borrower).approve(poolContract.address, 1_010_002);
            await poolContract
                .connect(borrower)
                .makePayment(borrower.address, testTokenContract.address, 1_010_002);

            let creditInfo = await poolContract.getCreditInformation(borrower.address);
            expect(creditInfo.unbilledPrincipal).to.equal(0);
            expect(creditInfo.totalDue).to.equal(0);

            advanceClock(330);
            await expect(poolContract.connect(borrower).drawdown(4000)).to.be.revertedWith(
                "creditExpiredDueToMaturity()"
            );
        });

        it("Should reject drawdown when account is late in payments", async function () {
            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);
            await poolContract.connect(borrower).drawdown(100_000);
            advanceClock(90);
            await expect(poolContract.connect(borrower).drawdown(4000)).to.be.revertedWith(
                "creditLineNotInApprovedOrGoodStandingState()"
            );
        });
    });

    describe("Credit expiration without a timely first drawdown", function () {
        it("Cannot borrow after credit expiration window", async function () {
            await poolContract.connect(poolOwner).setCreditApprovalExpiration(5);
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);

            advanceClock(6);

            await expect(poolContract.connect(borrower).drawdown(1_000_000)).to.revertedWith(
                "creditExpiredDueToFirstDrawdownTooLate()"
            );
        });

        it("Can borrow if no credit expiration has been setup for the pool", async function () {
            await poolContract.connect(poolOwner).setCreditApprovalExpiration(0);
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);

            advanceClock(6);

            await expect(poolContract.connect(borrower).drawdown(1_000_000));
            let creditInfo = await poolContract.getCreditInformation(borrower.address);
            expect(creditInfo.remainingPeriods).to.equal(11);
        });

        it("Expiration window does not apply after initial drawdown", async function () {
            await poolContract.connect(poolOwner).setCreditApprovalExpiration(5);
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);
            await expect(poolContract.connect(borrower).drawdown(500_000));
            let creditInfo = await poolContract.getCreditInformation(borrower.address);
            expect(creditInfo.unbilledPrincipal).to.equal(500_000);

            advanceClock(6);

            await poolContract.connect(borrower).drawdown(500_000);
            creditInfo = await poolContract.getCreditInformation(borrower.address);
            expect(creditInfo.unbilledPrincipal).to.equal(1_000_000);
        });
    });

    describe("Account update by service account", function () {
        it("Shall not emit BillRefreshedByServiceAccount event when the bill should not be refreshed", async function () {
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);
            await poolContract.connect(borrower).drawdown(1_000_000);
            await expect(
                poolContract.connect(pdsServiceAccount).updateDueInfo(borrower.address, true)
            ).to.not.emit(poolContract, "BillRefreshedByServiceAccount");
        });
        it("Shall not emit BillRefreshedByServiceAccount event when bill refresh is triggered by the borrower", async function () {
            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);

            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);
            await poolContract.connect(borrower).drawdown(1_000_000);

            let record = await poolContract.getCreditInformation(borrower.address);
            let previousDueDate = record.dueDate;

            advanceClock(40);

            let expectedDueDate = +previousDueDate + 2592000;

            await expect(
                poolContract.connect(borrower).updateDueInfo(borrower.address, true)
            ).to.not.emit(poolContract, "BillRefreshedByServiceAccount");
        });

        it("Shall emit BillRefreshedByServiceAccount event when the bill is refreshed", async function () {
            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);

            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);
            await poolContract.connect(borrower).drawdown(1_000_000);

            let record = await poolContract.getCreditInformation(borrower.address);
            let previousDueDate = record.dueDate;

            advanceClock(40);

            let expectedDueDate = +previousDueDate + 2592000;

            await expect(
                poolContract.connect(pdsServiceAccount).updateDueInfo(borrower.address, true)
            )
                .to.emit(poolContract, "BillRefreshedByServiceAccount")
                .withArgs(borrower.address, expectedDueDate, pdsServiceAccount.address);
        });
    });

    // In "Payback".beforeEach(), make sure there is a loan funded.
    describe("Payback", function () {
        beforeEach(async function () {
            let lenderBalance = await testTokenContract.balanceOf(lender.address);

            await poolContract.connect(poolOwner).setAPR(1217);
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);

            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);
            await poolContract.connect(borrower).drawdown(1_000_000);
        });

        afterEach(async function () {
            await humaConfigContract.connect(protocolOwner).unpauseProtocol();
        });

        it("Should not allow payback while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pauseProtocol();
            await expect(
                poolContract
                    .connect(borrower)
                    .makePayment(borrower.address, testTokenContract.address, 5)
            ).to.be.revertedWith("PROTOCOL_PAUSED");
        });

        it("Process payback", async function () {
            advanceClock(29);

            // AmountDue (10002) + 1000 extra principal payment
            await testTokenContract.connect(borrower).approve(poolContract.address, 11002);

            await poolContract
                .connect(borrower)
                .makePayment(borrower.address, testTokenContract.address, 11002);

            let creditInfo = await poolContract.getCreditInformation(borrower.address);

            expect(creditInfo.unbilledPrincipal).to.equal(999_000);
            expect(creditInfo.remainingPeriods).to.equal(11);

            // Interest income 10_002. Protocol: 2000, PoolOwner: 1500, EA: 500, pool: 6002
            let accruedIncome = await poolContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(4200);
            expect(accruedIncome.poolOwnerIncome).to.equal(1050);
            expect(accruedIncome.eaIncome).to.equal(3150);
            expect(await poolContract.totalPoolValue()).to.equal(5_012_602);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(4_022_002);

            expect(await hdtContract.withdrawableFundsOf(poolOwner.address)).to.equal(1_002_520);
            expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                2_005_040
            );
            expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(2_005_040);
        });
    });

    // Default flow. After each pay period, simulates to LatePayMonitorService to call updateDueInfo().
    // In "Payback".beforeEach(), make sure there is a loan funded.
    describe("Default", function () {
        beforeEach(async function () {
            let lenderBalance = await testTokenContract.balanceOf(lender.address);

            await poolContract.connect(poolOwner).setAPR(1217);
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);

            await poolContract.connect(eaServiceAccount).approveCredit(borrower.address);
            await poolContract.connect(borrower).drawdown(1_000_000);
        });

        it("Default flow", async function () {
            await poolContract.connect(poolOwner).setPoolDefaultGracePeriod(60);

            // Period 1: Late for payment
            advanceClock(30);

            await poolContract.updateDueInfo(borrower.address, true);
            let creditInfo = await poolContract.getCreditInformation(borrower.address);
            await expect(poolContract.triggerDefault(borrower.address)).to.be.revertedWith(
                "defaultTriggeredTooEarly()"
            );

            expect(creditInfo.unbilledPrincipal).to.equal(1_010_002);
            expect(creditInfo.feesAndInterestDue).to.equal(22202);
            expect(creditInfo.totalDue).to.equal(22202);
            expect(creditInfo.remainingPeriods).to.equal(10);
            expect(creditInfo.missedPeriods).to.equal(1);
            expect(await poolContract.totalPoolValue()).to.equal(5_025_924);

            //Period 2: Two periods lates
            advanceClock(30);

            await poolContract.updateDueInfo(borrower.address, true);
            creditInfo = await poolContract.getCreditInformation(borrower.address);
            await expect(poolContract.triggerDefault(borrower.address)).to.be.revertedWith(
                "defaultTriggeredTooEarly()"
            );

            expect(creditInfo.unbilledPrincipal).to.equal(1_032_204);
            expect(creditInfo.feesAndInterestDue).to.equal(22646);
            expect(creditInfo.totalDue).to.equal(22646);
            expect(creditInfo.remainingPeriods).to.equal(9);
            expect(creditInfo.missedPeriods).to.equal(2);
            expect(await poolContract.totalPoolValue()).to.equal(5_039_513);

            // Period 3: 3 periods late. ready for default.
            advanceClock(30);

            // Intertionally bypass calling updateDueInfo(), and expects triggerDefault() to call it
            // await poolContract.updateDueInfo(borrower.address);
            // creditInfo = await poolContract.getCreditInformation(borrower.address);

            // Triggers default and makes sure the event is emitted
            await expect(poolContract.connect(eaServiceAccount).triggerDefault(borrower.address))
                .to.emit(poolContract, "DefaultTriggered")
                .withArgs(borrower.address, 1_054_850, eaServiceAccount.address);

            creditInfo = await poolContract.getCreditInformation(borrower.address);
            expect(creditInfo.unbilledPrincipal).to.equal(1_054_850);
            expect(creditInfo.feesAndInterestDue).to.equal(23099);
            expect(creditInfo.totalDue).to.equal(23099);
            expect(creditInfo.remainingPeriods).to.equal(8);
            expect(creditInfo.missedPeriods).to.equal(3);

            // Checks pool value and all LP's withdrawable funds
            expect(await hdtContract.totalSupply()).to.equal(5_000_000);
            expect(await poolContract.totalPoolValue()).to.equal(3_984_663);
            expect(await hdtContract.withdrawableFundsOf(poolOwner.address)).to.equal(796_932);
            expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                1_593_865
            );
            expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(1_593_865);

            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(4_011_000);

            // Checks all the accrued income of protocol, poolOwner, and EA.
            let accruedIncome = await poolContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(13169);
            expect(accruedIncome.poolOwnerIncome).to.equal(3292);
            expect(accruedIncome.eaIncome).to.equal(9876);
        });
    });
});
