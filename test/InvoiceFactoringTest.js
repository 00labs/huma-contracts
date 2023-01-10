/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {expect} = require("chai");
const {BigNumber: BN} = require("ethers");
const {
    deployContracts,
    deployAndSetupPool,
    advanceClock,
    checkRecord,
    checkResult,
    checkArruedIncome,
    getCreditInfo,
    toToken,
    evmSnapshot,
    evmRevert,
} = require("./BaseTest");

const getInvoiceContractFromAddress = async function (address, signer) {
    return ethers.getContractAt("ReceivableFactoringPool", address, signer);
};

describe("Invoice Factoring", function () {
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
    let poolOperator;
    let r;
    let rs;
    let poolOwnerTreasury;

    let invoiceNFTContract;
    let invoiceNFTTokenId;
    let dueDate;

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
            payer,
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

        const InvoiceNFT = await ethers.getContractFactory("InvoiceNFT");
        invoiceNFTContract = await InvoiceNFT.deploy(testTokenContract.address);

        const tx = await invoiceNFTContract.mintNFT(borrower.address, "");
        const receipt = await tx.wait();
        for (const evt of receipt.events) {
            if (evt.event === "NFTGenerated") {
                invoiceNFTTokenId = evt.args.tokenId;
            }
        }

        await testTokenContract.mint(payer.address, toToken(10_000_000));

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
            true,
            poolOperator,
            poolOwnerTreasury
        );

        await poolConfigContract.connect(poolOwner).setWithdrawalLockoutPeriod(90);
        await poolConfigContract.connect(poolOwner).setPoolDefaultGracePeriod(60);
        await feeManagerContract
            .connect(poolOwner)
            .setFees(toToken(1000), 100, toToken(2000), 100, 0);
        await poolConfigContract.connect(poolOwner).setAPR(0);
        await poolConfigContract.connect(poolOwner).setMaxCreditLine(toToken(1_000_000));
        await humaConfigContract.connect(protocolOwner).setTreasuryFee(2000);
        await poolConfigContract.connect(poolOwner).setPoolOwnerRewardsAndLiquidity(625, 0);
        await poolConfigContract.connect(poolOwner).setEARewardsAndLiquidity(1875, 0);
        await poolConfigContract.connect(poolOwner).setReceivableRequiredInBps(100);
    });

    beforeEach(async function () {
        sId = await evmSnapshot();
    });

    afterEach(async function () {
        if (sId) {
            const res = await evmRevert(sId);
        }
    });

    describe("Post Approved Invoice Factoring", function () {
        beforeEach(async function () {
            await testTokenContract.connect(borrower).approve(poolContract.address, 1_000_000);
        });

        it("Should only allow evaluation agents to post approved loan requests", async function () {
            await expect(
                poolContract
                    .connect(lender)
                    .functions[
                        "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                    ](
                        borrower.address,
                        toToken(1_000_000),
                        30,
                        1,
                        0,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        toToken(1_500_000)
                    )
            ).to.be.revertedWithCustomError(poolContract, "evaluationAgentServiceAccountRequired");
        });

        it("Should not allow posting approved loans while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pause();

            await expect(
                poolContract
                    .connect(eaServiceAccount)
                    .functions[
                        "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                    ](
                        borrower.address,
                        toToken(1_000_000),
                        30,
                        1,
                        0,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        toToken(1_500_000)
                    )
            ).to.be.revertedWithCustomError(poolContract, "protocolIsPaused");
        });

        it("Should not allow posting approved laons while pool is off", async function () {
            await poolContract.connect(poolOwner).disablePool();

            await expect(
                poolContract
                    .connect(eaServiceAccount)
                    .functions[
                        "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                    ](
                        borrower.address,
                        toToken(1_000_000),
                        30,
                        1,
                        0,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        toToken(1_500_000)
                    )
            ).to.be.revertedWithCustomError(poolContract, "poolIsNotOn");
        });

        it("Cannot post approved loan with amount greater than limit", async function () {
            await expect(
                poolContract
                    .connect(eaServiceAccount)
                    .functions[
                        "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                    ](
                        borrower.address,
                        toToken(1_200_000),
                        30,
                        1,
                        0,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        toToken(1_500_000)
                    )
            ).to.be.revertedWithCustomError(poolContract, "greaterThanMaxCreditLine");
        });

        it("Should reject zero address receivable", async function () {
            await expect(
                poolContract
                    .connect(eaServiceAccount)
                    .functions[
                        "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                    ](
                        borrower.address,
                        toToken(1_000_000),
                        30,
                        1,
                        0,
                        ethers.constants.AddressZero,
                        invoiceNFTTokenId,
                        toToken(1_500_000)
                    )
            ).to.be.revertedWithCustomError(poolContract, "zeroAddressProvided");
        });

        it("Should reject non-ERC20-or-ERC721", async function () {
            await expect(
                poolContract
                    .connect(eaServiceAccount)
                    .functions[
                        "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                    ](
                        borrower.address,
                        toToken(1_000_000),
                        30,
                        1,
                        0,
                        feeManagerContract.address,
                        invoiceNFTTokenId,
                        toToken(1_500_000)
                    )
            ).to.be.revertedWithCustomError(poolContract, "unsupportedReceivableAsset");
        });

        it("Should post approved invoice financing successfully", async function () {
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(0);

            await poolConfigContract.connect(poolOwner).setAPR(0);

            await poolContract
                .connect(eaServiceAccount)
                .functions[
                    "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                ](
                    borrower.address,
                    toToken(1_000_000),
                    30,
                    1,
                    1000,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    toToken(1_500_000)
                );

            const creditInfo = await getCreditInfo(poolContract, borrower.address);

            expect(creditInfo.creditLimit).to.equal(toToken(1_000_000));
            expect(creditInfo.unbilledPrincipal).to.equal(0);
            expect(creditInfo.remainingPeriods).to.equal(1);
            expect(creditInfo.aprInBps).to.equal(1000);
        });

        it("Should reject approved invoice with invoice amount lower than the receivable requirement", async function () {
            await poolConfigContract.connect(poolOwner).setReceivableRequiredInBps(12500);

            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(0);

            await expect(
                poolContract
                    .connect(eaServiceAccount)
                    .functions[
                        "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                    ](
                        borrower.address,
                        toToken(1_000_000),
                        30,
                        1,
                        0,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        toToken(1_000_000)
                    )
            ).to.be.revertedWithCustomError(poolContract, "insufficientReceivableAmount");
        });

        it("Should approve invoice with amount equals to or high than the receivable requirement", async function () {
            await poolConfigContract.connect(poolOwner).setReceivableRequiredInBps(12500);

            await poolContract
                .connect(eaServiceAccount)
                .functions[
                    "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                ](
                    borrower.address,
                    toToken(1_000_000),
                    30,
                    1,
                    0,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    toToken(1_500_000)
                );

            const creditInfo = await getCreditInfo(poolContract, borrower.address);

            expect(creditInfo.creditLimit).to.equal(toToken(1_000_000));
            expect(creditInfo.unbilledPrincipal).to.equal(0);
            expect(creditInfo.remainingPeriods).to.equal(1);
        });

        it("Should approve new invoice if existing loan's balance is zero", async function () {
            await poolConfigContract.connect(poolOwner).setReceivableRequiredInBps(12500);

            await poolContract
                .connect(eaServiceAccount)
                .functions[
                    "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                ](
                    borrower.address,
                    toToken(1_000_000),
                    30,
                    1,
                    0,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    toToken(1_500_000)
                );

            let creditInfo = await getCreditInfo(poolContract, borrower.address);

            expect(creditInfo.creditLimit).to.equal(toToken(1_000_000));
            expect(creditInfo.unbilledPrincipal).to.equal(0);
            expect(creditInfo.remainingPeriods).to.equal(1);

            let receivableInfo = await poolContract.receivableInfoMapping(borrower.address);
            expect(receivableInfo.receivableAmount).to.equal(toToken(1_500_000));
            expect(receivableInfo.receivableParam).to.equal(invoiceNFTTokenId);
            expect(receivableInfo.receivableAsset).to.equal(invoiceNFTContract.address);

            const tx = await invoiceNFTContract.mintNFT(borrower.address, "");
            const receipt = await tx.wait();
            for (const evt of receipt.events) {
                if (evt.event === "NFTGenerated") {
                    invoiceNFTTokenId = evt.args.tokenId;
                }
            }

            await poolContract
                .connect(eaServiceAccount)
                .functions[
                    "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                ](
                    borrower.address,
                    toToken(1_000_000),
                    60,
                    1,
                    0,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    toToken(2_500_000)
                );
            creditInfo = await getCreditInfo(poolContract, borrower.address);
            expect(creditInfo.creditLimit).to.equal(toToken(1_000_000));
            expect(creditInfo.unbilledPrincipal).to.equal(0);
            expect(creditInfo.remainingPeriods).to.equal(1);

            receivableInfo = await poolContract.receivableInfoMapping(borrower.address);
            expect(receivableInfo.receivableAsset).to.equal(invoiceNFTContract.address);
            expect(receivableInfo.receivableParam).to.equal(invoiceNFTTokenId);
            expect(receivableInfo.receivableAmount).to.equal(toToken(2_500_000));
        });
    });

    describe("Update Approved Invoice Factoring", function () {
        beforeEach(async function () {
            await poolContract
                .connect(eaServiceAccount)
                .functions[
                    "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                ](
                    borrower.address,
                    toToken(800_000),
                    30,
                    1,
                    0,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    toToken(1_500_000)
                );
        });
        it("Should prevent non-EA-borrower to change the limit for an approved invoice factoring record", async function () {
            await expect(
                poolContract.connect(payer).changeCreditLine(borrower.address, 0)
            ).to.be.revertedWithCustomError(poolContract, "onlyBorrowerOrEACanReduceCreditLine");
        });
        it("Should allow borrower to reduce the limit for an approved invoice factoring record", async function () {
            await poolContract.connect(borrower).changeCreditLine(borrower.address, toToken(1000));

            const creditInfo = await getCreditInfo(poolContract, borrower.address);
            expect(creditInfo.creditLimit).to.equal(toToken(1000));

            // await poolContract.connect(borrower).changeCreditLine(borrower.address, 0);
            // expect(creditInfo.creditLimit).to.equal(0); // Means "Deleted"
            // expect(creditInfo.state).to.equal(0); // Means "Deleted"
        });
        it("Should disallow borrower to increase the limit for an approved invoice factoring record", async function () {
            await expect(
                poolContract
                    .connect(borrower)
                    .changeCreditLine(borrower.address, toToken(1_000_000))
            ).to.be.revertedWithCustomError(poolContract, "evaluationAgentServiceAccountRequired");
        });
        it("Should allow evaluation agent to increase an approved invoice factoring record", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .changeCreditLine(borrower.address, toToken(1_000_000));

            //await poolContract.printDetailStatus(borrower.address);
            const creditInfo = await getCreditInfo(poolContract, borrower.address);

            expect(creditInfo.creditLimit).to.equal(toToken(1_000_000));
        });
        it("Should allow evaluation agent to decrease an approved invoice factoring record", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .changeCreditLine(borrower.address, toToken(1000));
            let creditInfo = await getCreditInfo(poolContract, borrower.address);
            expect(creditInfo.creditLimit).to.equal(toToken(1000));

            await poolContract.connect(eaServiceAccount).changeCreditLine(borrower.address, 0);
            creditInfo = await getCreditInfo(poolContract, borrower.address);
            expect(creditInfo.creditLimit).to.equal(0);
            expect(creditInfo.state).to.equal(0);
        });
    });

    describe("Invoice Factoring Funding", function () {
        beforeEach(async function () {
            // Mint InvoiceNFT to the borrower
            const tx = await invoiceNFTContract.mintNFT(borrower.address, "");
            const receipt = await tx.wait();
            // eslint-disable-next-line no-restricted-syntax
            for (const evt of receipt.events) {
                if (evt.event === "NFTGenerated") {
                    invoiceNFTTokenId = evt.args.tokenId;
                }
            }

            await invoiceNFTContract
                .connect(borrower)
                .approve(poolContract.address, invoiceNFTTokenId);

            await poolContract
                .connect(eaServiceAccount)
                .functions[
                    "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                ](
                    borrower.address,
                    toToken(1_000_000),
                    30,
                    1,
                    0,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    toToken(1_500_0000)
                );
            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                record,
                recordStatic,
                toToken(1_000_000),
                0,
                0,
                0,
                0,
                0,
                0,
                1,
                0,
                30,
                2,
                0
            );
        });

        it("Should not allow calling to drawdown()", async function () {
            await humaConfigContract.connect(poolOwner).pause();
            await expect(
                poolContract.connect(borrower).drawdown(toToken(1_000_000))
            ).to.be.revertedWithCustomError(
                poolContract,
                "drawdownFunctionUsedInsteadofDrawdownWithReceivable"
            );
        });

        it("Should not allow loan funding while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pause();
            await expect(
                poolContract
                    .connect(borrower)
                    .drawdownWithReceivable(
                        toToken(1_000_000),
                        invoiceNFTContract.address,
                        invoiceNFTTokenId
                    )
            ).to.be.revertedWithCustomError(poolContract, "protocolIsPaused");
        });

        it("Shall reject drawdown without receivable", async function () {
            await expect(
                poolContract
                    .connect(borrower)
                    .drawdownWithReceivable(
                        toToken(1_000_000),
                        ethers.constants.AddressZero,
                        invoiceNFTTokenId
                    )
            ).to.be.revertedWithCustomError(poolContract, "zeroAddressProvided");
        });

        it("Shall reject drawdown when receivable param mismatches", async function () {
            await expect(
                poolContract
                    .connect(borrower)
                    .drawdownWithReceivable(toToken(1_000_000), invoiceNFTContract.address, 12345)
            ).to.be.revertedWithCustomError(poolContract, "receivableAssetParamMismatch");
        });

        it("Should be able to borrow amount less than approved", async function () {
            await expect(
                poolContract
                    .connect(borrower)
                    .drawdownWithReceivable(
                        toToken(200_000),
                        invoiceNFTContract.address,
                        invoiceNFTTokenId
                    )
            )
                .to.emit(poolContract, "DrawdownMadeWithReceivable")
                .withArgs(
                    borrower.address,
                    toToken(200_000),
                    toToken(197_000),
                    invoiceNFTContract.address,
                    invoiceNFTTokenId
                );
            let blockBefore = await ethers.provider.getBlock();
            dueDate = blockBefore.timestamp + 2592000;

            expect(await invoiceNFTContract.ownerOf(invoiceNFTTokenId)).to.equal(
                poolContract.address
            );

            let accruedIncome = await poolConfigContract.accruedIncome();
            checkArruedIncome(accruedIncome, toToken(600), toToken(450), toToken(150));

            expect(await poolContract.totalPoolValue()).to.equal(toToken(5_001_800));
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                toToken(4_803_000)
            );

            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toToken(1_000_000),
                0,
                dueDate,
                0,
                toToken(200_000),
                0,
                0,
                0,
                0,
                30,
                3,
                0
            );

            let dueInfo = await feeManagerContract.getDueInfo(r, rs);
            checkResult(dueInfo, 0, 0, toToken(200_000), 0, 0);

            // Only one borrowing is allowed for each invoice
            await expect(
                poolContract
                    .connect(borrower)
                    .drawdownWithReceivable(
                        toToken(200_000),
                        invoiceNFTContract.address,
                        invoiceNFTTokenId
                    )
            ).to.revertedWithCustomError(poolContract, "creditLineNotInApprovedState");
        });

        it("Should be able to borrow the full approved amount", async function () {
            await poolContract
                .connect(borrower)
                .drawdownWithReceivable(
                    toToken(1_000_000),
                    invoiceNFTContract.address,
                    invoiceNFTTokenId
                );

            let blockBefore = await ethers.provider.getBlock();
            dueDate = blockBefore.timestamp + 2592000;

            // Keccack hash is properly computed
            expect(
                await poolContract.receivableOwnershipMapping(
                    ethers.utils.keccak256(
                        ethers.utils.defaultAbiCoder.encode(
                            ["address", "uint256"],
                            [invoiceNFTContract.address, invoiceNFTTokenId]
                        )
                    )
                )
            ).to.equal(borrower.address);

            expect(await invoiceNFTContract.ownerOf(invoiceNFTTokenId)).to.equal(
                poolContract.address
            );

            let accruedIncome = await poolConfigContract.accruedIncome();
            checkArruedIncome(accruedIncome, toToken(2200), toToken(1650), toToken(550));

            expect(await poolContract.totalPoolValue()).to.equal(toToken(5_006_600));
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                toToken(4_011_000)
            );

            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toToken(1_000_000),
                0,
                dueDate,
                0,
                toToken(1_000_000),
                0,
                0,
                0,
                0,
                30,
                3,
                0
            );

            let dueInfo = await feeManagerContract.getDueInfo(r, rs);
            checkResult(dueInfo, 0, 0, toToken(1_000_000), 0, 0);
        });
    });

    describe("Invoice Factoring Funding with ERC20 as receivables", function () {
        beforeEach(async function () {
            await testTokenContract.connect(borrower).mint(borrower.address, toToken(10_000));
            await testTokenContract
                .connect(borrower)
                .approve(poolContract.address, toToken(10_000));

            await poolContract
                .connect(eaServiceAccount)
                .functions[
                    "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                ](
                    borrower.address,
                    toToken(1_000_000),
                    30,
                    1,
                    0,
                    testTokenContract.address,
                    toToken(10_000),
                    toToken(10_000)
                );
            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                record,
                recordStatic,
                toToken(1_000_000),
                0,
                0,
                0,
                0,
                0,
                0,
                1,
                0,
                30,
                2,
                0
            );
        });

        it("Should reject since the receivable amount is less than approved", async function () {
            await expect(
                poolContract
                    .connect(borrower)
                    .drawdownWithReceivable(200_000, testTokenContract.address, toToken(5_000))
            ).to.be.revertedWithCustomError(poolContract, "insufficientReceivableAmount");
        });

        it("Should reject since the receivable is either IERC721 or IERC20", async function () {
            await expect(
                poolContract
                    .connect(borrower)
                    .drawdownWithReceivable(200_000, hdtContract.address, toToken(5_000))
            ).to.be.revertedWithCustomError(poolContract, "receivableAssetMismatch");
        });

        it("Should be able to borrow amount less than approved", async function () {
            await expect(
                poolContract
                    .connect(borrower)
                    .drawdownWithReceivable(
                        toToken(200_000),
                        testTokenContract.address,
                        toToken(10_000)
                    )
            )
                .to.emit(poolContract, "DrawdownMadeWithReceivable")
                .withArgs(
                    borrower.address,
                    toToken(200_000),
                    toToken(197_000),
                    testTokenContract.address,
                    toToken(10_000)
                );

            let blockBefore = await ethers.provider.getBlock();
            dueDate = blockBefore.timestamp + 2592000;

            let accruedIncome = await poolConfigContract.accruedIncome();
            checkArruedIncome(accruedIncome, toToken(600), toToken(450), toToken(150));

            expect(await poolContract.totalPoolValue()).to.equal(toToken(5_001_800));
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                toToken(4_813_000)
            );

            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toToken(1_000_000),
                0,
                dueDate,
                0,
                toToken(200_000),
                0,
                0,
                0,
                0,
                30,
                3,
                0
            );

            let dueInfo = await feeManagerContract.getDueInfo(r, rs);
            checkResult(dueInfo, 0, 0, toToken(200_000), 0, 0);
        });
    });

    // In "Payback".beforeEach(), make sure there is a loan funded.
    describe("Payback", async function () {
        beforeEach(async function () {
            await feeManagerContract
                .connect(poolOwner)
                .setFees(toToken(1000), 100, toToken(2000), 100, 0);
            await poolConfigContract.connect(poolOwner).setAPR(0);

            // Mint InvoiceNFT to the borrower
            const tx = await invoiceNFTContract.mintNFT(borrower.address, "");
            const receipt = await tx.wait();
            // eslint-disable-next-line no-restricted-syntax
            for (const evt of receipt.events) {
                if (evt.event === "NFTGenerated") {
                    invoiceNFTTokenId = evt.args.tokenId;
                }
            }
            await invoiceNFTContract
                .connect(borrower)
                .approve(poolContract.address, invoiceNFTTokenId);

            await poolContract
                .connect(eaServiceAccount)
                .functions[
                    "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                ](
                    borrower.address,
                    toToken(1_000_000),
                    30,
                    1,
                    0,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    toToken(1_500_000)
                );

            await poolContract
                .connect(borrower)
                .drawdownWithReceivable(
                    toToken(1_000_000),
                    invoiceNFTContract.address,
                    invoiceNFTTokenId
                );
            let blockBefore = await ethers.provider.getBlock();
            dueDate = blockBefore.timestamp + 2592000;
        });

        it("Should not allow payback while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pause();

            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, toToken(5))
            ).to.be.revertedWithCustomError(poolContract, "protocolIsPaused");
        });

        it("Should reject payback when pool is off", async function () {
            await poolContract.connect(poolOwner).disablePool();

            await expect(
                poolContract
                    .connect(pdsServiceAccount)
                    .onReceivedPayment(
                        borrower.address,
                        toToken(1_500_000),
                        ethers.utils.formatBytes32String("1")
                    )
            ).to.be.revertedWithCustomError(poolContract, "poolIsNotOn");
        });

        it("Should reject if non-PDS calls to report payments received", async function () {
            await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600 - 10]);
            await expect(
                poolContract
                    .connect(borrower)
                    .onReceivedPayment(
                        borrower.address,
                        toToken(1_500_000),
                        ethers.utils.formatBytes32String("1")
                    )
            ).to.be.revertedWithCustomError(
                poolContract,
                "paymentDetectionServiceAccountRequired"
            );
        });

        it("Process payback", async function () {
            let borrowerBalance = await testTokenContract.balanceOf(borrower.address);
            await testTokenContract.burn(borrower.address, borrowerBalance.sub(toToken(890000)));
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(toToken(890000));
            await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600 - 10]);

            // simulates payments from payer.
            await testTokenContract
                .connect(payer)
                .transfer(poolContract.address, toToken(1_500_000));

            await poolContract
                .connect(pdsServiceAccount)
                .onReceivedPayment(
                    borrower.address,
                    toToken(1_500_000),
                    ethers.utils.formatBytes32String("1")
                );

            expect(
                await poolContract.isPaymentProcessed(ethers.utils.formatBytes32String("1"))
            ).to.equal(true);

            await expect(
                poolContract
                    .connect(pdsServiceAccount)
                    .onReceivedPayment(
                        borrower.address,
                        toToken(1_500_000),
                        ethers.utils.formatBytes32String("1")
                    )
            ).to.be.revertedWithCustomError(poolContract, "paymentAlreadyProcessed");

            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(
                toToken(1_390_000)
            );

            let accruedIncome = await poolConfigContract.accruedIncome();
            checkArruedIncome(accruedIncome, toToken(2200), toToken(1650), toToken(550));

            expect(await poolContract.totalPoolValue()).to.equal(toToken(5_006_600));
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                toToken(5_011_000)
            );

            expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                toToken(1_001_320)
            );
            expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                toToken(2_002_640)
            );

            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, toToken(1_000_000), 0, dueDate, 0, 0, 0, 0, 0, 0, 30, 0, 0);

            let dueInfo = await feeManagerContract.getDueInfo(r, rs);
            checkResult(dueInfo, 0, 0, 0, 0, 0);

            let receivableInfo = await poolContract.receivableInfoMapping(borrower.address);
            expect(receivableInfo.receivableAsset).to.equal(ethers.constants.AddressZero);
            expect(receivableInfo.receivableAmount).to.equal(0);
            expect(receivableInfo.receivableParam).to.equal(0);
        });

        it("Invalidate payback", async function () {
            let borrowerBalance = await testTokenContract.balanceOf(borrower.address);
            await testTokenContract.burn(borrower.address, borrowerBalance.sub(toToken(890000)));
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(toToken(890000));
            await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600 - 10]);

            // simulates payments from payer.
            await testTokenContract
                .connect(payer)
                .transfer(poolContract.address, toToken(1_500_000));

            await poolContract
                .connect(pdsServiceAccount)
                .markPaymentInvalid(ethers.utils.formatBytes32String("1"));

            await expect(
                poolContract
                    .connect(pdsServiceAccount)
                    .onReceivedPayment(
                        borrower.address,
                        toToken(1_500_000),
                        ethers.utils.formatBytes32String("1")
                    )
            ).to.be.revertedWithCustomError(poolContract, "paymentAlreadyProcessed");
        });

        describe("Default flow", async function () {
            it("Writeoff less than pool value", async function () {
                await expect(
                    poolContract.triggerDefault(borrower.address)
                ).to.be.revertedWithCustomError(poolContract, "defaultTriggeredTooEarly");
                // post withdraw
                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    toToken(1_001_320)
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    toToken(2_002_640)
                );

                let accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(toToken(2200));
                expect(accruedIncome.eaIncome).to.equal(toToken(1650));
                expect(accruedIncome.poolOwnerIncome).to.equal(toToken(550));

                // pay period 1
                await advanceClock(30);
                await ethers.provider.send("evm_mine", []);
                await poolContract.refreshAccount(borrower.address);

                await expect(
                    poolContract.triggerDefault(borrower.address)
                ).to.be.revertedWithCustomError(poolContract, "defaultTriggeredTooEarly");
                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    toToken(1_002_760)
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    toToken(2_005_520)
                );

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(toToken(4600));
                expect(accruedIncome.eaIncome).to.equal(toToken(3450));
                expect(accruedIncome.poolOwnerIncome).to.equal(toToken(1150));

                // pay period 2
                await advanceClock(30);
                await poolContract.refreshAccount(borrower.address);

                await expect(
                    poolContract.triggerDefault(borrower.address)
                ).to.be.revertedWithCustomError(poolContract, "defaultTriggeredTooEarly");
                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    1004214400000
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    2008428800000
                );

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(toToken(7024));
                expect(accruedIncome.eaIncome).to.equal(toToken(5268));
                expect(accruedIncome.poolOwnerIncome).to.equal(toToken(1756));

                // Pay period 3
                await advanceClock(30);

                await expect(
                    poolContract.connect(eaServiceAccount).triggerDefault(borrower.address)
                )
                    .to.emit(poolContract, "DefaultTriggered")
                    .withArgs(borrower.address, toToken(1_024_120), eaServiceAccount.address);

                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    799390400000
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    1598780800000
                );

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(toToken(7024));
                expect(accruedIncome.eaIncome).to.equal(toToken(5268));
                expect(accruedIncome.poolOwnerIncome).to.equal(toToken(1756));

                expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                    toToken(4_011_000)
                );
            });

            it("Multiple partial payments after default", async function () {
                await expect(
                    poolContract.triggerDefault(borrower.address)
                ).to.be.revertedWithCustomError(poolContract, "defaultTriggeredTooEarly");

                await advanceClock(30);
                await advanceClock(30);
                await expect(
                    poolContract.triggerDefault(borrower.address)
                ).to.be.revertedWithCustomError(poolContract, "defaultTriggeredTooEarly");

                await advanceClock(30);

                await expect(
                    poolContract.connect(eaServiceAccount).triggerDefault(borrower.address)
                )
                    .to.emit(poolContract, "DefaultTriggered")
                    .withArgs(borrower.address, toToken(1_024_120), eaServiceAccount.address);

                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    799390400000
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    1598780800000
                );

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(toToken(7024));
                expect(accruedIncome.eaIncome).to.equal(toToken(5268));
                expect(accruedIncome.poolOwnerIncome).to.equal(toToken(1756));

                expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                    toToken(4_011_000)
                );

                // simulates partial payback
                await advanceClock(10);
                await testTokenContract
                    .connect(payer)
                    .transfer(poolContract.address, toToken(1_000_000));

                await poolContract
                    .connect(pdsServiceAccount)
                    .onReceivedPayment(
                        borrower.address,
                        toToken(1_000_000),
                        ethers.utils.formatBytes32String("1")
                    );

                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    999390400000
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    1998780800000
                );

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(toToken(7024));
                expect(accruedIncome.eaIncome).to.equal(toToken(5268));
                expect(accruedIncome.poolOwnerIncome).to.equal(toToken(1756));

                expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                    toToken(5_011_000)
                );

                await advanceClock(10);
                await testTokenContract
                    .connect(payer)
                    .transfer(poolContract.address, 36_361_200000);

                await poolContract
                    .connect(pdsServiceAccount)
                    .onReceivedPayment(
                        borrower.address,
                        36_361_200000,
                        ethers.utils.formatBytes32String("2")
                    );

                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    1005683344000
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    2011366688000
                );

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(9472240000);
                expect(accruedIncome.eaIncome).to.equal(7104180000);
                expect(accruedIncome.poolOwnerIncome).to.equal(2368060000);

                expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                    5047361200000
                );
            });
        });
    });
    // In "Payback".beforeEach(), make sure there is a loan funded.
    describe("Manual Review", async function () {
        beforeEach(async function () {
            await feeManagerContract
                .connect(poolOwner)
                .setFees(toToken(1000), 100, toToken(2000), 100, 0);
            await poolConfigContract.connect(poolOwner).setAPR(0);

            // Mint InvoiceNFT to the borrower
            const tx = await invoiceNFTContract.mintNFT(borrower.address, "");
            const receipt = await tx.wait();
            // eslint-disable-next-line no-restricted-syntax
            for (const evt of receipt.events) {
                if (evt.event === "NFTGenerated") {
                    invoiceNFTTokenId = evt.args.tokenId;
                }
            }
            await invoiceNFTContract
                .connect(borrower)
                .approve(poolContract.address, invoiceNFTTokenId);

            await poolContract
                .connect(eaServiceAccount)
                .functions[
                    "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                ](
                    borrower.address,
                    toToken(1_000_000),
                    30,
                    1,
                    0,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    toToken(1_500_000)
                );

            await poolContract
                .connect(borrower)
                .drawdownWithReceivable(
                    toToken(1_000_000),
                    invoiceNFTContract.address,
                    invoiceNFTTokenId
                );
            let blockBefore = await ethers.provider.getBlock();
            dueDate = blockBefore.timestamp + 2592000;
        });

        it("Invalidate payment after review", async function () {
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toToken(1_000_000),
                0,
                dueDate,
                0,
                toToken(1_000_000),
                0,
                0,
                0,
                0,
                30,
                3,
                0
            );

            let borrowerBalance = await testTokenContract.balanceOf(borrower.address);
            let poolValue = await poolContract.totalPoolValue();
            let poolLiquidity = await testTokenContract.balanceOf(poolContract.address);

            let paymentId = ethers.utils.formatBytes32String("1");
            await expect(
                poolContract
                    .connect(pdsServiceAccount)
                    .onReceivedPayment(borrower.address, toToken(15_000_000), paymentId)
            )
                .to.emit(poolContract, "PaymentFlaggedForReview")
                .withArgs(paymentId, borrower.address, toToken(15_000_000));

            expect(await poolContract.isPaymentProcessed(paymentId)).to.equal(false);
            expect(await poolContract.isPaymentUnderReview(paymentId)).to.equal(true);
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toToken(1_000_000),
                0,
                dueDate,
                0,
                toToken(1_000_000),
                0,
                0,
                0,
                0,
                30,
                3,
                0
            );
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(borrowerBalance);
            expect(await poolContract.totalPoolValue()).to.equal(poolValue);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                poolLiquidity
            );

            // After review, inactivate the paymentId
            await expect(
                poolContract.connect(poolOperator).processPaymentAfterReview(paymentId, false)
            ).to.be.revertedWithCustomError(poolConfigContract, "notPoolOwner");

            await expect(
                poolContract.connect(poolOwner).processPaymentAfterReview(paymentId, false)
            )
                .to.emit(poolContract, "PaymentInvalidated")
                .withArgs(paymentId);
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(borrowerBalance);
            expect(await poolContract.totalPoolValue()).to.equal(poolValue);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                poolLiquidity
            );
        });
        it("Proceed with payment after review", async function () {
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toToken(1_000_000),
                0,
                dueDate,
                0,
                toToken(1_000_000),
                0,
                0,
                0,
                0,
                30,
                3,
                0
            );

            let borrowerBalance = await testTokenContract.balanceOf(borrower.address);
            let poolValue = await poolContract.totalPoolValue();
            let poolLiquidity = await testTokenContract.balanceOf(poolContract.address);

            let paymentId = ethers.utils.formatBytes32String("2");
            await expect(
                poolContract
                    .connect(pdsServiceAccount)
                    .onReceivedPayment(borrower.address, toToken(15_000_000), paymentId)
            )
                .to.emit(poolContract, "PaymentFlaggedForReview")
                .withArgs(paymentId, borrower.address, toToken(15_000_000));

            expect(await poolContract.isPaymentProcessed(paymentId)).to.equal(false);
            expect(await poolContract.isPaymentUnderReview(paymentId)).to.equal(true);
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toToken(1_000_000),
                0,
                dueDate,
                0,
                toToken(1_000_000),
                0,
                0,
                0,
                0,
                30,
                3,
                0
            );
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(borrowerBalance);
            expect(await poolContract.totalPoolValue()).to.equal(poolValue);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                poolLiquidity
            );

            await testTokenContract.mint(poolContract.address, toToken(15_000_000));

            let invalidPaymentId = ethers.utils.formatBytes32String("1");
            await expect(
                poolContract.connect(poolOwner).processPaymentAfterReview(invalidPaymentId, true)
            ).to.be.revertedWithCustomError(poolContract, "paymentIdNotUnderReview");

            await expect(
                poolContract.connect(poolOwner).processPaymentAfterReview(paymentId, true)
            )
                .to.emit(poolContract, "ExtraFundsDispersed")
                .withArgs(borrower.address, toToken(14_000_000))
                .to.emit(poolContract, "ReceivedPaymentProcessed")
                .withArgs(poolOwner.address, borrower.address, toToken(15_000_000), paymentId);

            expect(await poolContract.isPaymentProcessed(paymentId)).to.equal(true);
            expect(await poolContract.isPaymentUnderReview(paymentId)).to.equal(false);
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, toToken(1_000_000), 0, dueDate, 0, 0, 0, 0, 0, 0, 30, 0, 0);
            borrowerBalance = borrowerBalance.add(toToken(14000000));
            poolLiquidity = poolLiquidity.add(toToken(1000000));
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(borrowerBalance);
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(borrowerBalance);
            expect(await poolContract.totalPoolValue()).to.equal(poolValue);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                poolLiquidity
            );
        });
        it("Additional payments received after payoff", async function () {
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toToken(1_000_000),
                0,
                dueDate,
                0,
                toToken(1_000_000),
                0,
                0,
                0,
                0,
                30,
                3,
                0
            );

            let borrowerBalance = await testTokenContract.balanceOf(borrower.address);
            let poolValue = await poolContract.totalPoolValue();
            let poolLiquidity = await testTokenContract.balanceOf(poolContract.address);

            await testTokenContract.mint(poolContract.address, toToken(1_500_000));

            let paymentId = ethers.utils.formatBytes32String("3");
            await expect(
                poolContract
                    .connect(pdsServiceAccount)
                    .onReceivedPayment(borrower.address, toToken(1_500_000), paymentId)
            )
                .to.emit(poolContract, "ExtraFundsDispersed")
                .withArgs(borrower.address, toToken(500_000))
                .to.emit(poolContract, "ReceivedPaymentProcessed")
                .withArgs(
                    pdsServiceAccount.address,
                    borrower.address,
                    toToken(1_500_000),
                    paymentId
                );

            expect(await poolContract.isPaymentProcessed(paymentId)).to.equal(true);
            expect(await poolContract.isPaymentUnderReview(paymentId)).to.equal(false);
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, toToken(1_000_000), 0, dueDate, 0, 0, 0, 0, 0, 0, 30, 0, 0);
            borrowerBalance = borrowerBalance.add(toToken(500000));
            poolLiquidity = poolLiquidity.add(toToken(1000000));
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(borrowerBalance);
            expect(await poolContract.totalPoolValue()).to.equal(poolValue);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                poolLiquidity
            );

            paymentId = ethers.utils.formatBytes32String("4");
            await expect(
                poolContract
                    .connect(pdsServiceAccount)
                    .onReceivedPayment(borrower.address, toToken(2_000_000), paymentId)
            )
                .to.emit(poolContract, "PaymentFlaggedForReview")
                .withArgs(paymentId, borrower.address, toToken(2_000_000));

            expect(await poolContract.isPaymentProcessed(paymentId)).to.equal(false);
            expect(await poolContract.isPaymentUnderReview(paymentId)).to.equal(true);
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, toToken(1_000_000), 0, dueDate, 0, 0, 0, 0, 0, 0, 30, 0, 0);

            await testTokenContract.mint(poolContract.address, toToken(2_000_000));

            await expect(
                poolContract.connect(poolOwner).processPaymentAfterReview(paymentId, true)
            )
                .to.emit(poolContract, "ExtraFundsDispersed")
                .withArgs(borrower.address, toToken(2_000_000))
                .to.emit(poolContract, "ReceivedPaymentProcessed")
                .withArgs(poolOwner.address, borrower.address, toToken(2_000_000), paymentId);

            expect(await poolContract.isPaymentProcessed(paymentId)).to.equal(true);
            expect(await poolContract.isPaymentUnderReview(paymentId)).to.equal(false);
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, toToken(1_000_000), 0, dueDate, 0, 0, 0, 0, 0, 0, 30, 0, 0);
            borrowerBalance = borrowerBalance.add(toToken(2000000));
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(borrowerBalance);
            expect(await poolContract.totalPoolValue()).to.equal(poolValue);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                poolLiquidity
            );
        });
        it("Proceed with middle payment (amount > REVIEW_MULTIPLIER * payoffAmount && amount < REVIEW_MULTIPLIER * creditLine)", async function () {
            await poolConfigContract.connect(poolOwner).setMaxCreditLine(toToken(10_000_000));
            await poolContract
                .connect(eaServiceAccount)
                .changeCreditLine(borrower.address, toToken(10_000_000));

            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toToken(10_000_000),
                0,
                dueDate,
                0,
                toToken(1_000_000),
                0,
                0,
                0,
                0,
                30,
                3,
                0
            );

            let borrowerBalance = await testTokenContract.balanceOf(borrower.address);
            let poolValue = await poolContract.totalPoolValue();
            let poolLiquidity = await testTokenContract.balanceOf(poolContract.address);

            await testTokenContract.mint(poolContract.address, toToken(8_000_000));

            let paymentId = ethers.utils.formatBytes32String("5");
            await expect(
                poolContract
                    .connect(pdsServiceAccount)
                    .onReceivedPayment(borrower.address, toToken(8_000_000), paymentId)
            )
                .to.emit(poolContract, "ExtraFundsDispersed")
                .withArgs(borrower.address, toToken(7_000_000))
                .to.emit(poolContract, "ReceivedPaymentProcessed")
                .withArgs(
                    pdsServiceAccount.address,
                    borrower.address,
                    toToken(8_000_000),
                    paymentId
                );

            expect(await poolContract.isPaymentProcessed(paymentId)).to.equal(true);
            expect(await poolContract.isPaymentUnderReview(paymentId)).to.equal(false);
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, toToken(10_000_000), 0, dueDate, 0, 0, 0, 0, 0, 0, 30, 0, 0);
            borrowerBalance = borrowerBalance.add(toToken(7000000));
            poolLiquidity = poolLiquidity.add(toToken(1000000));
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(borrowerBalance);
            expect(await poolContract.totalPoolValue()).to.equal(poolValue);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                poolLiquidity
            );
        });
    });
});
