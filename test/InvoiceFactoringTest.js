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
    toTKN,
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

        await testTokenContract.mint(payer.address, toTKN(10_000_000));
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
            true,
            poolOperator,
            poolOwnerTreasury
        );

        await poolConfigContract.connect(poolOwner).setWithdrawalLockoutPeriod(90);
        await poolConfigContract.connect(poolOwner).setPoolDefaultGracePeriod(60);
        await feeManagerContract.connect(poolOwner).setFees(toTKN(1000), 100, toTKN(2000), 100, 0);
        await poolConfigContract.connect(poolOwner).setAPR(0);
        await poolConfigContract.connect(poolOwner).setMaxCreditLine(toTKN(1_000_000));
        await humaConfigContract.connect(protocolOwner).setTreasuryFee(2000);
        await poolConfigContract.connect(poolOwner).setPoolOwnerRewardsAndLiquidity(625, 0);
        await poolConfigContract.connect(poolOwner).setEARewardsAndLiquidity(1875, 0);
        await poolConfigContract.connect(poolOwner).setReceivableRequiredInBps(100);
    });

    describe("Post Approved Invoice Factoring", function () {
        beforeEach(async function () {
            await testTokenContract.connect(borrower).approve(poolContract.address, 1_000_000);
        });

        afterEach(async function () {
            if (await humaConfigContract.connect(protocolOwner).paused())
                await humaConfigContract.connect(protocolOwner).unpause();
        });

        it("Should only allow evaluation agents to post approved loan requests", async function () {
            await expect(
                poolContract
                    .connect(lender)
                    .functions[
                        "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                    ](
                        borrower.address,
                        toTKN(1_000_000),
                        30,
                        1,
                        0,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        toTKN(1_500_000)
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
                        toTKN(1_000_000),
                        30,
                        1,
                        0,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        toTKN(1_500_000)
                    )
            ).to.be.revertedWith("protocolIsPaused()");
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
                        toTKN(1_000_000),
                        30,
                        1,
                        0,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        toTKN(1_500_000)
                    )
            ).to.be.revertedWith("poolIsNotOn()");
        });

        it("Cannot post approved loan with amount greater than limit", async function () {
            await expect(
                poolContract
                    .connect(eaServiceAccount)
                    .functions[
                        "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                    ](
                        borrower.address,
                        toTKN(1_200_000),
                        30,
                        1,
                        0,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        toTKN(1_500_000)
                    )
            ).to.be.revertedWith("greaterThanMaxCreditLine()");
        });

        it("Should reject zero address receivable", async function () {
            await expect(
                poolContract
                    .connect(eaServiceAccount)
                    .functions[
                        "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                    ](
                        borrower.address,
                        toTKN(1_000_000),
                        30,
                        1,
                        0,
                        ethers.constants.AddressZero,
                        invoiceNFTTokenId,
                        toTKN(1_500_000)
                    )
            ).to.be.revertedWith("zeroAddressProvided()");
        });

        it("Should reject non-ERC20-or-ERC721", async function () {
            await expect(
                poolContract
                    .connect(eaServiceAccount)
                    .functions[
                        "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                    ](
                        borrower.address,
                        toTKN(1_000_000),
                        30,
                        1,
                        0,
                        feeManagerContract.address,
                        invoiceNFTTokenId,
                        toTKN(1_500_000)
                    )
            ).to.be.revertedWith("unsupportedReceivableAsset()");
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
                    toTKN(1_000_000),
                    30,
                    1,
                    1000,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    toTKN(1_500_000)
                );

            const creditInfo = await getCreditInfo(poolContract, borrower.address);

            expect(creditInfo.creditLimit).to.equal(toTKN(1_000_000));
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
                        toTKN(1_000_000),
                        30,
                        1,
                        0,
                        invoiceNFTContract.address,
                        invoiceNFTTokenId,
                        toTKN(1_000_000)
                    )
            ).to.be.revertedWith("insufficientReceivableAmount()");
        });

        it("Should approve invoice with amount equals to or high than the receivable requirement", async function () {
            await poolConfigContract.connect(poolOwner).setReceivableRequiredInBps(12500);

            await poolContract
                .connect(eaServiceAccount)
                .functions[
                    "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                ](
                    borrower.address,
                    toTKN(1_000_000),
                    30,
                    1,
                    0,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    toTKN(1_500_000)
                );

            const creditInfo = await getCreditInfo(poolContract, borrower.address);

            expect(creditInfo.creditLimit).to.equal(toTKN(1_000_000));
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
                    toTKN(1_000_000),
                    30,
                    1,
                    0,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    toTKN(1_500_000)
                );

            let creditInfo = await getCreditInfo(poolContract, borrower.address);

            expect(creditInfo.creditLimit).to.equal(toTKN(1_000_000));
            expect(creditInfo.unbilledPrincipal).to.equal(0);
            expect(creditInfo.remainingPeriods).to.equal(1);

            let receivableInfo = await poolContract.receivableInfoMapping(borrower.address);
            expect(receivableInfo.receivableAmount).to.equal(toTKN(1_500_000));
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
                    toTKN(1_000_000),
                    60,
                    1,
                    0,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    toTKN(2_500_000)
                );
            creditInfo = await getCreditInfo(poolContract, borrower.address);
            expect(creditInfo.creditLimit).to.equal(toTKN(1_000_000));
            expect(creditInfo.unbilledPrincipal).to.equal(0);
            expect(creditInfo.remainingPeriods).to.equal(1);

            receivableInfo = await poolContract.receivableInfoMapping(borrower.address);
            expect(receivableInfo.receivableAsset).to.equal(invoiceNFTContract.address);
            expect(receivableInfo.receivableParam).to.equal(invoiceNFTTokenId);
            expect(receivableInfo.receivableAmount).to.equal(toTKN(2_500_000));
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
                    toTKN(800_000),
                    30,
                    1,
                    0,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    toTKN(1_500_000)
                );
        });
        it("Should prevent non-EA-borrower to change the limit for an approved invoice factoring record", async function () {
            await expect(
                poolContract.connect(payer).changeCreditLine(borrower.address, 0)
            ).to.be.revertedWith("onlyBorrowerOrEACanReduceCreditLine()");
        });
        it("Should allow borrower to reduce the limit for an approved invoice factoring record", async function () {
            await poolContract.connect(borrower).changeCreditLine(borrower.address, toTKN(1000));

            const creditInfo = await getCreditInfo(poolContract, borrower.address);
            expect(creditInfo.creditLimit).to.equal(toTKN(1000));

            // await poolContract.connect(borrower).changeCreditLine(borrower.address, 0);
            // expect(creditInfo.creditLimit).to.equal(0); // Means "Deleted"
            // expect(creditInfo.state).to.equal(0); // Means "Deleted"
        });
        it("Should disallow borrower to increase the limit for an approved invoice factoring record", async function () {
            await expect(
                poolContract.connect(borrower).changeCreditLine(borrower.address, toTKN(1_000_000))
            ).to.be.revertedWith("evaluationAgentServiceAccountRequired()");
        });
        it("Should allow evaluation agent to increase an approved invoice factoring record", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .changeCreditLine(borrower.address, toTKN(1_000_000));

            //await poolContract.printDetailStatus(borrower.address);
            const creditInfo = await getCreditInfo(poolContract, borrower.address);

            expect(creditInfo.creditLimit).to.equal(toTKN(1_000_000));
        });
        it("Should allow evaluation agent to decrease an approved invoice factoring record", async function () {
            await poolContract
                .connect(eaServiceAccount)
                .changeCreditLine(borrower.address, toTKN(1000));
            let creditInfo = await getCreditInfo(poolContract, borrower.address);
            expect(creditInfo.creditLimit).to.equal(toTKN(1000));

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
                    toTKN(1_000_000),
                    30,
                    1,
                    0,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    toTKN(1_500_0000)
                );
            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(record, recordStatic, toTKN(1_000_000), 0, 0, 0, 0, 0, 0, 1, 0, 30, 2, 0);
        });

        afterEach(async function () {
            if (await humaConfigContract.connect(protocolOwner).paused())
                await humaConfigContract.connect(protocolOwner).unpause();
        });

        it("Should not allow calling to drawdown()", async function () {
            await humaConfigContract.connect(poolOwner).pause();
            await expect(
                poolContract.connect(borrower).drawdown(toTKN(1_000_000))
            ).to.be.revertedWith("drawdownFunctionUsedInsteadofDrawdownWithReceivable");
        });

        it("Should not allow loan funding while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pause();
            await expect(
                poolContract
                    .connect(borrower)
                    .drawdownWithReceivable(
                        toTKN(1_000_000),
                        invoiceNFTContract.address,
                        invoiceNFTTokenId
                    )
            ).to.be.revertedWith("protocolIsPaused()");
        });

        it("Shall reject drawdown without receivable", async function () {
            await expect(
                poolContract
                    .connect(borrower)
                    .drawdownWithReceivable(
                        toTKN(1_000_000),
                        ethers.constants.AddressZero,
                        invoiceNFTTokenId
                    )
            ).to.be.revertedWith("zeroAddressProvided()");
        });

        it("Shall reject drawdown when receivable param mismatches", async function () {
            await expect(
                poolContract
                    .connect(borrower)
                    .drawdownWithReceivable(toTKN(1_000_000), invoiceNFTContract.address, 12345)
            ).to.be.revertedWith("receivableAssetParamMismatch()");
        });

        it("Should be able to borrow amount less than approved", async function () {
            await expect(
                poolContract
                    .connect(borrower)
                    .drawdownWithReceivable(
                        toTKN(200_000),
                        invoiceNFTContract.address,
                        invoiceNFTTokenId
                    )
            )
                .to.emit(poolContract, "DrawdownMadeWithReceivable")
                .withArgs(
                    borrower.address,
                    toTKN(200_000),
                    toTKN(197_000),
                    invoiceNFTContract.address,
                    invoiceNFTTokenId
                );

            expect(await invoiceNFTContract.ownerOf(invoiceNFTTokenId)).to.equal(
                poolContract.address
            );

            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);

            dueDate = blockBefore.timestamp + 2592000;

            let accruedIncome = await poolConfigContract.accruedIncome();
            checkArruedIncome(accruedIncome, toTKN(600), toTKN(450), toTKN(150));

            expect(await poolContract.totalPoolValue()).to.equal(toTKN(5_001_800));
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                toTKN(4_803_000)
            );

            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toTKN(1_000_000),
                0,
                dueDate,
                0,
                toTKN(200_000),
                0,
                0,
                0,
                0,
                30,
                3,
                0
            );

            let dueInfo = await feeManagerContract.getDueInfo(r, rs);
            checkResult(dueInfo, 0, 0, toTKN(200_000), 0, 0);

            // Only one borrowing is allowed for each invoice
            await expect(
                poolContract
                    .connect(borrower)
                    .drawdownWithReceivable(
                        toTKN(200_000),
                        invoiceNFTContract.address,
                        invoiceNFTTokenId
                    )
            ).to.revertedWith("creditLineNotInApprovedState");
        });

        it("Should be able to borrow the full approved amount", async function () {
            await poolContract
                .connect(borrower)
                .drawdownWithReceivable(
                    toTKN(1_000_000),
                    invoiceNFTContract.address,
                    invoiceNFTTokenId
                );

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

            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);

            dueDate = blockBefore.timestamp + 2592000;

            let accruedIncome = await poolConfigContract.accruedIncome();
            checkArruedIncome(accruedIncome, toTKN(2200), toTKN(1650), toTKN(550));

            expect(await poolContract.totalPoolValue()).to.equal(toTKN(5_006_600));
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                toTKN(4_011_000)
            );

            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toTKN(1_000_000),
                0,
                dueDate,
                0,
                toTKN(1_000_000),
                0,
                0,
                0,
                0,
                30,
                3,
                0
            );

            let dueInfo = await feeManagerContract.getDueInfo(r, rs);
            checkResult(dueInfo, 0, 0, toTKN(1_000_000), 0, 0);
        });
    });

    describe("Invoice Factoring Funding with ERC20 as receivables", function () {
        beforeEach(async function () {
            await testTokenContract.connect(borrower).mint(borrower.address, toTKN(10_000));
            await testTokenContract.connect(borrower).approve(poolContract.address, toTKN(10_000));

            await poolContract
                .connect(eaServiceAccount)
                .functions[
                    "approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"
                ](
                    borrower.address,
                    toTKN(1_000_000),
                    30,
                    1,
                    0,
                    testTokenContract.address,
                    toTKN(10_000),
                    toTKN(10_000)
                );
            record = await poolContract.creditRecordMapping(borrower.address);
            recordStatic = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(record, recordStatic, toTKN(1_000_000), 0, 0, 0, 0, 0, 0, 1, 0, 30, 2, 0);
        });

        afterEach(async function () {
            if (await humaConfigContract.connect(protocolOwner).paused())
                await humaConfigContract.connect(protocolOwner).unpause();
        });

        it("Should reject since the receivable amount is less than approved", async function () {
            await expect(
                poolContract
                    .connect(borrower)
                    .drawdownWithReceivable(200_000, testTokenContract.address, toTKN(5_000))
            ).to.be.revertedWith("insufficientReceivableAmount()");
        });

        it("Should reject since the receivable is either IERC721 or IERC20", async function () {
            await expect(
                poolContract
                    .connect(borrower)
                    .drawdownWithReceivable(200_000, hdtContract.address, toTKN(5_000))
            ).to.be.revertedWith("receivableAssetMismatch()");
        });

        it("Should be able to borrow amount less than approved", async function () {
            await expect(
                poolContract
                    .connect(borrower)
                    .drawdownWithReceivable(
                        toTKN(200_000),
                        testTokenContract.address,
                        toTKN(10_000)
                    )
            )
                .to.emit(poolContract, "DrawdownMadeWithReceivable")
                .withArgs(
                    borrower.address,
                    toTKN(200_000),
                    toTKN(197_000),
                    testTokenContract.address,
                    toTKN(10_000)
                );

            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);

            dueDate = blockBefore.timestamp + 2592000;

            let accruedIncome = await poolConfigContract.accruedIncome();
            checkArruedIncome(accruedIncome, toTKN(600), toTKN(450), toTKN(150));

            expect(await poolContract.totalPoolValue()).to.equal(toTKN(5_001_800));
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                toTKN(4_813_000)
            );

            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toTKN(1_000_000),
                0,
                dueDate,
                0,
                toTKN(200_000),
                0,
                0,
                0,
                0,
                30,
                3,
                0
            );

            let dueInfo = await feeManagerContract.getDueInfo(r, rs);
            checkResult(dueInfo, 0, 0, toTKN(200_000), 0, 0);
        });
    });

    // In "Payback".beforeEach(), make sure there is a loan funded.
    describe("Payback", async function () {
        beforeEach(async function () {
            await feeManagerContract
                .connect(poolOwner)
                .setFees(toTKN(1000), 100, toTKN(2000), 100, 0);
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
                    toTKN(1_000_000),
                    30,
                    1,
                    0,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    toTKN(1_500_000)
                );

            await poolContract
                .connect(borrower)
                .drawdownWithReceivable(
                    toTKN(1_000_000),
                    invoiceNFTContract.address,
                    invoiceNFTTokenId
                );
            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);

            dueDate = blockBefore.timestamp + 2592000;
        });

        afterEach(async function () {
            if (await humaConfigContract.connect(protocolOwner).paused())
                await humaConfigContract.connect(protocolOwner).unpause();
        });

        it("Should not allow payback while protocol is paused", async function () {
            await humaConfigContract.connect(poolOwner).pause();

            await expect(
                poolContract.connect(borrower).makePayment(borrower.address, toTKN(5))
            ).to.be.revertedWith("protocolIsPaused()");
        });

        it("Should reject payback when pool is off", async function () {
            await poolContract.connect(poolOwner).disablePool();

            await expect(
                poolContract
                    .connect(pdsServiceAccount)
                    .onReceivedPayment(
                        borrower.address,
                        toTKN(1_500_000),
                        ethers.utils.formatBytes32String("1")
                    )
            ).to.be.revertedWith("poolIsNotOn()");
        });

        it("Should reject if non-PDS calls to report payments received", async function () {
            await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600 - 10]);
            await expect(
                poolContract
                    .connect(borrower)
                    .onReceivedPayment(
                        borrower.address,
                        toTKN(1_500_000),
                        ethers.utils.formatBytes32String("1")
                    )
            ).to.be.revertedWith("paymentDetectionServiceAccountRequired()");
        });

        it("Process payback", async function () {
            let borrowerBalance = await testTokenContract.balanceOf(borrower.address);
            await testTokenContract.burn(borrower.address, borrowerBalance.sub(toTKN(890000)));
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(toTKN(890000));
            await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600 - 10]);

            // simulates payments from payer.
            await testTokenContract
                .connect(payer)
                .transfer(poolContract.address, toTKN(1_500_000));

            await poolContract
                .connect(pdsServiceAccount)
                .onReceivedPayment(
                    borrower.address,
                    toTKN(1_500_000),
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
                        toTKN(1_500_000),
                        ethers.utils.formatBytes32String("1")
                    )
            ).to.be.revertedWith("paymentAlreadyProcessed()");

            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(toTKN(1_390_000));

            let accruedIncome = await poolConfigContract.accruedIncome();
            checkArruedIncome(accruedIncome, toTKN(2200), toTKN(1650), toTKN(550));

            expect(await poolContract.totalPoolValue()).to.equal(toTKN(5_006_600));
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                toTKN(5_011_000)
            );

            expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                toTKN(1_001_320)
            );
            expect(await hdtContract.withdrawableFundsOf(evaluationAgent.address)).to.equal(
                toTKN(2_002_640)
            );

            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, toTKN(1_000_000), 0, dueDate, 0, 0, 0, 0, 0, 0, 30, 0, 0);

            let dueInfo = await feeManagerContract.getDueInfo(r, rs);
            checkResult(dueInfo, 0, 0, 0, 0, 0);

            let receivableInfo = await poolContract.receivableInfoMapping(borrower.address);
            expect(receivableInfo.receivableAsset).to.equal(ethers.constants.AddressZero);
            expect(receivableInfo.receivableAmount).to.equal(0);
            expect(receivableInfo.receivableParam).to.equal(0);
        });

        it("Invalidate payback", async function () {
            let borrowerBalance = await testTokenContract.balanceOf(borrower.address);
            await testTokenContract.burn(borrower.address, borrowerBalance.sub(toTKN(890000)));
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(toTKN(890000));
            await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600 - 10]);

            // simulates payments from payer.
            await testTokenContract
                .connect(payer)
                .transfer(poolContract.address, toTKN(1_500_000));

            await poolContract
                .connect(pdsServiceAccount)
                .markPaymentInvalid(ethers.utils.formatBytes32String("1"));

            await expect(
                poolContract
                    .connect(pdsServiceAccount)
                    .onReceivedPayment(
                        borrower.address,
                        toTKN(1_500_000),
                        ethers.utils.formatBytes32String("1")
                    )
            ).to.be.revertedWith("paymentAlreadyProcessed()");
        });

        describe("Default flow", async function () {
            it("Writeoff less than pool value", async function () {
                await expect(poolContract.triggerDefault(borrower.address)).to.be.revertedWith(
                    "defaultTriggeredTooEarly()"
                );
                // post withdraw
                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    toTKN(1_001_320)
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    toTKN(2_002_640)
                );

                let accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(toTKN(2200));
                expect(accruedIncome.eaIncome).to.equal(toTKN(1650));
                expect(accruedIncome.poolOwnerIncome).to.equal(toTKN(550));

                // pay period 1
                await advanceClock(30);
                await ethers.provider.send("evm_mine", []);
                await poolContract.refreshAccount(borrower.address);

                await expect(poolContract.triggerDefault(borrower.address)).to.be.revertedWith(
                    "defaultTriggeredTooEarly()"
                );
                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    toTKN(1_002_760)
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    toTKN(2_005_520)
                );

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(toTKN(4600));
                expect(accruedIncome.eaIncome).to.equal(toTKN(3450));
                expect(accruedIncome.poolOwnerIncome).to.equal(toTKN(1150));

                // pay period 2
                await advanceClock(30);
                await poolContract.refreshAccount(borrower.address);

                await expect(poolContract.triggerDefault(borrower.address)).to.be.revertedWith(
                    "defaultTriggeredTooEarly()"
                );
                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    1004214400000
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    2008428800000
                );

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(toTKN(7024));
                expect(accruedIncome.eaIncome).to.equal(toTKN(5268));
                expect(accruedIncome.poolOwnerIncome).to.equal(toTKN(1756));

                // Pay period 3
                await advanceClock(30);

                await expect(
                    poolContract.connect(eaServiceAccount).triggerDefault(borrower.address)
                )
                    .to.emit(poolContract, "DefaultTriggered")
                    .withArgs(borrower.address, toTKN(1_024_120), eaServiceAccount.address);

                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    799390400000
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    1598780800000
                );

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(toTKN(7024));
                expect(accruedIncome.eaIncome).to.equal(toTKN(5268));
                expect(accruedIncome.poolOwnerIncome).to.equal(toTKN(1756));

                expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                    toTKN(4_011_000)
                );
            });

            it("Multiple partial payments after default", async function () {
                await expect(poolContract.triggerDefault(borrower.address)).to.be.revertedWith(
                    "defaultTriggeredTooEarly()"
                );

                await advanceClock(30);
                await advanceClock(30);
                await expect(poolContract.triggerDefault(borrower.address)).to.be.revertedWith(
                    "defaultTriggeredTooEarly()"
                );

                await advanceClock(30);

                await expect(
                    poolContract.connect(eaServiceAccount).triggerDefault(borrower.address)
                )
                    .to.emit(poolContract, "DefaultTriggered")
                    .withArgs(borrower.address, toTKN(1_024_120), eaServiceAccount.address);

                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    799390400000
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    1598780800000
                );

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(toTKN(7024));
                expect(accruedIncome.eaIncome).to.equal(toTKN(5268));
                expect(accruedIncome.poolOwnerIncome).to.equal(toTKN(1756));

                expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                    toTKN(4_011_000)
                );

                // simulates partial payback
                await advanceClock(10);
                await testTokenContract
                    .connect(payer)
                    .transfer(poolContract.address, toTKN(1_000_000));

                await poolContract
                    .connect(pdsServiceAccount)
                    .onReceivedPayment(
                        borrower.address,
                        toTKN(1_000_000),
                        ethers.utils.formatBytes32String("1")
                    );

                expect(await hdtContract.withdrawableFundsOf(poolOwnerTreasury.address)).to.equal(
                    999390400000
                );
                expect(await hdtContract.withdrawableFundsOf(lender.address)).to.equal(
                    1998780800000
                );

                accruedIncome = await poolConfigContract.accruedIncome();
                expect(accruedIncome.protocolIncome).to.equal(toTKN(7024));
                expect(accruedIncome.eaIncome).to.equal(toTKN(5268));
                expect(accruedIncome.poolOwnerIncome).to.equal(toTKN(1756));

                expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                    toTKN(5_011_000)
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
                .setFees(toTKN(1000), 100, toTKN(2000), 100, 0);
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
                    toTKN(1_000_000),
                    30,
                    1,
                    0,
                    invoiceNFTContract.address,
                    invoiceNFTTokenId,
                    toTKN(1_500_000)
                );

            await poolContract
                .connect(borrower)
                .drawdownWithReceivable(
                    toTKN(1_000_000),
                    invoiceNFTContract.address,
                    invoiceNFTTokenId
                );
            let blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);

            dueDate = blockBefore.timestamp + 2592000;
        });

        afterEach(async function () {
            if (await humaConfigContract.connect(protocolOwner).paused())
                await humaConfigContract.connect(protocolOwner).unpause();
        });

        it("Invalidate payment after review", async function () {
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toTKN(1_000_000),
                0,
                dueDate,
                0,
                toTKN(1_000_000),
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
                    .onReceivedPayment(borrower.address, toTKN(15_000_000), paymentId)
            )
                .to.emit(poolContract, "PaymentFlaggedForReview")
                .withArgs(paymentId, borrower.address, toTKN(15_000_000));

            expect(await poolContract.isPaymentProcessed(paymentId)).to.equal(false);
            expect(await poolContract.isPaymentUnderReview(paymentId)).to.equal(true);
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toTKN(1_000_000),
                0,
                dueDate,
                0,
                toTKN(1_000_000),
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
            ).to.be.revertedWith("notPoolOwner()");

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
                toTKN(1_000_000),
                0,
                dueDate,
                0,
                toTKN(1_000_000),
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
                    .onReceivedPayment(borrower.address, toTKN(15_000_000), paymentId)
            )
                .to.emit(poolContract, "PaymentFlaggedForReview")
                .withArgs(paymentId, borrower.address, toTKN(15_000_000));

            expect(await poolContract.isPaymentProcessed(paymentId)).to.equal(false);
            expect(await poolContract.isPaymentUnderReview(paymentId)).to.equal(true);
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                r,
                rs,
                toTKN(1_000_000),
                0,
                dueDate,
                0,
                toTKN(1_000_000),
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

            await testTokenContract.mint(poolContract.address, toTKN(15_000_000));

            let invalidPaymentId = ethers.utils.formatBytes32String("1");
            await expect(
                poolContract.connect(poolOwner).processPaymentAfterReview(invalidPaymentId, true)
            ).to.be.revertedWith("paymentIdNotUnderReview()");

            await expect(
                poolContract.connect(poolOwner).processPaymentAfterReview(paymentId, true)
            )
                .to.emit(poolContract, "ExtraFundsDispersed")
                .withArgs(borrower.address, toTKN(14_000_000))
                .to.emit(poolContract, "ReceivedPaymentProcessed")
                .withArgs(poolOwner.address, borrower.address, toTKN(15_000_000), paymentId);

            expect(await poolContract.isPaymentProcessed(paymentId)).to.equal(true);
            expect(await poolContract.isPaymentUnderReview(paymentId)).to.equal(false);
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, toTKN(1_000_000), 0, dueDate, 0, 0, 0, 0, 0, 0, 30, 0, 0);
            borrowerBalance = borrowerBalance.add(toTKN(14000000));
            poolLiquidity = poolLiquidity.add(toTKN(1000000));
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
                toTKN(1_000_000),
                0,
                dueDate,
                0,
                toTKN(1_000_000),
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

            await testTokenContract.mint(poolContract.address, toTKN(1_500_000));

            let paymentId = ethers.utils.formatBytes32String("3");
            await expect(
                poolContract
                    .connect(pdsServiceAccount)
                    .onReceivedPayment(borrower.address, toTKN(1_500_000), paymentId)
            )
                .to.emit(poolContract, "ExtraFundsDispersed")
                .withArgs(borrower.address, toTKN(500_000))
                .to.emit(poolContract, "ReceivedPaymentProcessed")
                .withArgs(
                    pdsServiceAccount.address,
                    borrower.address,
                    toTKN(1_500_000),
                    paymentId
                );

            expect(await poolContract.isPaymentProcessed(paymentId)).to.equal(true);
            expect(await poolContract.isPaymentUnderReview(paymentId)).to.equal(false);
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, toTKN(1_000_000), 0, dueDate, 0, 0, 0, 0, 0, 0, 30, 0, 0);
            borrowerBalance = borrowerBalance.add(toTKN(500000));
            poolLiquidity = poolLiquidity.add(toTKN(1000000));
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(borrowerBalance);
            expect(await poolContract.totalPoolValue()).to.equal(poolValue);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                poolLiquidity
            );

            paymentId = ethers.utils.formatBytes32String("4");
            await expect(
                poolContract
                    .connect(pdsServiceAccount)
                    .onReceivedPayment(borrower.address, toTKN(2_000_000), paymentId)
            )
                .to.emit(poolContract, "PaymentFlaggedForReview")
                .withArgs(paymentId, borrower.address, toTKN(2_000_000));

            expect(await poolContract.isPaymentProcessed(paymentId)).to.equal(false);
            expect(await poolContract.isPaymentUnderReview(paymentId)).to.equal(true);
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, toTKN(1_000_000), 0, dueDate, 0, 0, 0, 0, 0, 0, 30, 0, 0);

            await testTokenContract.mint(poolContract.address, toTKN(2_000_000));

            await expect(
                poolContract.connect(poolOwner).processPaymentAfterReview(paymentId, true)
            )
                .to.emit(poolContract, "ExtraFundsDispersed")
                .withArgs(borrower.address, toTKN(2_000_000))
                .to.emit(poolContract, "ReceivedPaymentProcessed")
                .withArgs(poolOwner.address, borrower.address, toTKN(2_000_000), paymentId);

            expect(await poolContract.isPaymentProcessed(paymentId)).to.equal(true);
            expect(await poolContract.isPaymentUnderReview(paymentId)).to.equal(false);
            r = await poolContract.creditRecordMapping(borrower.address);
            rs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(r, rs, toTKN(1_000_000), 0, dueDate, 0, 0, 0, 0, 0, 0, 30, 0, 0);
            borrowerBalance = borrowerBalance.add(toTKN(2000000));
            expect(await testTokenContract.balanceOf(borrower.address)).to.equal(borrowerBalance);
            expect(await poolContract.totalPoolValue()).to.equal(poolValue);
            expect(await testTokenContract.balanceOf(poolContract.address)).to.equal(
                poolLiquidity
            );
        });
    });
});
