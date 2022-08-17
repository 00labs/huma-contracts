/* eslint-disable no-underscore-dangle */
const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

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
describe("Base Fee Manager", function () {
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

    before(async function () {
        [
            owner,
            lender,
            borrower,
            borrower2,
            treasury,
            creditApprover,
            poolOwner,
        ] = await ethers.getSigners();

        const HumaConfig = await ethers.getContractFactory("HumaConfig");
        humaConfigContract = await HumaConfig.deploy(treasury.address);
        humaConfigContract.setHumaTreasury(treasury.address);

        const poolLockerFactory = await ethers.getContractFactory(
            "PoolLockerFactory"
        );
        poolLockerFactoryContract = await poolLockerFactory.deploy();

        // Deploy Fee Manager
        const feeManagerFactory = await ethers.getContractFactory(
            "BaseFeeManager"
        );
        feeManagerContract = await feeManagerFactory.deploy();

        const TestToken = await ethers.getContractFactory("TestToken");
        testTokenContract = await TestToken.deploy();

        // Deploy BaseCreditPool
        const BaseCreditPool = await ethers.getContractFactory(
            "BaseCreditPool"
        );
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

        await feeManagerContract
            .connect(poolOwner)
            .setFees(10, 100, 20, 100, 30, 100);

        await testTokenContract.approve(poolContract.address, 100);

        await poolContract.makeInitialDeposit(100);
    });

    beforeEach(async function () {});

    describe("Huma Pool Settings", function () {
        // todo Verify only pool admins can deployNewPool

        it("Should set the fees correctly", async function () {
            var [f1, f2, f3, f4, f5, f6] = await feeManagerContract.getFees();
            expect(f1).to.equal(10);
            expect(f2).to.equal(100);
            expect(f3).to.equal(20);
            expect(f4).to.equal(100);
            expect(f5).to.equal(30);
            expect(f6).to.equal(100);
        });

        it("Should disallow non-owner to set the fees", async function () {
            await expect(
                feeManagerContract
                    .connect(treasury)
                    .setFees(15, 150, 25, 250, 35, 350)
            ).to.be.revertedWith("caller is not the owner"); // open zeppelin default error message
        });

        it("Should allow owner to set the fees", async function () {
            await feeManagerContract
                .connect(poolOwner)
                .setFees(15, 150, 25, 250, 35, 350);

            var [f1, f2, f3, f4, f5, f6] = await feeManagerContract.getFees();
            expect(f1).to.equal(15);
            expect(f2).to.equal(150);
            expect(f3).to.equal(25);
            expect(f4).to.equal(250);
            expect(f5).to.equal(35);
            expect(f6).to.equal(350);
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
                feeManagerContract
                    .connect(treasury)
                    .addFixedPayment(24, 500, 43871)
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
            let terms = [
                12, 12, 12, 12, 12, 12, 12, 24, 24, 24, 24, 24, 24, 24,
            ];
            let aprInBps = [
                500, 600, 700, 800, 900, 1000, 1025, 500, 600, 700, 800, 900,
                1000, 1025,
            ];
            let payments = [
                85607, 86066, 86527, 86988, 87451, 87916, 88032, 43871, 44321,
                44773, 45227, 45685, 46145, 46260,
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
        it("Should calculate interest only correctly", async function () {});
        it("Should calculate fixed payment amount correctly", async function () {});
        it("Should fallback properly when fixed payment amount lookup failed", async function () {});
    });

    // IntOnly := Interest Only, Fixed := Fixed monthly payment, backFee := backFee,
    describe("getNextPayment()", function () {
        it("IntOnly - 1st pay - no backFee - amt < interest", async function () {});
        it("IntOnly - 1st pay - no backFee - amt = interest", async function () {});
        it("IntOnly - 1st pay - no backFee - late - amt = interest, thus < interst + late fee", async function () {});
        it("IntOnly - 1st pay - no backFee - late - amt = interest + late fee", async function () {});
        it("IntOnly - 1st pay - no backFee - amt between [interest, interest + principal]", async function () {});
        it("IntOnly - 1st pay - no backFee - amt = interest + principal (early payoff)", async function () {});
        it("IntOnly - 1st pay - no backFee - amt > interest + principal (early payoff, extra pay)", async function () {});
        it("IntOnly - 1st pay - has backFee - amt = interest + principal + backFee (early payoff)", async function () {});
        it("IntOnly - 1st pay - has backFee - amt > interest + principal + backFee (early payoff, extra pay)", async function () {});
        it("IntOnly - 2nd pay - no backFee - amt < interest", async function () {});
        it("IntOnly - 2nd pay - no backFee - amt = interest", async function () {});
        it("IntOnly - 2nd pay - no backFee - late - amt = interest, thus < interst + late fee", async function () {});
        it("IntOnly - 2nd pay - no backFee - late - amt = interest + late fee", async function () {});
        it("IntOnly - 2nd pay - no backFee - amt between [interest, interest + principal]", async function () {});
        it("IntOnly - 2nd pay - no backFee - amt = interest + principal (early payoff)", async function () {});
        it("IntOnly - 2nd pay - no backFee - amt > interest + principal (early payoff, extra pay)", async function () {});
        it("IntOnly - 2nd pay - has backFee - amt = interest + principal + backFee (early payoff)", async function () {});
        it("IntOnly - 2nd pay - has backFee - amt > interest + principal + backFee (early payoff, extra pay)", async function () {});
        it("IntOnly - final pay - no backFee - amt < interst", async function () {});
        it("IntOnly - final pay - no backFee - amt b/w [interest, interst + principal]", async function () {});
        it("IntOnly - final pay - no backFee - amt = interst + principal", async function () {});
        it("IntOnly - final pay - no backFee - amt = interst + principal", async function () {});
        it("IntOnly - final pay - no backFee - late - amt b/w [interst + principal, interst + principal + late fee]", async function () {});
        it("IntOnly - final pay - no backFee - late - amt = interst + principal + late fee", async function () {});
        it("IntOnly - final pay - no backFee - late - amt > interst + principal + late fee", async function () {});
        it("IntOnly - final pay - has backFee - amt < interst", async function () {});
        it("IntOnly - final pay - has backFee - amt = interest + principal", async function () {});
        it("IntOnly - final pay - has backFee - amt b/w [interest + principal, interst + principal + backFee]", async function () {});
        it("IntOnly - final pay - has backFee - amt = interst + principal + backFee", async function () {});
        it("IntOnly - final pay - has backFee - amt > interst + principal + backFee", async function () {});
        it("IntOnly - final pay - has backFee - late - amt < interst + principal + backFee + late fee", async function () {});
        it("IntOnly - final pay - has backFee - late - amt = interst + principal + backFee + late fee", async function () {});
        it("IntOnly - final pay - has backFee - late - amt > interst + principal + backFee + late fee", async function () {});

        it("Fixed - 1st pay - no backFee - amt < interest", async function () {});
        it("Fixed - 1st pay - no backFee - amt = interest", async function () {});
        it("Fixed - 1st pay - no backFee - late - amt = interest, thus < interst + late fee", async function () {});
        it("Fixed - 1st pay - no backFee - late - amt = interest + late fee", async function () {});
        it("Fixed - 1st pay - no backFee - amt between [interest, interest + principal]", async function () {});
        it("Fixed - 1st pay - no backFee - amt = interest + principal (early payoff)", async function () {});
        it("Fixed - 1st pay - no backFee - amt > interest + principal (early payoff, extra pay)", async function () {});
        it("Fixed - 1st pay - has backFee - amt = interest + principal + backFee (early payoff)", async function () {});
        it("Fixed - 1st pay - has backFee - amt > interest + principal + backFee (early payoff, extra pay)", async function () {});
        it("Fixed - 2nd pay - no backFee - amt < interest", async function () {});
        it("Fixed - 2nd pay - no backFee - amt = interest", async function () {});
        it("Fixed - 2nd pay - no backFee - late - amt = interest, thus < interst + late fee", async function () {});
        it("Fixed - 2nd pay - no backFee - late - amt = interest + late fee", async function () {});
        it("Fixed - 2nd pay - no backFee - amt between [interest, interest + principal]", async function () {});
        it("Fixed - 2nd pay - no backFee - amt = interest + principal (early payoff)", async function () {});
        it("Fixed - 2nd pay - no backFee - amt > interest + principal (early payoff, extra pay)", async function () {});
        it("Fixed - 2nd pay - has backFee - amt = interest + principal + backFee (early payoff)", async function () {});
        it("Fixed - 2nd pay - has backFee - amt > interest + principal + backFee (early payoff, extra pay)", async function () {});
        it("Fixed - final pay - no backFee - amt < interst", async function () {});
        it("Fixed - final pay - no backFee - amt b/w [interest, interst + principal]", async function () {});
        it("Fixed - final pay - no backFee - amt = interst + principal", async function () {});
        it("Fixed - final pay - no backFee - amt = interst + principal", async function () {});
        it("Fixed - final pay - no backFee - late - amt b/w [interst + principal, interst + principal + late fee]", async function () {});
        it("Fixed - final pay - no backFee - late - amt = interst + principal + late fee", async function () {});
        it("Fixed - final pay - no backFee - late - amt > interst + principal + late fee", async function () {});
        it("Fixed - final pay - has backFee - amt < interst", async function () {});
        it("Fixed - final pay - has backFee - amt = interest + principal", async function () {});
        it("Fixed - final pay - has backFee - amt b/w [interest + principal, interst + principal + backFee]", async function () {});
        it("Fixed - final pay - has backFee - amt = interst + principal + backFee", async function () {});
        it("Fixed - final pay - has backFee - amt > interst + principal + backFee", async function () {});
        it("Fixed - final pay - has backFee - late - amt < interst + principal + backFee + late fee", async function () {});
        it("Fixed - final pay - has backFee - late - amt = interst + principal + backFee + late fee", async function () {});
        it("Fixed - final pay - has backFee - late - amt > interst + principal + backFee + late fee", async function () {});
    });
});
