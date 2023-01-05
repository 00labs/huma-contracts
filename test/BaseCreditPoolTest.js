/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {use, expect} = require("chai");
const {solidity} = require("ethereum-waffle");
const {
    deployContracts,
    deployAndSetupPool,
    advanceClock,
    checkRecord,
    checkResult,
    getCreditInfo,
} = require("./BaseTest");

use(solidity);

const getLoanContractFromAddress = async function (address, signer) {
    return ethers.getContractAt("HumaLoan", address, signer);
};

// Let us limit the depth of describe to be 2.
//
//
// Numbers in Google Sheet: more detail: (shorturl.at/dfqrT)
describe("Base Credit Pool", function () {
    let poolContract;
    let poolConfigContract;
    let hdtContract;
    let humaConfigContract;
    let feeManagerContract;
    let testTokenContract;
    let proxyOwner;
    let poolOwner;
    let lender;
    let borrower;
    let treasury;
    let evaluationAgent;
    let protocolOwner;
    let eaNFTContract;
    let eaServiceAccount;
    let pdsServiceAccount;
    let record;
    let recordStatic;
    let poolOperator;
    let poolOwnerTreasury;

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
            poolOperator,
            poolOwnerTreasury,
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
        [hdtContract, poolConfigContract, poolContract] = await deployAndSetupPool(
            poolOwner,
            proxyOwner,
            evaluationAgent,
            lender,
            humaConfigContract,
            feeManagerContract,
            testTokenContract,
            0,
            eaNFTContract,
            false, // BaseCreditPool
            poolOperator,
            poolOwnerTreasury
        );

        await poolConfigContract.connect(poolOwner).setWithdrawalLockoutPeriod(90);
        await poolConfigContract.connect(poolOwner).setPoolDefaultGracePeriod(60);
    });

    afterEach(async function () {});

    describe("BaseCreditPool settings", function () {
        it("Should not allow credit line to be changed when protocol is paused", async function () {
            if ((await humaConfigContract.connect(protocolOwner).paused()) == false)
                await humaConfigContract.connect(protocolOwner).pause();
            await expect(
                poolContract.connect(eaServiceAccount).changeCreditLine(borrower.address, 1000000)
            ).to.be.revertedWith("protocolIsPaused()");
            await humaConfigContract.connect(protocolOwner).unpause();
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

        it("Should mark a credit line without balance deleted when credit limit is set to allow credit limit to be changed", async function () {
            let record = await poolContract.creditRecordMapping(borrower.address);
            expect(record.totalDue).to.equal(0);
            expect(record.unbilledPrincipal).to.equal(0);

            await poolContract.connect(eaServiceAccount).changeCreditLine(borrower.address, 0);

            let result = await poolContract.creditRecordStaticMapping(borrower.address);
            expect(result.creditLimit).to.equal(0);
            record = await poolContract.creditRecordMapping(borrower.address);
            expect(record.state).to.equal(0);
        });

        it("Should not delete a credit line when there is balance due when set credit limit to 0", async function () {
            let record = await poolContract.creditRecordMapping(borrower.address);
            expect(record.totalDue).to.equal(0);
            expect(record.unbilledPrincipal).to.equal(0);

            await poolContract.connect(borrower).requestCredit(4000, 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 4000, 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(4000);

            await poolContract.connect(eaServiceAccount).changeCreditLine(borrower.address, 0);

            let result = await poolContract.creditRecordStaticMapping(borrower.address);
            expect(result.creditLimit).to.equal(0);
            record = await poolContract.creditRecordMapping(borrower.address);
            expect(record.state).to.equal(3);

            await testTokenContract.mint(borrower.address, 1080);
            await testTokenContract.connect(borrower).approve(poolContract.address, 4040);
            await poolContract.connect(borrower).makePayment(borrower.address, 4040);
            // Note since there is no time passed, the interest charged will be offset at the payoff
            record = await poolContract.creditRecordMapping(borrower.address);
            expect(record.totalDue).to.equal(0);
            expect(record.unbilledPrincipal).to.equal(0);

            await poolContract.connect(eaServiceAccount).changeCreditLine(borrower.address, 0);
            result = await poolContract.creditRecordStaticMapping(borrower.address);
            expect(result.creditLimit).to.equal(0);
            record = await poolContract.creditRecordMapping(borrower.address);
            expect(record.state).to.equal(0);

            // remove the extra tokens in the borrower's account to return to clean account status
            await testTokenContract.burn(
                borrower.address,
                await testTokenContract.balanceOf(borrower.address)
            );
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(0);
        });
    });

    describe("HDT", async function () {
        it("HDT's decimals shall match with the underlyingtoken's decimals", async function () {
            expect(await hdtContract.decimals()).to.equal(6);
        });
        it("Should disallow initialize to be called again", async function () {
            await expect(
                hdtContract.initialize("TestHDT", "THDT", testTokenContract.address)
            ).to.be.revertedWith("Initializable: contract is already initialized");
        });
        it("Should reject non-owner to setPool", async function () {
            await expect(
                hdtContract.connect(lender).setPool(poolContract.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
        it("Should reject non-owner to call mintAmount()", async function () {
            await expect(
                hdtContract.connect(lender).mintAmount(lender.address, 1_000_000)
            ).to.be.revertedWith("notPool");
        });
        it("Should reject non-owner to call burnAmount()", async function () {
            await expect(
                hdtContract.connect(lender).burnAmount(lender.address, 1_000_000)
            ).to.be.revertedWith("notPool");
        });
    });

    // Borrowing tests are grouped into two suites: Borrowing Request and Funding.
    // In beforeEach() of "Borrowing request", we make sure there is 100 liquidity.
    describe("Borrowing request", function () {
        afterEach(async function () {
            if (await humaConfigContract.connect(protocolOwner).paused())
                await humaConfigContract.connect(protocolOwner).unpause();
        });

        it("Should reject loan requests while zero period", async function () {
            await humaConfigContract.connect(poolOwner).pause();
            await expect(
                poolContract.connect(borrower).requestCredit(1_000_000, 30, 0)
            ).to.be.revertedWith("requestedCreditWithZeroDuration()");
        });
        it("Should reject loan requests while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pause();
            await expect(
                poolContract.connect(borrower).requestCredit(1_000_000, 30, 12)
            ).to.be.revertedWith("protocolIsPaused()");
        });

        it("Shall reject request loan while pool is off", async function () {
            await poolContract.connect(poolOwner).disablePool();
            await expect(
                poolContract.connect(borrower).requestCredit(1_000_000, 30, 12)
            ).to.be.revertedWith("poolIsNotOn()");
        });

        it("Shall reject request loan greater than limit", async function () {
            await expect(
                poolContract.connect(borrower).requestCredit(10_000_001, 30, 12)
            ).to.be.revertedWith("greaterThanMaxCreditLine()");
        });

        it("Shall allow loan request", async function () {
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(0);

            await poolConfigContract.connect(poolOwner).setAPR(1217);

            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);

            const loanInformation = await getCreditInfo(poolContract, borrower.address);
            expect(loanInformation.creditLimit).to.equal(1_000_000);
            expect(loanInformation.intervalInDays).to.equal(30);
            expect(loanInformation.aprInBps).to.equal(1217);
            expect(loanInformation.state).to.equal(1);
        });

        it("Shall allow new request if there is existing loan in Requested state", async function () {
            await poolContract.connect(borrower).requestCredit(1_000, 30, 12);
            await poolContract.connect(borrower).requestCredit(2_000, 60, 24);
            const loanInformation = await getCreditInfo(poolContract, borrower.address);
            expect(loanInformation.creditLimit).to.equal(2_000);
            expect(loanInformation.intervalInDays).to.equal(60);
            expect(loanInformation.aprInBps).to.equal(1217);
            expect(loanInformation.remainingPeriods).to.equal(24);
            expect(loanInformation.state).to.equal(1);
        });

        it("Shall reject loan requests if there is an outstanding loan with outstanding balance", async function () {
            await poolContract.connect(borrower).requestCredit(3_000, 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 3000, 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(2_000);

            await expect(
                poolContract.connect(borrower).requestCredit(1_000, 30, 12)
            ).to.be.revertedWith("creditLineAlreadyExists()");
        });

        it("Shall allow new request if existing loan has been paid off", async function () {
            await poolContract.connect(borrower).requestCredit(3_000, 30, 12);
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, 3_000)
            ).to.be.revertedWith("creditLineNotInStateForMakingPayment()");

            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 3000, 30, 12, 1217);
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, 3_000)
            ).to.be.revertedWith("creditLineNotInStateForMakingPayment()");

            await poolContract.connect(borrower).drawdown(3_000);
            await testTokenContract.connect(borrower).mint(borrower.address, 2_000);
            await testTokenContract.connect(borrower).approve(poolContract.address, 3_100);
            await poolContract.connect(borrower).makePayment(borrower.address, 3_100);
            await poolContract.connect(borrower).requestCredit(4_000, 90, 36);
            const loanInformation = await getCreditInfo(poolContract, borrower.address);
            expect(loanInformation.creditLimit).to.equal(4_000);
            expect(loanInformation.intervalInDays).to.equal(90);
            expect(loanInformation.aprInBps).to.equal(1217);
            expect(loanInformation.remainingPeriods).to.equal(36);
            expect(loanInformation.state).to.equal(1);
            expect(loanInformation.totalDue).to.equal(0);
            expect(loanInformation.feesAndInterestDue).to.equal(0);
            expect(loanInformation.correction).to.equal(0);
        });
    });

    describe("Drawdown", function () {
        beforeEach(async function () {
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
        });

        afterEach(async function () {
            if (await humaConfigContract.connect(protocolOwner).paused())
                await humaConfigContract.connect(protocolOwner).unpause();
        });

        it("Should not allow loan funding while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pause();
            await expect(poolContract.connect(borrower).drawdown(400)).to.be.revertedWith(
                "protocolIsPaused()"
            );
        });

        it("Should reject drawdown before approval", async function () {
            await expect(poolContract.connect(borrower).drawdown(1_000_000)).to.be.revertedWith(
                "creditLineNotInStateForDrawdown()"
            );
        });

        it("Should reject drawdown when account is deleted", async function () {
            await poolContract.connect(eaServiceAccount).changeCreditLine(borrower.address, 0);
            await expect(poolContract.connect(borrower).drawdown(400)).to.be.revertedWith(
                "creditLineNotInStateForDrawdown()"
            );
        });

        it("Should reject drawdown if the combined balance is higher than the credit limit", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(1_000_000);

            await expect(poolContract.connect(borrower).drawdown(4000)).to.be.revertedWith(
                "creditLineExceeded()"
            );
            await testTokenContract.mint(borrower.address, 11000);
            await testTokenContract.connect(borrower).approve(poolContract.address, 1_000_000);
            await poolContract.connect(borrower).makePayment(borrower.address, 1_000_000);
        });

        it("Should reject if the borrowing amount is zero", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            await expect(poolContract.connect(borrower).drawdown(0)).to.be.revertedWith(
                "zeroAmountProvided()"
            );
        });

        it("Should reject if the borrowing amount is less than platform fees", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 3_000, 30, 12, 1217);
            await expect(poolContract.connect(borrower).drawdown(100)).to.be.revertedWith(
                "borrowingAmountLessThanPlatformFees()"
            );
        });

        it("Should reject if the borrowing amount is more than approved", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            await expect(poolContract.connect(borrower).drawdown(1_100_000)).to.be.revertedWith(
                "creditLineExceeded()"
            );
        });

        it("Borrow less than approved amount", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            expect(await poolContract.isApproved(borrower.address)).to.equal(true);

            // Should return false when no loan exists
            expect(await poolContract.isApproved(evaluationAgent.address)).to.equal(false);

            let oldBalance = await testTokenContract.balanceOf(borrower.address);
            await expect(poolContract.connect(borrower).drawdown(100_000))
                .to.emit(poolContract, "DrawdownMade")
                .withArgs(borrower.address, 100_000, 98_000);

            // Two streams of income
            // fees: 2000. {protocol, poolOwner, EA, Pool}: {400, 100, 300, 1200}
            // interest income: 1000 {protocol, poolOwner, EA, Pool}: {200, 50, 150, 600}
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(
                98_000 + Number(oldBalance)
            );

            let accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(600);
            expect(accruedIncome.poolOwnerIncome).to.equal(150);
            expect(accruedIncome.eaIncome).to.equal(450);
            expect(await poolContract.totalPoolValue()).to.equal(5_001_800);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(4_902_000);

            await testTokenContract.mint(borrower.address, 2000);

            // Please note since the credit is paid back instantly, no interest is actually charged.
            await testTokenContract.connect(borrower).approve(poolContract.address, 100000);
            await poolContract.connect(borrower).makePayment(borrower.address, 100000);
        });

        it("Borrow full amount that has been approved", async function () {
            let oldBalance = await testTokenContract.balanceOf(borrower.address);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            expect(await poolContract.isApproved(borrower.address)).to.equal(true);

            await poolContract.connect(borrower).drawdown(1_000_000);

            // fees: 11_000. protocol: 2200, pool owner: 550, EA: 1650, pool: 6600
            // borrower balance: 98000 + 989000 = 1_087_000
            // interest income: 10,002. {proto, poolowner, ea, pool} = {2000, 500, 1500, 6002}
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(
                Number(oldBalance) + 989_000
            );

            let accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(4200);
            expect(accruedIncome.poolOwnerIncome).to.equal(1050);
            expect(accruedIncome.eaIncome).to.equal(3150);
            expect(await poolContract.totalPoolValue()).to.equal(5_012_602);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(4_011_000);

            await testTokenContract.mint(borrower.address, 11000);
            await testTokenContract.connect(borrower).approve(poolContract.address, 1_000_000);
            await poolContract.connect(borrower).makePayment(borrower.address, 1_000_000);
        });

        it("Should reject drawdown in the final pay period of the credit line", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(1_000_000);
            await testTokenContract.mint(borrower.address, 21002);
            await testTokenContract.connect(borrower).approve(poolContract.address, 1_010_002);
            await poolContract.connect(borrower).makePayment(borrower.address, 1_010_002);

            let creditInfo = await poolContract.creditRecordMapping(borrower.address);
            expect(creditInfo.unbilledPrincipal).to.equal(0);
            expect(creditInfo.totalDue).to.equal(0);

            advanceClock(330);
            await expect(poolContract.connect(borrower).drawdown(4000)).to.be.revertedWith(
                "creditExpiredDueToMaturity()"
            );
        });

        it("Should reject drawdown when account is late in payments", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_00_000, 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(100_000);
            advanceClock(90);
            await expect(poolContract.connect(borrower).drawdown(4000)).to.be.revertedWith(
                "creditLineNotInGoodStandingState()"
            );
        });
    });

    describe("IsLate()", function () {
        it("Shall not mark the account as late if there is no drawdown", async function () {
            await poolConfigContract.connect(poolOwner).setCreditApprovalExpiration(5);
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);

            expect(await poolContract.isLate(borrower.address)).to.equal(false);

            advanceClock(31);
            expect(await poolContract.isLate(borrower.address)).to.equal(false);
        });
        it("Shall mark the account as late if no payment is received by the dueDate", async function () {
            await poolConfigContract.connect(poolOwner).setCreditApprovalExpiration(5);
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            expect(await poolContract.isLate(borrower.address)).to.equal(false);
            advanceClock(2);
            await poolContract.connect(borrower).drawdown(1_000_000);
            expect(await poolContract.isLate(borrower.address)).to.equal(false);
            await advanceClock(31);
            expect(await poolContract.isLate(borrower.address)).to.equal(true);
        });
    });

    describe("Credit expiration without a timely first drawdown", function () {
        it("Cannot borrow after credit expiration window", async function () {
            await poolConfigContract.connect(poolOwner).setCreditApprovalExpiration(5);
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);

            advanceClock(6);

            await expect(poolContract.connect(borrower).drawdown(1_000_000)).to.revertedWith(
                "creditExpiredDueToFirstDrawdownTooLate()"
            );
        });

        it("Can borrow if no credit expiration has been setup for the pool", async function () {
            await poolConfigContract.connect(poolOwner).setCreditApprovalExpiration(0);
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);

            advanceClock(6);

            await expect(poolContract.connect(borrower).drawdown(1_000_000));
            let creditInfo = await poolContract.creditRecordMapping(borrower.address);
            expect(creditInfo.remainingPeriods).to.equal(11);
        });

        it("Expiration window does not apply after initial drawdown", async function () {
            await poolConfigContract.connect(poolOwner).setCreditApprovalExpiration(5);
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            await expect(poolContract.connect(borrower).drawdown(500_000));
            let creditInfo = await poolContract.creditRecordMapping(borrower.address);
            expect(creditInfo.unbilledPrincipal).to.equal(500_000);

            advanceClock(6);

            await poolContract.connect(borrower).drawdown(500_000);
            creditInfo = await poolContract.creditRecordMapping(borrower.address);
            expect(creditInfo.unbilledPrincipal).to.equal(1_000_000);
        });
    });

    describe("Account update by service account", function () {
        it("Shall not emit BillRefreshed event when the bill should not be refreshed", async function () {
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(1_000_000);
            await expect(
                poolContract.connect(pdsServiceAccount).refreshAccount(borrower.address)
            ).to.not.emit(poolContract, "BillRefreshed");
        });

        it("Shall emit BillRefreshed event when the bill is refreshed", async function () {
            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);

            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(1_000_000);

            let record = await poolContract.creditRecordMapping(borrower.address);
            let previousDueDate = record.dueDate;

            advanceClock(40);

            let expectedDueDate = +previousDueDate + 2592000;

            await expect(poolContract.connect(pdsServiceAccount).refreshAccount(borrower.address))
                .to.emit(poolContract, "BillRefreshed")
                .withArgs(borrower.address, expectedDueDate, pdsServiceAccount.address);
            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                record,
                recordStatic,
                1_000_000,
                1_010_002,
                expectedDueDate,
                0,
                22_202,
                22_202,
                1,
                10,
                1217,
                30,
                4,
                0
            );
            expect(await poolContract.totalPoolValue()).to.equal(5_025_924);
            expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                1_005_184
            );
            expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                2_010_369
            );
            expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(2_010_369);

            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(8640);
            expect(accruedIncome.poolOwnerIncome).to.equal(2160);
            expect(accruedIncome.eaIncome).to.equal(6480);
        });
        it("BillRefresh when it is default ready should not distribute income", async function () {
            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);

            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(1_000_000);

            let record = await poolContract.creditRecordMapping(borrower.address);
            let previousDueDate = record.dueDate;

            // Default-ready - should not distribute the income
            advanceClock(100);
            let expectedDueDate = +previousDueDate + 3 * 2592000;
            await expect(poolContract.connect(pdsServiceAccount).refreshAccount(borrower.address))
                .to.emit(poolContract, "BillRefreshed")
                .withArgs(borrower.address, expectedDueDate, pdsServiceAccount.address);
            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                record,
                recordStatic,
                1_000_000,
                1_054_850,
                expectedDueDate,
                0,
                23099,
                23099,
                3,
                8,
                1217,
                30,
                4,
                0
            );

            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(17789);
            expect(accruedIncome.poolOwnerIncome).to.equal(4447);
            expect(accruedIncome.eaIncome).to.equal(13342);

            // default-ready
            advanceClock(30);
            expectedDueDate += 2592000;
            await expect(poolContract.connect(pdsServiceAccount).refreshAccount(borrower.address))
                .to.emit(poolContract, "BillRefreshed")
                .withArgs(borrower.address, expectedDueDate, pdsServiceAccount.address);
            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(17789);
            expect(accruedIncome.poolOwnerIncome).to.equal(4447);
            expect(accruedIncome.eaIncome).to.equal(13342);

            // trigger default
            await expect(poolContract.connect(pdsServiceAccount).triggerDefault(borrower.address))
                .to.emit(poolContract, "DefaultTriggered")
                .withArgs(borrower.address, 1_077_949, pdsServiceAccount.address);

            // post-default refreshAccount should do nothing
            advanceClock(30);
            await expect(
                poolContract.connect(pdsServiceAccount).refreshAccount(borrower.address)
            ).to.not.emit(poolContract, "BillRefreshed");
            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(17789);
            expect(accruedIncome.poolOwnerIncome).to.equal(4447);
            expect(accruedIncome.eaIncome).to.equal(13342);
        });
    });

    // In "Payback".beforeEach(), make sure there is a loan funded.
    describe("Payback", function () {
        beforeEach(async function () {
            let lenderBalance = await testTokenContract.balanceOf(lender.address);

            await poolConfigContract.connect(poolOwner).setAPR(1217);
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);

            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(1_000_000);
        });

        afterEach(async function () {
            if (await humaConfigContract.connect(protocolOwner).paused())
                await humaConfigContract.connect(protocolOwner).unpause();
        });

        it("Should not allow payback while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pause();
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, 5)
            ).to.be.revertedWith("protocolIsPaused()");
        });

        it("Should reject if payback amount is zero", async function () {
            await testTokenContract.connect(borrower).approve(poolContract.address, 1000);
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, 0)
            ).to.be.revertedWith("zeroAmountProvided()");
        });

        it("Process payback", async function () {
            advanceClock(29);

            // AmountDue (10002) + 1000 extra principal payment
            await testTokenContract.connect(borrower).approve(poolContract.address, 11002);

            await poolContract.connect(borrower).makePayment(borrower.address, 11002);

            let creditInfo = await poolContract.creditRecordMapping(borrower.address);

            expect(creditInfo.unbilledPrincipal).to.equal(999_000);
            expect(creditInfo.remainingPeriods).to.equal(11);

            // Interest income 10_002. Protocol: 2000, PoolOwner: 1500, EA: 500, pool: 6002
            let accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(4200);
            expect(accruedIncome.poolOwnerIncome).to.equal(1050);
            expect(accruedIncome.eaIncome).to.equal(3150);
            expect(await poolContract.totalPoolValue()).to.equal(5_012_602);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(4_022_002);

            expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                1_002_520
            );
            expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                2_005_040
            );
            expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(2_005_040);
        });

        it("Automatic payback", async function () {
            advanceClock(29);

            // AmountDue (10002) + 1000 extra principal payment
            await testTokenContract.connect(borrower).approve(poolContract.address, 11002);

            await poolContract.connect(pdsServiceAccount).makePayment(borrower.address, 11002);

            let creditInfo = await poolContract.creditRecordMapping(borrower.address);

            expect(creditInfo.unbilledPrincipal).to.equal(999_000);
            expect(creditInfo.remainingPeriods).to.equal(11);

            // Interest income 10_002. Protocol: 2000, PoolOwner: 1500, EA: 500, pool: 6002
            let accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(4200);
            expect(accruedIncome.poolOwnerIncome).to.equal(1050);
            expect(accruedIncome.eaIncome).to.equal(3150);
            expect(await poolContract.totalPoolValue()).to.equal(5_012_602);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(4_022_002);

            expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                2_005_040
            );
            expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                1_002_520
            );
            expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(2_005_040);
        });
    });

    // In "Payback".beforeEach(), make sure there is a loan funded.
    describe("Quick payback", function () {
        it("Process payback", async function () {
            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);

            let dueDate = blockBefore.timestamp + 2592000;

            let lenderBalance = await testTokenContract.balanceOf(lender.address);

            await poolConfigContract.connect(poolOwner).setAPR(1217);
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);

            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(1_000_000);

            await testTokenContract.mint(borrower.address, 1_000_100);

            let oldBalance = await testTokenContract.balanceOf(borrower.address);
            await testTokenContract.connect(borrower).approve(poolContract.address, 1_000_500);

            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, 1_000_500)
            ).to.emit(poolContract, "PaymentMade");
            let newBalance = await testTokenContract.balanceOf(borrower.address);
            expect(oldBalance - newBalance).to.be.within(1_000_000, 1_000_500);

            let r = await poolContract.creditRecordMapping(borrower.address);
            let rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, 1_000_000, 0, dueDate, 0, 0, 0, 0, 11, 1217, 30, 3, 0);
        });
    });

    describe("Multiple immediate payback towards payoff", function () {
        it("Multiple immediate payback", async function () {
            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);

            let dueDate = blockBefore.timestamp + 2592000;

            let lenderBalance = await testTokenContract.balanceOf(lender.address);

            await poolConfigContract.connect(poolOwner).setAPR(1217);
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);

            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(1_000_000);

            await testTokenContract.mint(borrower.address, 1_000_100);

            let oldBalance = await testTokenContract.balanceOf(borrower.address);
            await testTokenContract.connect(borrower).approve(poolContract.address, 900_000);

            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, 900_000)
            ).to.emit(poolContract, "PaymentMade");
            let newBalance = await testTokenContract.balanceOf(borrower.address);

            let r = await poolContract.creditRecordMapping(borrower.address);
            let rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, 1_000_000, 110_002, dueDate, -8902, 0, 0, 0, 11, 1217, 30, 3, 0);

            advanceClock(30);
            dueDate += 2592000;

            await testTokenContract.connect(borrower).approve(poolContract.address, 120_000);

            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, 120_000)
            ).to.emit(poolContract, "PaymentMade");
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, 1_000_000, 0, dueDate, 0, 0, 0, 0, 10, 1217, 30, 3, 0);
        });
    });

    describe("Multiple borrowing to form positive correction in payoff", function () {
        it("Multiple consecutive borrowing", async function () {
            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);

            let dueDate = blockBefore.timestamp + 2592000;

            let lenderBalance = await testTokenContract.balanceOf(lender.address);

            await poolConfigContract.connect(poolOwner).setAPR(1217);
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);

            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);

            await poolContract.connect(borrower).drawdown(500_000);
            await poolContract.connect(borrower).drawdown(500_000);

            await testTokenContract.mint(borrower.address, 1_000_100);

            advanceClock(25);
            await testTokenContract.connect(borrower).approve(poolContract.address, 1_100_000);
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, 1_100_000)
            ).to.emit(poolContract, "PaymentMade");
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, 1_000_000, 0, dueDate, 0, 0, 0, 0, 11, 1217, 30, 3, 0);
        });
    });

    describe("makePayment after account deleted", function () {
        it("Shall revert makePayment() if the account has been deleted", async function () {
            await poolConfigContract.connect(poolOwner).setAPR(1217);
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 2);

            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 2, 1217);

            await poolContract.connect(borrower).drawdown(500_000);

            await testTokenContract.mint(borrower.address, 1_000_000);
            await testTokenContract.connect(borrower).approve(poolContract.address, 1_000_000);
            await poolContract.connect(borrower).makePayment(borrower.address, 100_000);

            advanceClock(30);
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, 500_000)
            ).to.emit(poolContract, "PaymentMade");
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, 1_000_000, 0, "SKIP", 0, 0, 0, 0, 0, 1217, 30, 0, 0);

            // Additional payment after payoff
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, 1000)
            ).to.be.revertedWith("creditLineNotInStateForMakingPayment");
        });
    });

    describe("Quick large amount payback (for getDueInfo overflow)", function () {
        it("Quick follow-up borrowing", async function () {
            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);

            let dueDate = blockBefore.timestamp + 2592000;

            let lenderBalance = await testTokenContract.balanceOf(lender.address);

            await poolConfigContract.connect(poolOwner).setAPR(1217);
            await poolContract.connect(borrower).requestCredit(1_500_000, 30, 12);

            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_500_000, 30, 12, 1217);

            await poolContract.connect(borrower).drawdown(1_000_000);

            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                1_500_000,
                1_000_000,
                dueDate,
                0,
                10002,
                10002,
                0,
                11,
                1217,
                30,
                3,
                0
            );

            // Generates negative correction
            await await testTokenContract.connect(borrower).approve(poolContract.address, 900_000);
            await expect(poolContract.connect(borrower).makePayment(borrower.address, 900_000))
                .to.emit(poolContract, "PaymentMade")
                .withArgs(borrower.address, 900_000, 0, 110_002, borrower.address);

            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            await checkRecord(
                r,
                rs,
                1_500_000,
                110_002,
                dueDate,
                -8902,
                0,
                0,
                0,
                11,
                1217,
                30,
                3,
                0
            );

            // Consumes negative correction.
            await advanceClock(90);
            dueDate += 3 * 2592000;
            await testTokenContract.connect(borrower).mint(borrower.address, 50_000);
            await testTokenContract.connect(borrower).approve(poolContract.address, 50_000);
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, 50_000)
            ).to.emit(poolContract, "PaymentMade");
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            await checkRecord(r, rs, 1_500_000, 60_275, dueDate, -458, 0, 0, 0, 8, 1217, 30, 3, 0);

            await testTokenContract.connect(borrower).mint(borrower.address, 60_000);
            await testTokenContract.connect(borrower).approve(poolContract.address, 60_000);
            await expect(poolContract.connect(borrower).makePayment(borrower.address, 60_000))
                .to.emit(poolContract, "PaymentMade")
                .withArgs(borrower.address, 59215, 0, 0, borrower.address);
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, 1_500_000, 0, dueDate, 0, 0, 0, 0, 8, 1217, 30, 3, 0);
        });
    });

    // Default flow. After each pay period, simulates to LatePayMonitorService to call updateDueInfo().
    // Test scenario available at https://tinyurl.com/yc5fks9x
    describe("Default", function () {
        beforeEach(async function () {
            let lenderBalance = await testTokenContract.balanceOf(lender.address);

            await poolConfigContract.connect(poolOwner).setAPR(1217);
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);

            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(1_000_000);
        });

        it("Default flow", async function () {
            await poolConfigContract.connect(poolOwner).setPoolDefaultGracePeriod(60);

            // Period 1: Late for payment
            advanceClock(30);

            await poolContract.refreshAccount(borrower.address);
            let creditInfo = await poolContract.creditRecordMapping(borrower.address);
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

            await poolContract.refreshAccount(borrower.address);
            creditInfo = await poolContract.creditRecordMapping(borrower.address);
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
            expect(await poolContract.isLate(borrower.address)).to.equal(true);

            // Intertionally bypass calling updateDueInfo(), and expects triggerDefault() to call it
            // await poolContract.updateDueInfo(borrower.address);
            // creditInfo = await poolContract.creditRecordMapping(borrower.address);

            // Triggers default and makes sure the event is emitted
            await expect(poolContract.connect(eaServiceAccount).triggerDefault(borrower.address))
                .to.emit(poolContract, "DefaultTriggered")
                .withArgs(borrower.address, 1_054_850, eaServiceAccount.address);

            creditInfo = await poolContract.creditRecordMapping(borrower.address);
            expect(creditInfo.unbilledPrincipal).to.equal(1_054_850);
            expect(creditInfo.feesAndInterestDue).to.equal(23099);
            expect(creditInfo.totalDue).to.equal(23099);
            expect(creditInfo.remainingPeriods).to.equal(8);
            expect(creditInfo.missedPeriods).to.equal(3);

            // Checks pool value and all LP's withdrawable funds
            expect(await hdtContract.totalSupply()).to.equal(5_000_000);
            expect(await poolContract.totalPoolValue()).to.equal(3_984_663);
            expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                796_932
            );
            expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                1_593_865
            );
            expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(1_593_865);

            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(4_011_000);

            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(13169);
            expect(accruedIncome.poolOwnerIncome).to.equal(3292);
            expect(accruedIncome.eaIncome).to.equal(9876);

            // Should not call triggerDefault() again after an account is defaulted
            await expect(
                poolContract.connect(eaServiceAccount).triggerDefault(borrower.address)
            ).to.be.revertedWith("defaultHasAlreadyBeenTriggered()");
        });

        it("Post-default payment", async function () {
            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);
            let dueDate = blockBefore.timestamp + 2592000;

            await testTokenContract.connect(borrower).mint(borrower.address, 200_000);
            await poolConfigContract.connect(poolOwner).setPoolDefaultGracePeriod(60);

            // Period 1: Late for payment, trigger default. The same setup as the "default flow" test.
            advanceClock(30);
            await poolContract.refreshAccount(borrower.address);
            advanceClock(30);
            await poolContract.refreshAccount(borrower.address);
            advanceClock(30);

            dueDate += 2592000 * 3;

            // Triggers default and makes sure the event is emitted
            await expect(poolContract.connect(eaServiceAccount).triggerDefault(borrower.address))
                .to.emit(poolContract, "DefaultTriggered")
                .withArgs(borrower.address, 1_054_850, eaServiceAccount.address);

            creditInfo = await poolContract.creditRecordMapping(borrower.address);
            expect(creditInfo.unbilledPrincipal).to.equal(1_054_850);
            expect(creditInfo.feesAndInterestDue).to.equal(23099);
            expect(creditInfo.totalDue).to.equal(23099);
            expect(creditInfo.remainingPeriods).to.equal(8);
            expect(creditInfo.missedPeriods).to.equal(3);

            // Checks pool value and all LP's withdrawable funds
            expect(await hdtContract.totalSupply()).to.equal(5_000_000);
            expect(await poolContract.totalPoolValue()).to.equal(3_984_663);
            expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                796_932
            );
            expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                1_593_865
            );
            expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(1_593_865);

            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(4_011_000);

            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(13169);
            expect(accruedIncome.poolOwnerIncome).to.equal(3292);
            expect(accruedIncome.eaIncome).to.equal(9876);

            // Stage 2: borrower pays back after default is triggered.
            // the amount is unable to cover all the outstanding fees and principals.
            // the fees will be charged first, then the principal. The account is in default
            // state until everything is paid off.
            advanceClock(40);
            dueDate += 2592000;

            await testTokenContract.connect(borrower).approve(poolContract.address, 25_000);

            await poolContract.connect(borrower).makePayment(borrower.address, 25_000);

            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                record,
                recordStatic,
                1_000_000,
                1_076_510,
                dueDate,
                -9,
                0,
                0,
                0,
                7,
                1217,
                30,
                5,
                1_029_850
            );
            expect(await poolContract.totalPoolValue()).to.equal(4_009_663);
            expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                801_932
            );
            expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                1_603_865
            );
            expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(1_603_865);

            // Checks all the accrued income of protocol, poolOwner, and EA.
            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(13169);
            expect(accruedIncome.poolOwnerIncome).to.equal(3292);
            expect(accruedIncome.eaIncome).to.equal(9876);

            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(4_036_000);

            // // Stage 3: pay enough to cover all principal losses
            advanceClock(10);
            await testTokenContract.connect(borrower).approve(poolContract.address, 1_050_000);

            await expect(poolContract.connect(borrower).makePayment(borrower.address, 1_050_000))
                .to.emit(poolContract, "PaymentMade")
                .withArgs(borrower.address, 1_050_000, 0, 26_510, borrower.address);

            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                record,
                recordStatic,
                1_000_000,
                26_510,
                dueDate,
                -3509,
                0,
                0,
                0,
                7,
                1217,
                30,
                5,
                0
            );
            expect(await poolContract.totalPoolValue()).to.equal(5_051_604);
            expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                1_010_320
            );
            expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                2_020_641
            );
            expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(2_020_641);

            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(17199);
            expect(accruedIncome.poolOwnerIncome).to.equal(4299);
            expect(accruedIncome.eaIncome).to.equal(12898);

            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(5_086_000);

            // // Stage 4: pay off the remaining fees
            await testTokenContract.connect(borrower).approve(poolContract.address, 27_000);

            await expect(poolContract.connect(borrower).makePayment(borrower.address, 27_000))
                .to.emit(poolContract, "PaymentMade")
                .withArgs(borrower.address, 22_913, 0, 0, borrower.address);

            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                record,
                recordStatic,
                1_000_000,
                0,
                dueDate,
                0,
                0,
                0,
                0,
                7,
                1217,
                30,
                3,
                0
            );
            expect(await poolContract.totalPoolValue()).to.equal(5_065_353);
            expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                1_013_070
            );
            expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                2_026_141
            );
            expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(2_026_141);

            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(21781);
            expect(accruedIncome.poolOwnerIncome).to.equal(5444);
            expect(accruedIncome.eaIncome).to.equal(16335);

            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(5_108_913);
        });
    });

    describe("Protocol/Pool Owner/EA fee", function () {
        it("Should not allow non-protocol-owner to withdraw protocol", async function () {
            await expect(poolConfigContract.withdrawProtocolFee(1)).to.be.revertedWith(
                "notProtocolOwner"
            );
        });

        it("Should not allow non-pool-owner to withdraw pool owner fee", async function () {
            await expect(poolConfigContract.withdrawPoolOwnerFee(1)).to.be.revertedWith(
                "notPoolOwnerTreasury"
            );
        });

        it("Should not allow non-poolOwner or EA withdraw EA fee", async function () {
            await expect(poolConfigContract.withdrawEAFee(1)).to.be.revertedWith(
                "notPoolOwnerOrEA"
            );
        });

        it("Should not withdraw protocol fee while amount > withdrawable", async function () {
            const poolConfigFromProtocolOwner = await poolConfigContract.connect(protocolOwner);
            await expect(poolConfigFromProtocolOwner.withdrawProtocolFee(1)).to.be.revertedWith(
                "withdrawnAmountHigherThanBalance"
            );
        });

        it("Should not withdraw pool owner fee if amount > withdrawable", async function () {
            const poolConfigFromPoolOwner = await poolConfigContract.connect(poolOwnerTreasury);
            await expect(poolConfigFromPoolOwner.withdrawPoolOwnerFee(1)).to.be.revertedWith(
                "withdrawnAmountHigherThanBalance"
            );
        });

        it("Should not withdraw ea fee while amount > withdrawable", async function () {
            const poolConfigFromPoolOwner = await poolConfigContract.connect(evaluationAgent);
            await expect(poolConfigFromPoolOwner.withdrawEAFee(1)).to.be.revertedWith(
                "withdrawnAmountHigherThanBalance"
            );
        });

        it("Should withdraw protocol fee", async function () {
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(100_000);

            let accruedIncome = await poolConfigContract.accruedIncome();
            const amount = accruedIncome.protocolIncome;
            const poolConfigFromProtocolOwner = await poolConfigContract.connect(protocolOwner);
            const beforeBalance = await testTokenContract.balanceOf(treasury.address);

            await poolConfigFromProtocolOwner.withdrawProtocolFee(amount);
            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncomeWithdrawn).equals(amount);
            const afterBalance = await testTokenContract.balanceOf(treasury.address);
            expect(amount).equals(afterBalance.sub(beforeBalance));

            await expect(poolConfigFromProtocolOwner.withdrawProtocolFee(1)).to.be.revertedWith(
                "withdrawnAmountHigherThanBalance"
            );
        });

        it("Should withdraw pool owner fee", async function () {
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(100_000);

            let accruedIncome = await poolConfigContract.accruedIncome();
            const amount = accruedIncome.poolOwnerIncome;
            const poolConfigFromPoolOwner = await poolConfigContract.connect(poolOwnerTreasury);
            const beforeBalance = await testTokenContract.balanceOf(poolOwnerTreasury.address);

            await poolConfigFromPoolOwner.withdrawPoolOwnerFee(amount);
            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.poolOwnerIncomeWithdrawn).equals(amount);
            const afterBalance = await testTokenContract.balanceOf(poolOwnerTreasury.address);
            expect(amount).equals(afterBalance.sub(beforeBalance));

            await expect(poolConfigFromPoolOwner.withdrawPoolOwnerFee(1)).to.be.revertedWith(
                "withdrawnAmountHigherThanBalance"
            );
        });

        it("Should withdraw ea fee", async function () {
            await poolContract.connect(borrower).requestCredit(1_000_000, 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, 1_000_000, 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(100_000);

            let accruedIncome = await poolConfigContract.accruedIncome();
            const amount = accruedIncome.eaIncome;
            const poolConfigFromEA = await poolConfigContract.connect(evaluationAgent);
            const beforeBalance = await testTokenContract.balanceOf(evaluationAgent.address);

            await poolConfigFromEA.withdrawEAFee(amount);
            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.eaIncomeWithdrawn).equals(amount);
            const afterBalance = await testTokenContract.balanceOf(evaluationAgent.address);
            expect(amount).equals(afterBalance.sub(beforeBalance));

            await expect(poolConfigFromEA.withdrawEAFee(1)).to.be.revertedWith(
                "withdrawnAmountHigherThanBalance"
            );
        });
    });
});
