/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {expect} = require("chai");
const {
    deployContracts,
    deployAndSetupPool,
    advanceClock,
    checkRecord,
    checkResult,
    getCreditInfo,
    toToken,
    setNextBlockTimestamp,
    mineNextBlockWithTimestamp,
    evmSnapshot,
    evmRevert,
} = require("./BaseTest");

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
    let sId;

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

    beforeEach(async function () {
        sId = await evmSnapshot();
    });

    afterEach(async function () {
        if (sId) {
            const res = await evmRevert(sId);
        }
    });

    describe("BaseCreditPool settings", function () {
        it("Should not allow credit line to be changed when protocol is paused", async function () {
            if ((await humaConfigContract.connect(protocolOwner).paused()) == false)
                await humaConfigContract.connect(protocolOwner).pause();
            await expect(
                poolContract
                    .connect(eaServiceAccount)
                    .changeCreditLine(borrower.address, toToken(1000000))
            ).to.be.revertedWithCustomError(poolContract, "protocolIsPaused");
            await humaConfigContract.connect(protocolOwner).unpause();
        });

        it("Should not allow non-EA to change credit line", async function () {
            await expect(
                poolContract.connect(borrower).changeCreditLine(borrower.address, toToken(1000000))
            ).to.be.revertedWithCustomError(poolContract, "evaluationAgentServiceAccountRequired");
        });

        it("Should not allow credit line to be changed to above maximal credit line", async function () {
            await expect(
                poolContract
                    .connect(eaServiceAccount)
                    .changeCreditLine(borrower.address, toToken(50000000))
            ).to.be.revertedWithCustomError(poolContract, "greaterThanMaxCreditLine");
        });

        it("Should allow credit limit to be changed", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .changeCreditLine(borrower.address, toToken(1000000));
            let result = await poolContract.creditRecordStaticMapping(borrower.address);
            expect(result.creditLimit).to.equal(toToken(1000000));
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

            await poolContract.connect(borrower).requestCredit(toToken(4000), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(4000), 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(toToken(4000));

            await poolContract.connect(eaServiceAccount).changeCreditLine(borrower.address, 0);

            let result = await poolContract.creditRecordStaticMapping(borrower.address);
            expect(result.creditLimit).to.equal(0);
            record = await poolContract.creditRecordMapping(borrower.address);
            expect(record.state).to.equal(3);

            await testTokenContract.mint(borrower.address, toToken(1080));
            await testTokenContract.connect(borrower).approve(poolContract.address, toToken(4040));
            await poolContract.connect(borrower).makePayment(borrower.address, toToken(4040));
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
                hdtContract.connect(lender).mintAmount(lender.address, toToken(1_000_000))
            ).to.be.revertedWithCustomError(hdtContract, "notPool");
        });
        it("Should reject non-owner to call burnAmount()", async function () {
            await expect(
                hdtContract.connect(lender).burnAmount(lender.address, toToken(1_000_000))
            ).to.be.revertedWithCustomError(hdtContract, "notPool");
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
                poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 0)
            ).to.be.revertedWithCustomError(poolContract, "requestedCreditWithZeroDuration");
        });
        it("Should reject loan requests while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pause();
            await expect(
                poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12)
            ).to.be.revertedWithCustomError(poolContract, "protocolIsPaused");
        });

        it("Shall reject request loan while pool is off", async function () {
            await poolContract.connect(poolOwner).disablePool();
            await expect(
                poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12)
            ).to.be.revertedWithCustomError(poolContract, "poolIsNotOn");
        });

        it("Shall reject request loan greater than limit", async function () {
            await expect(
                poolContract.connect(borrower).requestCredit(toToken(10_000_001), 30, 12)
            ).to.be.revertedWithCustomError(poolContract, "greaterThanMaxCreditLine");
        });

        it("Shall allow loan request", async function () {
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(0);

            await poolConfigContract.connect(poolOwner).setAPR(1217);

            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);

            const loanInformation = await getCreditInfo(poolContract, borrower.address);
            expect(loanInformation.creditLimit).to.equal(toToken(1_000_000));
            expect(loanInformation.intervalInDays).to.equal(30);
            expect(loanInformation.aprInBps).to.equal(1217);
            expect(loanInformation.state).to.equal(1);
        });

        it("Shall allow new request if there is existing loan in Requested state", async function () {
            await poolContract.connect(borrower).requestCredit(toToken(1_000), 30, 12);
            await poolContract.connect(borrower).requestCredit(toToken(2_000), 60, 24);
            const loanInformation = await getCreditInfo(poolContract, borrower.address);
            expect(loanInformation.creditLimit).to.equal(toToken(2_000));
            expect(loanInformation.intervalInDays).to.equal(60);
            expect(loanInformation.aprInBps).to.equal(1217);
            expect(loanInformation.remainingPeriods).to.equal(24);
            expect(loanInformation.state).to.equal(1);
        });

        it("Shall reject loan requests if there is an outstanding loan with outstanding balance", async function () {
            await poolContract.connect(borrower).requestCredit(toToken(3_000), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(3000), 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(toToken(2_000));

            await expect(
                poolContract.connect(borrower).requestCredit(toToken(1_000), 30, 12)
            ).to.be.revertedWithCustomError(poolContract, "creditLineAlreadyExists");
        });

        it("Shall allow new request if existing loan has been paid off", async function () {
            await poolContract.connect(borrower).requestCredit(toToken(3_000), 30, 12);
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, toToken(3_000))
            ).to.be.revertedWithCustomError(poolContract, "creditLineNotInStateForMakingPayment");

            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(3000), 30, 12, 1217);
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, toToken(3_000))
            ).to.be.revertedWithCustomError(poolContract, "creditLineNotInStateForMakingPayment");

            await poolContract.connect(borrower).drawdown(toToken(3_000));
            await testTokenContract.connect(borrower).mint(borrower.address, toToken(2_000));
            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, toToken(3_100));
            await poolContract.connect(borrower).makePayment(borrower.address, toToken(3_100));
            await poolContract.connect(borrower).requestCredit(toToken(4_000), 90, 36);
            const loanInformation = await getCreditInfo(poolContract, borrower.address);
            expect(loanInformation.creditLimit).to.equal(toToken(4_000));
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
            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);
        });

        it("Should not allow loan funding while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pause();
            await expect(
                poolContract.connect(borrower).drawdown(toToken(400))
            ).to.be.revertedWithCustomError(poolContract, "protocolIsPaused");
        });

        it("Should reject drawdown before approval", async function () {
            await expect(
                poolContract.connect(borrower).drawdown(toToken(1_000_000))
            ).to.be.revertedWithCustomError(poolContract, "creditLineNotInStateForDrawdown");
        });

        it("Should reject drawdown when account is deleted", async function () {
            await poolContract.connect(eaServiceAccount).changeCreditLine(borrower.address, 0);
            await expect(
                poolContract.connect(borrower).drawdown(toToken(400))
            ).to.be.revertedWithCustomError(poolContract, "creditLineNotInStateForDrawdown");
        });

        it("Should reject drawdown if the combined balance is higher than the credit limit", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(toToken(1_000_000));

            await expect(
                poolContract.connect(borrower).drawdown(toToken(4000))
            ).to.be.revertedWithCustomError(poolContract, "creditLineExceeded");
            await testTokenContract.mint(borrower.address, toToken(11000));
            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, toToken(1_000_000));
            await poolContract.connect(borrower).makePayment(borrower.address, toToken(1_000_000));
        });

        it("Should reject if the borrowing amount is zero", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            await expect(poolContract.connect(borrower).drawdown(0)).to.be.revertedWithCustomError(
                poolContract,
                "zeroAmountProvided"
            );
        });

        it("Should reject if the borrowing amount is less than platform fees", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(3_000), 30, 12, 1217);
            await expect(
                poolContract.connect(borrower).drawdown(toToken(100))
            ).to.be.revertedWithCustomError(
                feeManagerContract,
                "borrowingAmountLessThanPlatformFees"
            );
        });

        it("Should reject if the borrowing amount is more than approved", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            await expect(
                poolContract.connect(borrower).drawdown(toToken(1_100_000))
            ).to.be.revertedWithCustomError(poolContract, "creditLineExceeded");
        });

        it("Borrow less than approved amount", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            expect(await poolContract.isApproved(borrower.address)).to.equal(true);

            // Should return false when no loan exists
            expect(await poolContract.isApproved(evaluationAgent.address)).to.equal(false);

            let oldBalance = await testTokenContract.balanceOf(borrower.address);
            await expect(poolContract.connect(borrower).drawdown(toToken(100_000)))
                .to.emit(poolContract, "DrawdownMade")
                .withArgs(borrower.address, toToken(100_000), toToken(98_000));

            // Two streams of income
            // fees: 2000. {protocol, poolOwner, EA, Pool}: {400, 100, 300, 1200}
            // interest income: 1000 {protocol, poolOwner, EA, Pool}: {200, 50, 150, 600}
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(
                oldBalance.add(toToken(98_000))
            );

            let accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(600054794);
            expect(accruedIncome.poolOwnerIncome).to.equal(150013698);
            expect(accruedIncome.eaIncome).to.equal(450041095);
            expect(await poolContract.totalPoolValue()).to.equal(5001800164385);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                4902000000000
            );

            await testTokenContract.mint(borrower.address, toToken(2000));

            // Please note since the credit is paid back instantly, no interest is actually charged.
            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, toToken(100000));
            await poolContract.connect(borrower).makePayment(borrower.address, toToken(100000));
        });

        it("Borrow full amount that has been approved", async function () {
            let oldBalance = await testTokenContract.balanceOf(borrower.address);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            expect(await poolContract.isApproved(borrower.address)).to.equal(true);

            await poolContract.connect(borrower).drawdown(toToken(1_000_000));

            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(
                oldBalance.add(toToken(989_000))
            );

            let accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(4200547945);
            expect(accruedIncome.poolOwnerIncome).to.equal(1050136986);
            expect(accruedIncome.eaIncome).to.equal(3150410958);
            expect(await poolContract.totalPoolValue()).to.equal(5012601643837);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                4011000000000
            );

            await testTokenContract.mint(borrower.address, toToken(11000));
            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, toToken(1_000_000));
            await poolContract.connect(borrower).makePayment(borrower.address, toToken(1_000_000));
        });

        it("Borrow full amount that has been approved without platform fees", async function () {
            await feeManagerContract.connect(poolOwner).setFees(0, 0, 0, 0, 0);
            let oldBalance = await testTokenContract.balanceOf(borrower.address);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            expect(await poolContract.isApproved(borrower.address)).to.equal(true);

            await poolContract.connect(borrower).drawdown(toToken(1_000_000));

            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(
                oldBalance.add(toToken(1_000_000))
            );

            let accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(2000547945);
            expect(accruedIncome.poolOwnerIncome).to.equal(500136986);
            expect(accruedIncome.eaIncome).to.equal(1500410958);
            expect(await poolContract.totalPoolValue()).to.equal(5006001643837);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                4000000000000
            );

            await testTokenContract.mint(borrower.address, toToken(11000));
            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, toToken(1_000_000));
            await poolContract.connect(borrower).makePayment(borrower.address, toToken(1_000_000));
        });

        it("Shall reject new approval after a drawdown has happened", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            expect(await poolContract.isApproved(borrower.address)).to.equal(true);

            await poolContract.connect(borrower).drawdown(toToken(1_000_000));

            await expect(
                poolContract
                    .connect(eaServiceAccount)
                    .approveCredit(borrower.address, toToken(500_000), 30, 12, 1217)
            ).to.be.revertedWithCustomError(poolContract, "creditLineOutstanding");
        });

        it("Should reject drawdown in the final pay period of the credit line", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(toToken(1_000_000));
            await testTokenContract.mint(borrower.address, toToken(21002));
            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, toToken(1_010_002));
            await poolContract.connect(borrower).makePayment(borrower.address, toToken(1_010_002));

            let creditInfo = await poolContract.creditRecordMapping(borrower.address);
            expect(creditInfo.unbilledPrincipal).to.equal(0);
            expect(creditInfo.totalDue).to.equal(0);

            await advanceClock(330);
            await expect(
                poolContract.connect(borrower).drawdown(toToken(4000))
            ).to.be.revertedWithCustomError(poolContract, "creditExpiredDueToMaturity");
        });

        it("Should reject drawdown when account is late in payments", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_00_000), 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(toToken(100_000));
            await advanceClock(90);
            await expect(
                poolContract.connect(borrower).drawdown(toToken(4000))
            ).to.be.revertedWithCustomError(poolContract, "creditLineNotInGoodStandingState");
        });
    });

    describe("IsLate()", function () {
        it("Shall not mark the account as late if there is no drawdown", async function () {
            await poolConfigContract.connect(poolOwner).setCreditApprovalExpiration(5);
            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);

            expect(await poolContract.isLate(borrower.address)).to.equal(false);

            await advanceClock(31);
            expect(await poolContract.isLate(borrower.address)).to.equal(false);
        });
        it("Shall mark the account as late if no payment is received by the dueDate", async function () {
            await poolConfigContract.connect(poolOwner).setCreditApprovalExpiration(5);
            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            expect(await poolContract.isLate(borrower.address)).to.equal(false);
            await advanceClock(2);
            await poolContract.connect(borrower).drawdown(toToken(1_000_000));
            expect(await poolContract.isLate(borrower.address)).to.equal(false);
            await advanceClock(31);
            expect(await poolContract.isLate(borrower.address)).to.equal(true);
        });
    });

    describe("Credit expiration without a timely first drawdown", function () {
        it("Cannot borrow after credit expiration window", async function () {
            await poolConfigContract.connect(poolOwner).setCreditApprovalExpiration(5);
            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);

            await advanceClock(6);

            await expect(
                poolContract.connect(borrower).drawdown(toToken(1_000_000))
            ).to.revertedWithCustomError(poolContract, "creditExpiredDueToFirstDrawdownTooLate");
        });

        it("Can borrow if no credit expiration has been setup for the pool", async function () {
            await poolConfigContract.connect(poolOwner).setCreditApprovalExpiration(0);
            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);

            await advanceClock(6);

            await expect(poolContract.connect(borrower).drawdown(toToken(1_000_000)));
            let creditInfo = await poolContract.creditRecordMapping(borrower.address);
            expect(creditInfo.remainingPeriods).to.equal(11);
        });

        it("Expiration window does not apply after initial drawdown", async function () {
            await poolConfigContract.connect(poolOwner).setCreditApprovalExpiration(5);
            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            await expect(poolContract.connect(borrower).drawdown(toToken(500_000)));
            let creditInfo = await poolContract.creditRecordMapping(borrower.address);
            expect(creditInfo.unbilledPrincipal).to.equal(toToken(500_000));

            await advanceClock(6);

            await poolContract.connect(borrower).drawdown(toToken(500_000));
            creditInfo = await poolContract.creditRecordMapping(borrower.address);
            expect(creditInfo.unbilledPrincipal).to.equal(toToken(1_000_000));
        });
    });

    describe("Account update by service account", function () {
        it("Shall not emit BillRefreshed event when the bill should not be refreshed", async function () {
            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(toToken(1_000_000));
            await expect(
                poolContract.connect(pdsServiceAccount).refreshAccount(borrower.address)
            ).to.not.emit(poolContract, "BillRefreshed");
        });

        it("Shall emit BillRefreshed event when the bill is refreshed", async function () {
            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(toToken(1_000_000));

            let record = await poolContract.creditRecordMapping(borrower.address);
            let previousDueDate = record.dueDate;

            await advanceClock(40);

            let expectedDueDate = +previousDueDate + 2592000;

            await expect(poolContract.connect(pdsServiceAccount).refreshAccount(borrower.address))
                .to.emit(poolContract, "BillRefreshed")
                .withArgs(borrower.address, expectedDueDate, pdsServiceAccount.address);
            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                record,
                recordStatic,
                toToken(1_000_000),
                1010002739726,
                expectedDueDate,
                0,
                22202821925,
                22202821925,
                1,
                10,
                1217,
                30,
                4,
                0
            );
            expect(await poolContract.totalPoolValue()).to.equal(5025923336993);
            expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                1005184667398
            );
            expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                2010369334797
            );
            expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(2010369334797);

            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(8641112330);
            expect(accruedIncome.poolOwnerIncome).to.equal(2160278082);
            expect(accruedIncome.eaIncome).to.equal(6480834246);
        });
        it("BillRefresh when it is default ready should not distribute income", async function () {
            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(toToken(1_000_000));

            let record = await poolContract.creditRecordMapping(borrower.address);
            let previousDueDate = record.dueDate;

            // Default-ready - should not distribute the income
            await advanceClock(100);
            let expectedDueDate = +previousDueDate + 3 * 2592000;
            await expect(poolContract.connect(pdsServiceAccount).refreshAccount(borrower.address))
                .to.emit(poolContract, "BillRefreshed")
                .withArgs(borrower.address, expectedDueDate, pdsServiceAccount.address);
            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                record,
                recordStatic,
                toToken(1_000_000),
                1054852500843,
                expectedDueDate,
                0,
                23099940023,
                23099940023,
                3,
                8,
                1217,
                30,
                4,
                0
            );

            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(17790488173);
            expect(accruedIncome.poolOwnerIncome).to.equal(4447622043);
            expect(accruedIncome.eaIncome).to.equal(13342866129);

            // default-ready
            await advanceClock(30);
            expectedDueDate += 2592000;
            await expect(poolContract.connect(pdsServiceAccount).refreshAccount(borrower.address))
                .to.emit(poolContract, "BillRefreshed")
                .withArgs(borrower.address, expectedDueDate, pdsServiceAccount.address);
            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(17790488173);
            expect(accruedIncome.poolOwnerIncome).to.equal(4447622043);
            expect(accruedIncome.eaIncome).to.equal(13342866129);

            // trigger default
            await expect(poolContract.connect(pdsServiceAccount).triggerDefault(borrower.address))
                .to.emit(poolContract, "DefaultTriggered")
                .withArgs(borrower.address, 1077952440866, pdsServiceAccount.address);

            // post-default refreshAccount should do nothing
            await advanceClock(30);
            await expect(
                poolContract.connect(pdsServiceAccount).refreshAccount(borrower.address)
            ).to.not.emit(poolContract, "BillRefreshed");
            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(17790488173);
            expect(accruedIncome.poolOwnerIncome).to.equal(4447622043);
            expect(accruedIncome.eaIncome).to.equal(13342866129);
        });
    });

    // In "Payback".beforeEach(), make sure there is a loan funded.
    describe("Payback", function () {
        beforeEach(async function () {
            await poolConfigContract.connect(poolOwner).setAPR(1217);
            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);

            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(toToken(1_000_000));
        });

        it("Should not allow payback while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pause();
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, toToken(5))
            ).to.be.revertedWithCustomError(poolContract, "protocolIsPaused");
        });

        it("Should reject if payback amount is zero", async function () {
            await testTokenContract.connect(borrower).approve(poolContract.address, toToken(1000));
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, 0)
            ).to.be.revertedWithCustomError(poolContract, "zeroAmountProvided");
        });

        it("Process payback", async function () {
            await advanceClock(29);

            // AmountDue (10002) + 1000 extra principal payment
            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, toToken(11002));

            await poolContract.connect(borrower).makePayment(borrower.address, toToken(11002));

            let creditInfo = await poolContract.creditRecordMapping(borrower.address);

            expect(creditInfo.unbilledPrincipal).to.equal(999000739726);
            expect(creditInfo.remainingPeriods).to.equal(11);

            // Interest income 10_002. Protocol: 2000, PoolOwner: 1500, EA: 500, pool: 6002
            let accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(4200547945);
            expect(accruedIncome.poolOwnerIncome).to.equal(1050136986);
            expect(accruedIncome.eaIncome).to.equal(3150410958);
            expect(await poolContract.totalPoolValue()).to.equal(5012601643837);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                toToken(4_022_002)
            );

            expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                1002520328767
            );
            expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                2005040657534
            );
            expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(2005040657534);
        });

        it("Automatic payback", async function () {
            await advanceClock(29);

            // AmountDue (10002) + 1000 extra principal payment
            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, toToken(11002));

            await poolContract
                .connect(pdsServiceAccount)
                .makePayment(borrower.address, toToken(11002));

            let creditInfo = await poolContract.creditRecordMapping(borrower.address);

            expect(creditInfo.unbilledPrincipal).to.equal(999000739726);
            expect(creditInfo.remainingPeriods).to.equal(11);

            // Interest income 10_002. Protocol: 2000, PoolOwner: 1500, EA: 500, pool: 6002
            let accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncome).to.equal(4200547945);
            expect(accruedIncome.poolOwnerIncome).to.equal(1050136986);
            expect(accruedIncome.eaIncome).to.equal(3150410958);
            expect(await poolContract.totalPoolValue()).to.equal(5012601643837);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                toToken(4_022_002)
            );

            expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                2005040657534
            );
            expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                1002520328767
            );
            expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(2005040657534);
        });
    });

    // In "Payback".beforeEach(), make sure there is a loan funded.
    describe("Quick payback", function () {
        it("Process payback", async function () {
            let lenderBalance = await testTokenContract.balanceOf(lender.address);

            await poolConfigContract.connect(poolOwner).setAPR(1217);
            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);

            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(toToken(1_000_000));
            let blockBefore = await ethers.provider.getBlock();
            let dueDate = blockBefore.timestamp + 2592000;

            await testTokenContract.mint(borrower.address, toToken(1_000_100));

            let oldBalance = await testTokenContract.balanceOf(borrower.address);
            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, toToken(1_000_500));

            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, toToken(1_000_500))
            ).to.emit(poolContract, "PaymentMade");
            let newBalance = await testTokenContract.balanceOf(borrower.address);
            expect(oldBalance.sub(newBalance)).to.be.within(
                toToken(1_000_000),
                toToken(1_000_500)
            );

            let r = await poolContract.creditRecordMapping(borrower.address);
            let rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, toToken(1_000_000), 0, dueDate, 0, 0, 0, 0, 11, 1217, 30, 3, 0);
        });
    });

    describe("Multiple immediate payback towards payoff", function () {
        it("Multiple immediate payback", async function () {
            let lenderBalance = await testTokenContract.balanceOf(lender.address);

            await poolConfigContract.connect(poolOwner).setAPR(1217);
            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);

            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(toToken(1_000_000));
            let blockBefore = await ethers.provider.getBlock();
            let dueDate = blockBefore.timestamp + 2592000;

            await testTokenContract.mint(borrower.address, toToken(1_000_100));

            let oldBalance = await testTokenContract.balanceOf(borrower.address);
            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, toToken(900_000));

            let nextDate = dueDate - 29 * 24 * 3600;
            await setNextBlockTimestamp(nextDate);
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, toToken(900_000))
            ).to.emit(poolContract, "PaymentMade");
            let newBalance = await testTokenContract.balanceOf(borrower.address);

            let r = await poolContract.creditRecordMapping(borrower.address);
            let rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toToken(1_000_000),
                110002739726,
                dueDate,
                -8605663919,
                0,
                0,
                0,
                11,
                1217,
                30,
                3,
                0
            );

            await advanceClock(29);
            dueDate += 2592000;

            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, toToken(120_000));

            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, toToken(120_000))
            ).to.emit(poolContract, "PaymentMade");
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, toToken(1_000_000), 0, dueDate, 0, 0, 0, 0, 10, 1217, 30, 3, 0);
        });
    });

    describe("Multiple borrowing to form positive correction in payoff", function () {
        it("Multiple consecutive borrowing", async function () {
            let lenderBalance = await testTokenContract.balanceOf(lender.address);

            await poolConfigContract.connect(poolOwner).setAPR(1217);
            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);

            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);

            await poolContract.connect(borrower).drawdown(toToken(500_000));
            let blockBefore = await ethers.provider.getBlock();
            let dueDate = blockBefore.timestamp + 2592000;

            await poolContract.connect(borrower).drawdown(toToken(500_000));

            await testTokenContract.mint(borrower.address, toToken(1_000_100));

            await advanceClock(25);
            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, toToken(1_100_000));
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, toToken(1_100_000))
            ).to.emit(poolContract, "PaymentMade");
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, toToken(1_000_000), 0, dueDate, 0, 0, 0, 0, 11, 1217, 30, 3, 0);
        });
    });

    describe("makePayment after account deleted", function () {
        it("Shall revert makePayment() if the account has been deleted", async function () {
            await poolConfigContract.connect(poolOwner).setAPR(1217);
            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 2);

            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 2, 1217);

            await poolContract.connect(borrower).drawdown(toToken(500_000));

            await testTokenContract.mint(borrower.address, toToken(1_000_000));
            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, toToken(1_000_000));
            await poolContract.connect(borrower).makePayment(borrower.address, toToken(100_000));

            await advanceClock(30);
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, toToken(500_000))
            ).to.emit(poolContract, "PaymentMade");
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, toToken(1_000_000), 0, "SKIP", 0, 0, 0, 0, 0, 1217, 30, 0, 0);

            // Additional payment after payoff
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, toToken(1000))
            ).to.be.revertedWithCustomError(poolContract, "creditLineNotInStateForMakingPayment");
        });
    });

    // Test scenario available at https://tinyurl.com/yc898sj4
    describe("Quick large amount payback (for getDueInfo overflow)", function () {
        it("Quick follow-up borrowing", async function () {
            let lenderBalance = await testTokenContract.balanceOf(lender.address);

            await poolConfigContract.connect(poolOwner).setAPR(1217);
            await poolContract.connect(borrower).requestCredit(toToken(1_500_000), 30, 12);

            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_500_000), 30, 12, 1217);

            await poolContract.connect(borrower).drawdown(toToken(1_000_000));
            let blockBefore = await ethers.provider.getBlock();
            let dueDate = blockBefore.timestamp + 2592000;

            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toToken(1_500_000),
                toToken(1_000_000),
                dueDate,
                0,
                10002739726,
                10002739726,
                0,
                11,
                1217,
                30,
                3,
                0
            );

            // Generates negative correction
            await await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, toToken(900_000));
            let nextDate = dueDate - 29 * 24 * 3600;
            await setNextBlockTimestamp(nextDate);
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, toToken(900_000))
            )
                .to.emit(poolContract, "PaymentMade")
                .withArgs(borrower.address, toToken(900_000), 0, 110002739726, borrower.address);

            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toToken(1_500_000),
                110002739726,
                dueDate,
                -8605663919,
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
            dueDate += 2 * 2592000;
            nextDate = dueDate + 1;
            await mineNextBlockWithTimestamp(nextDate);
            dueDate += 2592000;

            await testTokenContract.connect(borrower).mint(borrower.address, toToken(50_000));
            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, toToken(50_000));

            nextDate = dueDate - 29 * 24 * 3600;
            await setNextBlockTimestamp(nextDate);
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, toToken(50_000))
            ).to.emit(poolContract, "PaymentMade");
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toToken(1_500_000),
                60589319729,
                dueDate,
                -443536429,
                0,
                0,
                0,
                8,
                1217,
                30,
                3,
                0
            );

            await testTokenContract.connect(borrower).mint(borrower.address, toToken(60146));
            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, toToken(60146));

            nextDate = nextDate + 1 * 24 * 3600;
            await setNextBlockTimestamp(nextDate);
            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, toToken(60146))
            )
                .to.emit(poolContract, "PaymentMade")
                .withArgs(borrower.address, 59580128051, 0, 0, borrower.address);

            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, toToken(1_500_000), 0, dueDate, 0, 0, 0, 0, 8, 1217, 30, 3, 0);
        });
    });

    // Default flow. After each pay period, simulates to LatePayMonitorService to call updateDueInfo().
    // Test scenario available at https://tinyurl.com/yc5fks9x
    describe("Default", function () {
        let dueDate, nextDate;

        describe("Common", function () {
            beforeEach(async function () {
                await poolConfigContract.connect(poolOwner).setAPR(1217);
                await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);

                await poolContract
                    .connect(eaServiceAccount)
                    .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
                await poolContract.connect(borrower).drawdown(toToken(1_000_000));
                let blockBefore = await ethers.provider.getBlock();
                dueDate = blockBefore.timestamp + 2592000;
            });

            it("Default flow", async function () {
                await poolConfigContract.connect(poolOwner).setPoolDefaultGracePeriod(60);

                // Period 1: Late for payment
                nextDate = dueDate + 1;
                await mineNextBlockWithTimestamp(nextDate);
                dueDate += 2592000;

                await poolContract.refreshAccount(borrower.address);
                let creditInfo = await poolContract.creditRecordMapping(borrower.address);
                await expect(
                    poolContract.triggerDefault(borrower.address)
                ).to.be.revertedWithCustomError(poolContract, "defaultTriggeredTooEarly");

                expect(creditInfo.unbilledPrincipal).to.equal(1010002739726);
                expect(creditInfo.feesAndInterestDue).to.equal(22202821925);
                expect(creditInfo.totalDue).to.equal(22202821925);
                expect(creditInfo.remainingPeriods).to.equal(10);
                expect(creditInfo.missedPeriods).to.equal(1);
                expect(await poolContract.totalPoolValue()).to.equal(5025923336993);

                //Period 2: Two periods lates
                nextDate = dueDate + 1;
                await mineNextBlockWithTimestamp(nextDate);
                dueDate += 2592000;

                await poolContract.refreshAccount(borrower.address);
                creditInfo = await poolContract.creditRecordMapping(borrower.address);
                await expect(
                    poolContract.triggerDefault(borrower.address)
                ).to.be.revertedWithCustomError(poolContract, "defaultTriggeredTooEarly");

                expect(creditInfo.unbilledPrincipal).to.equal(1032205561651);
                expect(creditInfo.feesAndInterestDue).to.equal(22646939192);
                expect(creditInfo.totalDue).to.equal(22646939192);
                expect(creditInfo.remainingPeriods).to.equal(9);
                expect(creditInfo.missedPeriods).to.equal(2);
                expect(await poolContract.totalPoolValue()).to.equal(5039511500510);

                // Period 3: 3 periods late. ready for default.
                nextDate = dueDate + 1;
                await mineNextBlockWithTimestamp(nextDate);
                dueDate += 2592000;
                expect(await poolContract.isLate(borrower.address)).to.equal(true);

                // Intertionally bypass calling updateDueInfo(), and expects triggerDefault() to call it
                // await poolContract.updateDueInfo(borrower.address);
                // creditInfo = await poolContract.creditRecordMapping(borrower.address);

                // Triggers default and makes sure the event is emitted
                await expect(
                    poolContract.connect(eaServiceAccount).triggerDefault(borrower.address)
                )
                    .to.emit(poolContract, "DefaultTriggered")
                    .withArgs(borrower.address, 1054852500843, eaServiceAccount.address);

                creditInfo = await poolContract.creditRecordMapping(borrower.address);
                expect(creditInfo.unbilledPrincipal).to.equal(1054852500843);
                expect(creditInfo.feesAndInterestDue).to.equal(23099940023);
                expect(creditInfo.totalDue).to.equal(23099940023);
                expect(creditInfo.remainingPeriods).to.equal(8);
                expect(creditInfo.missedPeriods).to.equal(3);

                // Checks pool value and all LP's withdrawable funds
                expect(await hdtContract.totalSupply()).to.equal(toToken(5_000_000));
                expect(await poolContract.totalPoolValue()).to.equal(3984658999667);
                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    796931799933
                );
                expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                    1593863599866
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    1593863599866
                );

                expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                    toToken(4_011_000)
                );

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(13170500168);
                expect(accruedIncome.poolOwnerIncome).to.equal(3292625041);
                expect(accruedIncome.eaIncome).to.equal(9877875124);

                // Should not call triggerDefault() again after an account is defaulted
                await expect(
                    poolContract.connect(eaServiceAccount).triggerDefault(borrower.address)
                ).to.be.revertedWithCustomError(poolContract, "defaultHasAlreadyBeenTriggered");
            });

            it("Post-default payment", async function () {
                await testTokenContract.connect(borrower).mint(borrower.address, toToken(200_000));
                await poolConfigContract.connect(poolOwner).setPoolDefaultGracePeriod(60);

                // Period 1: Late for payment, trigger default. The same setup as the "default flow" test.
                nextDate = dueDate + 1;
                await mineNextBlockWithTimestamp(nextDate);
                dueDate += 2592000;
                await poolContract.refreshAccount(borrower.address);
                nextDate = dueDate + 1;
                await mineNextBlockWithTimestamp(nextDate);
                dueDate += 2592000;
                await poolContract.refreshAccount(borrower.address);
                nextDate = dueDate + 1;
                await mineNextBlockWithTimestamp(nextDate);
                dueDate += 2592000;

                // Triggers default and makes sure the event is emitted
                await expect(
                    poolContract.connect(eaServiceAccount).triggerDefault(borrower.address)
                )
                    .to.emit(poolContract, "DefaultTriggered")
                    .withArgs(borrower.address, 1054852500843, eaServiceAccount.address);

                creditInfo = await poolContract.creditRecordMapping(borrower.address);
                expect(creditInfo.unbilledPrincipal).to.equal(1054852500843);
                expect(creditInfo.feesAndInterestDue).to.equal(23099940023);
                expect(creditInfo.totalDue).to.equal(23099940023);
                expect(creditInfo.remainingPeriods).to.equal(8);
                expect(creditInfo.missedPeriods).to.equal(3);

                // Checks pool value and all LP's withdrawable funds
                expect(await hdtContract.totalSupply()).to.equal(toToken(5_000_000));
                expect(await poolContract.totalPoolValue()).to.equal(3984658999667);
                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    796931799933
                );
                expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                    1593863599866
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    1593863599866
                );

                expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                    toToken(4_011_000)
                );

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(13170500168);
                expect(accruedIncome.poolOwnerIncome).to.equal(3292625041);
                expect(accruedIncome.eaIncome).to.equal(9877875124);

                // Stage 2: borrower pays back after default is triggered.
                // the amount is unable to cover all the outstanding fees and principals.
                // the fees will be charged first, then the principal. The account is in default
                // state until everything is paid off.
                nextDate = dueDate + 1;
                await mineNextBlockWithTimestamp(nextDate);
                dueDate += 2592000;

                await testTokenContract
                    .connect(borrower)
                    .approve(poolContract.address, toToken(25_000));

                nextDate = dueDate - 20 * 24 * 3600;
                await setNextBlockTimestamp(nextDate);
                await poolContract
                    .connect(borrower)
                    .makePayment(borrower.address, toToken(25_000));

                record = await poolContract.creditRecordMapping(borrower.address);
                recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
                checkRecord(
                    record,
                    recordStatic,
                    toToken(1_000_000),
                    1076514442977,
                    dueDate,
                    -9589279,
                    0,
                    0,
                    0,
                    7,
                    1217,
                    30,
                    5,
                    1029852500843
                );
                expect(await poolContract.totalPoolValue()).to.equal(4009658999667);
                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    801931799933
                );
                expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                    1603863599866
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    1603863599866
                );

                // Checks all the accrued income of protocol, poolOwner, and EA.
                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(13170500168);
                expect(accruedIncome.poolOwnerIncome).to.equal(3292625041);
                expect(accruedIncome.eaIncome).to.equal(9877875124);

                expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                    toToken(4_036_000)
                );

                // // Stage 3: pay enough to cover all principal losses
                await testTokenContract
                    .connect(borrower)
                    .approve(poolContract.address, toToken(1_050_000));

                nextDate = nextDate + 10 * 24 * 3600;
                await setNextBlockTimestamp(nextDate);
                await expect(
                    poolContract
                        .connect(borrower)
                        .makePayment(borrower.address, toToken(1_050_000))
                )
                    .to.emit(poolContract, "PaymentMade")
                    .withArgs(
                        borrower.address,
                        toToken(1_050_000),
                        0,
                        26514442977,
                        borrower.address
                    );

                record = await poolContract.creditRecordMapping(borrower.address);
                recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
                checkRecord(
                    record,
                    recordStatic,
                    toToken(1_000_000),
                    26514442977,
                    dueDate,
                    -3510548183,
                    0,
                    0,
                    0,
                    7,
                    1217,
                    30,
                    5,
                    0
                );
                expect(await poolContract.totalPoolValue()).to.equal(5051600000006);
                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    1010320000001
                );
                expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                    2020640000002
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    2020640000002
                );

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(17199999999);
                expect(accruedIncome.poolOwnerIncome).to.equal(4299999998);
                expect(accruedIncome.eaIncome).to.equal(12899999997);

                expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                    toToken(5_086_000)
                );

                // // Stage 4: pay off the remaining fees
                await testTokenContract
                    .connect(borrower)
                    .approve(poolContract.address, toToken(27_000));

                nextDate = nextDate + 1 * 24 * 3600;
                await setNextBlockTimestamp(nextDate);
                await expect(
                    poolContract.connect(borrower).makePayment(borrower.address, toToken(27_000))
                )
                    .to.emit(poolContract, "PaymentMade")
                    .withArgs(borrower.address, 22924329673, 0, 0, borrower.address);

                record = await poolContract.creditRecordMapping(borrower.address);
                recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
                checkRecord(
                    record,
                    recordStatic,
                    toToken(1_000_000),
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
                expect(await poolContract.totalPoolValue()).to.equal(5065354597811);
                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    1013070919562
                );
                expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                    2026141839124
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    2026141839124
                );

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(21784865933);
                expect(accruedIncome.poolOwnerIncome).to.equal(5446216481);
                expect(accruedIncome.eaIncome).to.equal(16338649448);

                expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                    5108924329673
                );
            });
        });

        describe("Limit", function () {
            it("Default to cause pool value zero", async function () {
                await feeManagerContract.connect(poolOwner).setFees(0, 0, 0, 0, 0);
                await poolConfigContract.connect(poolOwner).setAPR(1217);
                await poolConfigContract.connect(poolOwner).setPoolDefaultGracePeriod(60);

                await poolContract.connect(borrower).requestCredit(toToken(5_000_000), 30, 12);
                await poolContract
                    .connect(eaServiceAccount)
                    .approveCredit(borrower.address, toToken(5_000_000), 30, 12, 1217);
                await poolContract.connect(borrower).drawdown(toToken(5_000_000));
                let blockBefore = await ethers.provider.getBlock();
                dueDate = blockBefore.timestamp + 2592000;

                nextDate = dueDate + 1;
                await mineNextBlockWithTimestamp(nextDate);
                dueDate += 2592000;
                await poolContract.refreshAccount(borrower.address);
                nextDate = dueDate + 1;
                await mineNextBlockWithTimestamp(nextDate);
                dueDate += 2592000;
                await poolContract.refreshAccount(borrower.address);
                nextDate = dueDate + 1;
                await mineNextBlockWithTimestamp(nextDate);
                dueDate += 2592000;

                await expect(
                    poolContract.connect(eaServiceAccount).triggerDefault(borrower.address)
                )
                    .to.emit(poolContract, "DefaultTriggered")
                    .withArgs(borrower.address, 5151546922031, eaServiceAccount.address);

                expect(await poolContract.totalPoolValue()).to.equal(0);
            });
        });
    });

    describe("Protocol/Pool Owner/EA fee", function () {
        it("Should not allow non-protocol-owner to withdraw protocol", async function () {
            await expect(
                poolConfigContract.withdrawProtocolFee(toToken(1))
            ).to.be.revertedWithCustomError(poolConfigContract, "notProtocolOwner");
        });

        it("Should not allow non-pool-owner to withdraw pool owner fee", async function () {
            await expect(
                poolConfigContract.withdrawPoolOwnerFee(toToken(1))
            ).to.be.revertedWithCustomError(poolConfigContract, "notPoolOwnerTreasury");
        });

        it("Should not allow non-poolOwner or EA withdraw EA fee", async function () {
            await expect(
                poolConfigContract.withdrawEAFee(toToken(1))
            ).to.be.revertedWithCustomError(poolConfigContract, "notPoolOwnerOrEA");
        });

        it("Should not withdraw protocol fee while amount > withdrawable", async function () {
            const poolConfigFromProtocolOwner = await poolConfigContract.connect(protocolOwner);
            await expect(
                poolConfigFromProtocolOwner.withdrawProtocolFee(toToken(1))
            ).to.be.revertedWithCustomError(
                poolConfigContract,
                "withdrawnAmountHigherThanBalance"
            );
        });

        it("Should not withdraw pool owner fee if amount > withdrawable", async function () {
            const poolConfigFromPoolOwner = await poolConfigContract.connect(poolOwnerTreasury);
            await expect(
                poolConfigFromPoolOwner.withdrawPoolOwnerFee(toToken(1))
            ).to.be.revertedWithCustomError(
                poolConfigContract,
                "withdrawnAmountHigherThanBalance"
            );
        });

        it("Should not withdraw ea fee while amount > withdrawable", async function () {
            const poolConfigFromPoolOwner = await poolConfigContract.connect(evaluationAgent);
            await expect(
                poolConfigFromPoolOwner.withdrawEAFee(toToken(1))
            ).to.be.revertedWithCustomError(
                poolConfigContract,
                "withdrawnAmountHigherThanBalance"
            );
        });

        it("Should withdraw protocol fee", async function () {
            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(toToken(100_000));

            let accruedIncome = await poolConfigContract.accruedIncome();
            const amount = accruedIncome.protocolIncome;
            const poolConfigFromProtocolOwner = await poolConfigContract.connect(protocolOwner);
            const beforeBalance = await testTokenContract.balanceOf(treasury.address);

            await poolConfigFromProtocolOwner.withdrawProtocolFee(amount);
            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.protocolIncomeWithdrawn).equals(amount);
            const afterBalance = await testTokenContract.balanceOf(treasury.address);
            expect(amount).equals(afterBalance.sub(beforeBalance));

            await expect(
                poolConfigFromProtocolOwner.withdrawProtocolFee(1)
            ).to.be.revertedWithCustomError(
                poolConfigContract,
                "withdrawnAmountHigherThanBalance"
            );
        });

        it("Should withdraw pool owner fee", async function () {
            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(toToken(100_000));

            let accruedIncome = await poolConfigContract.accruedIncome();
            const amount = accruedIncome.poolOwnerIncome;
            const poolConfigFromPoolOwner = await poolConfigContract.connect(poolOwnerTreasury);
            const beforeBalance = await testTokenContract.balanceOf(poolOwnerTreasury.address);

            await poolConfigFromPoolOwner.withdrawPoolOwnerFee(amount);
            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.poolOwnerIncomeWithdrawn).equals(amount);
            const afterBalance = await testTokenContract.balanceOf(poolOwnerTreasury.address);
            expect(amount).equals(afterBalance.sub(beforeBalance));

            await expect(
                poolConfigFromPoolOwner.withdrawPoolOwnerFee(1)
            ).to.be.revertedWithCustomError(
                poolConfigContract,
                "withdrawnAmountHigherThanBalance"
            );
        });

        it("Should withdraw ea fee", async function () {
            await poolContract.connect(borrower).requestCredit(toToken(1_000_000), 30, 12);
            await poolContract
                .connect(eaServiceAccount)
                .approveCredit(borrower.address, toToken(1_000_000), 30, 12, 1217);
            await poolContract.connect(borrower).drawdown(toToken(100_000));

            let accruedIncome = await poolConfigContract.accruedIncome();
            const amount = accruedIncome.eaIncome;
            const poolConfigFromEA = await poolConfigContract.connect(evaluationAgent);
            const beforeBalance = await testTokenContract.balanceOf(evaluationAgent.address);

            await poolConfigFromEA.withdrawEAFee(amount);
            accruedIncome = await poolConfigContract.accruedIncome();
            expect(accruedIncome.eaIncomeWithdrawn).equals(amount);
            const afterBalance = await testTokenContract.balanceOf(evaluationAgent.address);
            expect(amount).equals(afterBalance.sub(beforeBalance));

            await expect(poolConfigFromEA.withdrawEAFee(1)).to.be.revertedWithCustomError(
                poolConfigContract,
                "withdrawnAmountHigherThanBalance"
            );
        });

        it("Should not withdraw zero pool owner fee", async function () {
            const poolConfigFromPoolOwner = await poolConfigContract.connect(poolOwnerTreasury);
            await expect(
                poolConfigFromPoolOwner.withdrawPoolOwnerFee(0)
            ).to.be.revertedWithCustomError(poolConfigContract, "zeroAmountProvided");
        });

        it("Should not withdraw zero ea fee", async function () {
            const poolConfigFromPoolOwner = await poolConfigContract.connect(evaluationAgent);
            await expect(poolConfigFromPoolOwner.withdrawEAFee(0)).to.be.revertedWithCustomError(
                poolConfigContract,
                "zeroAmountProvided"
            );
        });
    });
});
