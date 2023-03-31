const {ethers} = require("hardhat");
const {expect} = require("chai");
const {BigNumber: BN} = require("ethers");
const {loadFixture} = require("@nomicfoundation/hardhat-network-helpers");
const {
    toToken,
    advanceClock,
    checkResults,
    setNextBlockTimestamp,
    checkRecord,
    printRecord,
} = require("./BaseTest");

require("dotenv").config();

const GOERLI_CHAIN_ID = 5;
const HARDHAT_CHAIN_ID = 31337;

const POLYGON_USDC_MAP_SLOT = "0x0";
const GOERLI_USDC_MAP_SLOT = "0x0";
const MUMBAI_USDC_MAP_SLOT = "0x0";

let polygonUrl = process.env["POLYGON_URL"];
let goerliUrl = process.env["GOERLI_URL"];
let mumbaiUrl = process.env["MUMBAI_URL"];

const POLYGON_USDC_ADDRESS = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";
const POLYGON_SF_USDCX_ADDRESS = "0xCAa7349CEA390F89641fe306D93591f87595dc1F";
const POLYGON_SF_HOST_ADDRESS = "0x3E14dC1b13c488a8d5D310918780c983bD5982E7";
const POLYGON_SF_CFA_ADDRESS = "0x6EeE6060f715257b970700bc2656De21dEdF074C";

const GOERLI_USDC_ADDRESS = "0xc94dd466416A7dFE166aB2cF916D3875C049EBB7";
const GOERLI_SF_USDCX_ADDRESS = "0x8aE68021f6170E5a766bE613cEA0d75236ECCa9a";
const GOERLI_SF_HOST_ADDRESS = "0x22ff293e14F1EC3A09B137e9e06084AFd63adDF9";
const GOERLI_SF_CFA_ADDRESS = "0xEd6BcbF6907D4feEEe8a8875543249bEa9D308E8";

const MUMBAI_USDC_ADDRESS = "0xbe49ac1EadAc65dccf204D4Df81d650B50122aB2";
const MUMBAI_SF_USDCX_ADDRESS = "0x42bb40bF79730451B11f6De1CbA222F17b87Afd7";
const MUMBAI_SF_HOST_ADDRESS = "0xEB796bdb90fFA0f28255275e16936D25d3418603";
const MUMBAI_SF_CFA_ADDRESS = "0x49e565Ed1bdc17F3d220f72DF0857C26FA83F873";

// let chainUrl = polygonUrl;
// let usdcMapSlot = POLYGON_USDC_MAP_SLOT;
// let usdcDecimals = 6;

// let usdcAddress = POLYGON_USDC_ADDRESS;
// let sfUsdcxAddress = POLYGON_SF_USDCX_ADDRESS;
// let sfHostAddress = POLYGON_SF_HOST_ADDRESS;
// let sfCFAAddress = POLYGON_SF_CFA_ADDRESS;

let chainUrl = mumbaiUrl;
let usdcMapSlot = MUMBAI_USDC_MAP_SLOT;
let usdcDecimals = 18;

let usdcAddress = MUMBAI_USDC_ADDRESS;
let sfUsdcxAddress = MUMBAI_SF_USDCX_ADDRESS;
let sfHostAddress = MUMBAI_SF_HOST_ADDRESS;
let sfCFAAddress = MUMBAI_SF_CFA_ADDRESS;

let usdc, sf, usdcx, cfa;

let defaultDeployer,
    poolOwner,
    proxyOwner,
    treasury,
    lender,
    protocolOwner,
    eaServiceAccount,
    pdsServiceAccount,
    borrower,
    evaluationAgent,
    poolOperator,
    poolOwnerTreasury,
    payer;

let humaConfigContract,
    eaNFTContract,
    feeManagerContract,
    hdtContract,
    poolConfigContract,
    poolContract,
    poolProcessorContract,
    nftContract,
    sfRegisterContract;

function toDefaultToken(amount) {
    return toToken(amount, 18);
}

function toUSDC(amount) {
    return toToken(amount, usdcDecimals);
}

function convertDefaultToUSDC(amount) {
    if (usdcDecimals != 18) {
        return amount
            .mul(BN.from(10).pow(BN.from(usdcDecimals)))
            .div(BN.from(10).pow(BN.from(18)));
    } else {
        return amount;
    }
}

async function mint(address, amount) {
    await mintToken(usdc, usdcMapSlot, address, amount);
}

async function mintToken(token, mapSlot, address, amount) {
    const beforeAmount = await token.balanceOf(address);
    const newAmount = amount.add(beforeAmount);
    await setToken(token.address, mapSlot, address, newAmount);
}

async function setToken(tokenAddress, mapSlot, address, amount) {
    const mintAmount = ethers.utils.hexZeroPad(amount.toHexString(), 32);
    const slot = ethers.utils.hexStripZeros(
        ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [address, mapSlot])
        )
    );
    await network.provider.send("hardhat_setStorageAt", [tokenAddress, slot, mintAmount]);
}

async function createFlow(xToken, payer, payee, flowrate) {
    const calldata = cfa.interface.encodeFunctionData("createFlow", [
        xToken.address,
        payee.address,
        flowrate,
        "0x",
    ]);

    await sf.connect(payer).callAgreement(cfa.address, calldata, "0x");
}

async function authorizeFlow(xToken, sender, operator) {
    const calldata = cfa.interface.encodeFunctionData("authorizeFlowOperatorWithFullControl", [
        xToken.address,
        operator.address,
        "0x",
    ]);
    await sf.connect(sender).callAgreement(cfa.address, calldata, "0x");
}

async function deleteFlow(xToken, sender, receiver) {
    const calldata = cfa.interface.encodeFunctionData("deleteFlow", [
        xToken.address,
        sender.address,
        receiver.address,
        "0x",
    ]);

    await sf.connect(sender).callAgreement(cfa.address, calldata, "0x");
}

async function deployContracts(
    poolOwner,
    treasury,
    protocolOwner,
    eaServiceAccount,
    pdsServiceAccount,
    assetToken
) {
    // Deploy EvaluationAgentNFT
    const EvaluationAgentNFT = await ethers.getContractFactory("EvaluationAgentNFT");
    eaNFTContract = await EvaluationAgentNFT.deploy();

    // Deploy HumaConfig
    const HumaConfig = await ethers.getContractFactory("HumaConfig");
    humaConfigContract = await HumaConfig.deploy();
    // await humaConfigContract.setHumaTreasury(treasury.address);
    await humaConfigContract.setHumaTreasury(treasury.address);
    await humaConfigContract.setTreasuryFee(2000);
    await humaConfigContract.addPauser(poolOwner.address);
    await humaConfigContract.setEANFTContractAddress(eaNFTContract.address);
    await humaConfigContract.setEAServiceAccount(eaServiceAccount.address);
    await humaConfigContract.setPDSServiceAccount(pdsServiceAccount.address);

    await humaConfigContract.transferOwnership(protocolOwner.address);
    await humaConfigContract.connect(protocolOwner).addPauser(protocolOwner.address);
    if (await humaConfigContract.connect(protocolOwner).paused())
        await humaConfigContract.connect(protocolOwner).unpause();

    await humaConfigContract.connect(protocolOwner).setLiquidityAsset(assetToken.address, true);

    return [humaConfigContract, eaNFTContract];
}

async function deployAndSetupPool(
    poolOwner,
    proxyOwner,
    evaluationAgent,
    lender,
    humaConfigContract,
    eaNFTContract,
    poolOperator,
    poolOwnerTreasury
) {
    await mint(lender.address, toUSDC(10_000_000));
    await mint(poolOwnerTreasury.address, toUSDC(10_000_000));
    await mint(evaluationAgent.address, toUSDC(10_000_000));

    // Deploy Fee Manager
    const feeManagerFactory = await ethers.getContractFactory("SuperfluidFeeManager");
    const feeManagerContract = await feeManagerFactory.deploy();
    await feeManagerContract.transferOwnership(poolOwner.address);

    const TransparentUpgradeableProxy = await ethers.getContractFactory(
        "TransparentUpgradeableProxy"
    );

    const HDT = await ethers.getContractFactory("HDT");
    const hdtImpl = await HDT.deploy();
    await hdtImpl.deployed();
    const hdtProxy = await TransparentUpgradeableProxy.deploy(
        hdtImpl.address,
        proxyOwner.address,
        []
    );
    await hdtProxy.deployed();
    const hdtContract = HDT.attach(hdtProxy.address);
    await hdtContract.initialize("Base Credit HDT", "CHDT", usdc.address);

    const BasePoolConfig = await ethers.getContractFactory("BasePoolConfig");
    const poolConfig = await BasePoolConfig.deploy();
    await poolConfig.deployed();
    await poolConfig.initialize(
        "Base Credit Pool",
        hdtContract.address,
        humaConfigContract.address,
        feeManagerContract.address
    );

    // Deploy pool contract
    const poolContractFactory = await ethers.getContractFactory("ReceivableFactoringPoolV2");
    const poolImpl = await poolContractFactory.deploy();
    await poolImpl.deployed();
    const poolProxy = await TransparentUpgradeableProxy.deploy(
        poolImpl.address,
        proxyOwner.address,
        []
    );
    await poolProxy.deployed();
    const poolContract = poolContractFactory.attach(poolProxy.address);

    const poolProcessorContractFactory = await ethers.getContractFactory(
        "SuperfluidPoolProcessor"
    );
    const poolProcessorImpl = await poolProcessorContractFactory.deploy();
    await poolProcessorImpl.deployed();
    const poolProcessorProxy = await TransparentUpgradeableProxy.deploy(
        poolProcessorImpl.address,
        proxyOwner.address,
        []
    );
    await poolProcessorProxy.deployed();
    const poolProcessorContract = poolProcessorContractFactory.attach(poolProcessorProxy.address);

    await poolProcessorContract["initialize(address,address,address)"](
        poolContract.address,
        sfHostAddress,
        sfCFAAddress
    );
    await poolContract["initialize(address,address)"](
        poolConfig.address,
        poolProcessorContract.address
    );
    await poolConfig.setPool(poolContract.address);
    await hdtContract.setPool(poolContract.address);

    // Pool setup
    await poolConfig.transferOwnership(poolOwner.address);

    // Config rewards and requirements for poolOwner and EA, make initial deposit, and enable pool
    await poolConfig.connect(poolOwner).setPoolLiquidityCap(toUSDC(1_000_000_000));
    await poolConfig.connect(poolOwner).setPoolOwnerRewardsAndLiquidity(625, 10);

    let eaNFTTokenId;
    // Mint EANFT to the ea
    const tx = await eaNFTContract.mintNFT(evaluationAgent.address);
    const receipt = await tx.wait();
    for (const evt of receipt.events) {
        if (evt.event === "NFTGenerated") {
            eaNFTTokenId = evt.args.tokenId;
        }
    }

    await poolConfig.connect(poolOwner).setEvaluationAgent(eaNFTTokenId, evaluationAgent.address);
    let s = await poolConfig.getPoolSummary();

    await poolConfig.connect(poolOwner).setEARewardsAndLiquidity(1875, 10);

    await poolConfig.connect(poolOwner).setPoolOwnerTreasury(poolOwnerTreasury.address);
    await poolConfig.connect(poolOwner).addPoolOperator(poolOwner.address);
    await poolConfig.connect(poolOwner).addPoolOperator(poolOperator.address);

    await poolContract.connect(poolOperator).addApprovedLender(poolOwnerTreasury.address);
    await poolContract.connect(poolOperator).addApprovedLender(evaluationAgent.address);
    await poolContract.connect(poolOperator).addApprovedLender(lender.address);

    await usdc.connect(poolOwnerTreasury).approve(poolContract.address, toUSDC(1_000_000));
    await poolContract.connect(poolOwnerTreasury).makeInitialDeposit(toUSDC(1_000_000));

    await usdc.connect(evaluationAgent).approve(poolContract.address, toUSDC(2_000_000));
    await poolContract.connect(evaluationAgent).makeInitialDeposit(toUSDC(2_000_000));

    await expect(poolContract.connect(poolOwner).enablePool()).to.emit(
        poolContract,
        "PoolEnabled"
    );

    await poolConfig.connect(poolOwner).setAPR(1217);
    await poolConfig.connect(poolOwner).setMaxCreditLine(toUSDC(10_000_000));

    await usdc.connect(lender).approve(poolContract.address, toUSDC(2_000_000));
    await poolContract.connect(lender).deposit(toUSDC(2_000_000));

    return [feeManagerContract, hdtContract, poolConfig, poolContract, poolProcessorContract];
}

function calcCorrection(cr, crs, blockTS, amount) {
    return amount
        .mul(crs.aprInBps)
        .mul(cr.dueDate.sub(blockTS))
        .div(3600 * 24 * 365)
        .div(10000)
        .mul(-1);
}

function calcInterest(crs, amount) {
    return amount.mul(crs.aprInBps).mul(crs.intervalInDays).div(365).div(10000);
}

describe("Superfluid Factoring", function () {
    before(async function () {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: chainUrl,
                        blockNumber: 33667900,
                    },
                },
            ],
        });

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
        usdc = await ethers.getContractAt("IERC20", usdcAddress);
        sf = await ethers.getContractAt("ISuperfluid", sfHostAddress);
        usdcx = await ethers.getContractAt("ISuperToken", sfUsdcxAddress);
        cfa = await ethers.getContractAt("IConstantFlowAgreementV1", sfCFAAddress);
        await mint(payer.address, toUSDC(1_000_000));
        console.log(`payer ${payer.address} usdc balance: ${await usdc.balanceOf(payer.address)}`);
        await usdc.connect(payer).approve(usdcx.address, toUSDC(1_000_000));

        const nftContractFactory = await ethers.getContractFactory("TradableStream");
        nftContract = await nftContractFactory.deploy(sfHostAddress);
        await nftContract.deployed();

        const sfRegisterContractFactory = await ethers.getContractFactory("MockSuperAppRegister");
        sfRegisterContract = await sfRegisterContractFactory.deploy(sfHostAddress);
        await sfRegisterContract.deployed();
    });

    let streamAmount,
        streamDays,
        streamDuration,
        collateralAmount,
        loanAmount,
        streamId,
        nftVersion;

    async function prepare() {
        [humaConfigContract, eaNFTContract] = await deployContracts(
            poolOwner,
            treasury,
            protocolOwner,
            eaServiceAccount,
            pdsServiceAccount,
            usdc
        );

        [
            feeManagerContract,
            hdtContract,
            poolConfigContract,
            poolContract,
            poolProcessorContract,
        ] = await deployAndSetupPool(
            poolOwner,
            proxyOwner,
            evaluationAgent,
            lender,
            humaConfigContract,
            eaNFTContract,
            poolOperator,
            poolOwnerTreasury
        );

        await poolConfigContract.connect(poolOwner).setWithdrawalLockoutPeriod(90);
        await poolConfigContract.connect(poolOwner).setPoolDefaultGracePeriod(60);
        await poolConfigContract.connect(poolOwner).setAPR(0);
        await poolConfigContract.connect(poolOwner).setMaxCreditLine(toUSDC(1_000_000));
        await humaConfigContract.connect(protocolOwner).setTreasuryFee(2000);
        await poolConfigContract.connect(poolOwner).setPoolOwnerRewardsAndLiquidity(625, 0);
        await poolConfigContract.connect(poolOwner).setEARewardsAndLiquidity(1875, 0);
        await poolConfigContract.connect(poolOwner).setReceivableRequiredInBps(10000);

        await usdcx.connect(payer).upgrade(toDefaultToken(10_000));
        console.log(
            `payer ${payer.address} usdcx balance: ${await usdcx.balanceOf(payer.address)}`
        );

        streamAmount = 2000;
        streamDays = 10;
        streamDuration = 10 * 24 * 60 * 60;

        let flowrate = toDefaultToken(streamAmount).div(BN.from(streamDuration));
        await createFlow(usdcx, payer, borrower, flowrate);

        console.log(`authorize stream...`);
        await authorizeFlow(usdcx, payer, nftContract);

        console.log(`mint TradableStream...`);
        collateralAmount = 500;
        flowrate = toDefaultToken(collateralAmount).div(BN.from(streamDuration)).add(BN.from(1));
        await nftContract
            .connect(borrower)
            .mint(usdcx.address, payer.address, flowrate, streamDuration);
        streamId = 0;

        await nftContract.connect(borrower).approve(poolContract.address, streamId);

        nftVersion = await nftContract.version();
    }

    beforeEach(async function () {
        await loadFixture(prepare);
    });

    describe("approveCredit", function () {
        it("Should approve stream with amount equals to or high than the receivable requirement", async function () {
            await poolContract
                .connect(eaServiceAccount)
                ["approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"](
                    borrower.address,
                    toUSDC(streamAmount),
                    streamDays,
                    1,
                    1217,
                    nftContract.address,
                    ethers.utils.solidityKeccak256(
                        ["address", "address", "address"],
                        [usdcx.address, payer.address, borrower.address]
                    ),
                    toUSDC(streamAmount)
                );

            let res = await poolContract.receivableInfoMapping(borrower.address);
            checkResults(res, [
                nftContract.address,
                toUSDC(streamAmount),
                ethers.utils.solidityKeccak256(
                    ["address", "address", "address"],
                    [usdcx.address, payer.address, borrower.address]
                ),
            ]);
            res = await poolContract.creditRecordStaticMapping(borrower.address);
            checkResults(res, [toUSDC(streamAmount), 1217, streamDays, 0]);
        });
    });

    describe.skip("drawdownWithReceivable", function () {
        beforeEach(async function () {
            await poolContract
                .connect(eaServiceAccount)
                ["approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"](
                    borrower.address,
                    toUSDC(streamAmount),
                    streamDays,
                    1,
                    1217,
                    nftContract.address,
                    ethers.utils.solidityKeccak256(
                        ["address", "address", "address"],
                        [usdcx.address, payer.address, borrower.address]
                    ),
                    toUSDC(streamAmount)
                );
        });

        it("Should drawdown with receivable", async function () {
            await usdc.connect(borrower).approve(poolContract.address, toUSDC(10_000));

            const beforeAmount = await usdc.balanceOf(borrower.address);
            const beforePoolFlowrate = await cfa.getNetFlow(usdcx.address, poolContract.address);
            const beforeBorrowerFlowrate = await cfa.getNetFlow(usdcx.address, borrower.address);

            const ts = Math.ceil(Date.now() / 1000) + 2;
            await setNextBlockTimestamp(ts);
            await poolContract
                .connect(borrower)
                .drawdownWithReceivable(toUSDC(collateralAmount), nftContract.address, streamId);
            const afterAmount = await usdc.balanceOf(borrower.address);
            const afterPoolFlowrate = await cfa.getNetFlow(usdcx.address, poolContract.address);
            const afterBorrowerFlowrate = await cfa.getNetFlow(usdcx.address, borrower.address);

            const interest = toUSDC(collateralAmount)
                .mul(BN.from(streamDays * 1217))
                .div(BN.from(365 * 10000));
            const receivedAmount = afterAmount.sub(beforeAmount);

            expect(receivedAmount).to.equal(toUSDC(collateralAmount).sub(interest));
            expect(await nftContract.ownerOf(streamId)).to.equal(poolContract.address);
            expect(beforeBorrowerFlowrate.sub(afterBorrowerFlowrate)).to.equal(
                afterPoolFlowrate.sub(beforePoolFlowrate)
            );

            let res = await nftContract.getTradableStreamData(streamId);
            const flowrate = res[6];
            expect(afterPoolFlowrate.sub(beforePoolFlowrate)).to.equal(flowrate);

            res = await poolContract.streamInfoMapping(nftContract.address, streamId);
            const dueDate = ts + streamDuration;
            checkResults(res, [borrower.address, ts, dueDate, flowrate, 0]);
            const cr = await poolContract.creditRecordMapping(borrower.address);
            const crs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                cr,
                crs,
                toUSDC(streamAmount),
                0,
                dueDate,
                0,
                toUSDC(collateralAmount),
                0,
                0,
                0,
                0,
                streamDays,
                3,
                0
            );
        });
    });

    describe("mintTo & drawdown", function () {
        beforeEach(async function () {
            await poolContract
                .connect(eaServiceAccount)
                ["approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"](
                    borrower.address,
                    toUSDC(streamAmount),
                    streamDays,
                    1,
                    1217,
                    nftContract.address,
                    ethers.utils.solidityKeccak256(
                        ["address", "address", "address"],
                        [usdcx.address, payer.address, borrower.address]
                    ),
                    toUSDC(streamAmount)
                );
        });

        it("Should drawdown with authorization", async function () {
            await usdc.connect(borrower).approve(poolProcessorContract.address, toUSDC(10_000));

            const beforeAmount = await usdc.balanceOf(borrower.address);
            const beforeProcessorFlowrate = await cfa.getNetFlow(
                usdcx.address,
                poolProcessorContract.address
            );
            const beforeBorrowerFlowrate = await cfa.getNetFlow(usdcx.address, borrower.address);

            const ts = Math.ceil(Date.now() / 1000) + 2;
            await setNextBlockTimestamp(ts);

            let flowrate = toDefaultToken(collateralAmount)
                .div(BN.from(streamDuration))
                .add(BN.from(1));
            loanAmount = flowrate.mul(streamDuration);
            const nonce = await nftContract.nonces(borrower.address);
            const expiry = Math.ceil(Date.now() / 1000) + 300;

            const signatureData = await borrower._signTypedData(
                {
                    name: "TradableStream",
                    version: nftVersion,
                    chainId: HARDHAT_CHAIN_ID,
                    verifyingContract: nftContract.address,
                },
                {
                    MintToWithAuthorization: [
                        {name: "receiver", type: "address"},
                        {name: "token", type: "address"},
                        {name: "origin", type: "address"},
                        {name: "owner", type: "address"},
                        {name: "flowrate", type: "int96"},
                        {name: "durationInSeconds", type: "uint256"},
                        {name: "nonce", type: "uint256"},
                        {name: "expiry", type: "uint256"},
                    ],
                },
                {
                    receiver: borrower.address,
                    token: usdcx.address,
                    origin: payer.address,
                    owner: poolProcessorContract.address,
                    flowrate: flowrate,
                    durationInSeconds: streamDuration,
                    nonce: nonce,
                    expiry: expiry,
                }
            );
            const signature = ethers.utils.splitSignature(signatureData);

            const calldata = ethers.utils.defaultAbiCoder.encode(
                [
                    "address",
                    "address",
                    "address",
                    "int96",
                    "uint256",
                    "uint256",
                    "uint8",
                    "bytes32",
                    "bytes32",
                ],
                [
                    borrower.address,
                    usdcx.address,
                    payer.address,
                    flowrate,
                    streamDuration,
                    expiry,
                    signature.v,
                    signature.r,
                    signature.s,
                ]
            );

            await poolProcessorContract.mintAndDrawdown(
                borrower.address,
                loanAmount,
                nftContract.address,
                calldata
            );

            const afterAmount = await usdc.balanceOf(borrower.address);
            const afterProcessorFlowrate = await cfa.getNetFlow(
                usdcx.address,
                poolProcessorContract.address
            );
            const afterBorrowerFlowrate = await cfa.getNetFlow(usdcx.address, borrower.address);

            const interest = loanAmount.mul(BN.from(streamDays * 1217)).div(BN.from(365 * 10000));
            const receivedAmount = afterAmount.sub(beforeAmount);

            const streamId = 1;

            expect(receivedAmount).to.equal(loanAmount.sub(interest));
            expect(await nftContract.ownerOf(streamId)).to.equal(poolProcessorContract.address);
            expect(beforeBorrowerFlowrate.sub(afterBorrowerFlowrate)).to.equal(
                afterProcessorFlowrate.sub(beforeProcessorFlowrate)
            );

            let res = await nftContract.getTradableStreamData(streamId);
            flowrate = res[6];
            expect(afterProcessorFlowrate.sub(beforeProcessorFlowrate)).to.equal(flowrate);

            res = await poolProcessorContract.streamInfoMapping(nftContract.address, streamId);
            const dueDate = ts + streamDuration;
            checkResults(res, [borrower.address, ts, dueDate, flowrate, 0, 0]);
            const cr = await poolContract.creditRecordMapping(borrower.address);
            const crs = await poolContract.creditRecordStaticMapping(borrower.address);
            printRecord(cr, crs);
            checkRecord(
                cr,
                crs,
                toUSDC(streamAmount),
                0,
                dueDate,
                0,
                loanAmount,
                0,
                0,
                0,
                1217,
                streamDays,
                3,
                0
            );
        });
    });

    describe("multisend for drawdown", function () {
        beforeEach(async function () {
            await poolContract
                .connect(eaServiceAccount)
                ["approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"](
                    borrower.address,
                    toUSDC(streamAmount),
                    streamDays,
                    1,
                    1217,
                    nftContract.address,
                    ethers.utils.solidityKeccak256(
                        ["address", "address", "address"],
                        [usdcx.address, payer.address, borrower.address]
                    ),
                    toUSDC(streamAmount)
                );
        });

        it("Should multisend for drawdown", async function () {
            const Multisend = await ethers.getContractFactory("Multisend");
            const multisend = await Multisend.deploy();
            await multisend.deployed();

            const TestToken = await ethers.getContractFactory("TestToken");
            const testToken = await TestToken.deploy();
            await testToken.deployed();

            let allowanceAmount = BN.from(10e10);
            let nonce = await testToken.nonces(borrower.address);
            let expiry = Math.ceil(Date.now() / 1000) + 300;
            let signatureData = await borrower._signTypedData(
                {
                    name: "TestToken",
                    version: "1",
                    chainId: HARDHAT_CHAIN_ID,
                    verifyingContract: testToken.address,
                },
                {
                    Permit: [
                        {name: "owner", type: "address"},
                        {name: "spender", type: "address"},
                        {name: "value", type: "uint256"},
                        {name: "nonce", type: "uint256"},
                        {name: "deadline", type: "uint256"},
                    ],
                },
                {
                    owner: borrower.address,
                    spender: nftContract.address,
                    value: allowanceAmount,
                    nonce: nonce,
                    deadline: expiry,
                }
            );
            let signature = ethers.utils.splitSignature(signatureData);

            let tos = [];
            let datas = [];
            tos.push(testToken.address);
            datas.push(
                testToken.interface.encodeFunctionData("permit", [
                    borrower.address,
                    nftContract.address,
                    allowanceAmount,
                    expiry,
                    signature.v,
                    signature.r,
                    signature.s,
                ])
            );

            await usdc.connect(borrower).approve(poolProcessorContract.address, toUSDC(10_000));

            const beforeAmount = await usdc.balanceOf(borrower.address);
            const beforeProcessorFlowrate = await cfa.getNetFlow(
                usdcx.address,
                poolProcessorContract.address
            );
            const beforeBorrowerFlowrate = await cfa.getNetFlow(usdcx.address, borrower.address);

            const ts = Math.ceil(Date.now() / 1000) + 2;
            await setNextBlockTimestamp(ts);

            let flowrate = toDefaultToken(collateralAmount)
                .div(BN.from(streamDuration))
                .add(BN.from(1));
            loanAmount = flowrate.mul(BN.from(streamDuration));
            nonce = await nftContract.nonces(borrower.address);
            expiry = Math.ceil(Date.now() / 1000) + 300;

            signatureData = await borrower._signTypedData(
                {
                    name: "TradableStream",
                    version: nftVersion,
                    chainId: HARDHAT_CHAIN_ID,
                    verifyingContract: nftContract.address,
                },
                {
                    MintToWithAuthorization: [
                        {name: "receiver", type: "address"},
                        {name: "token", type: "address"},
                        {name: "origin", type: "address"},
                        {name: "owner", type: "address"},
                        {name: "flowrate", type: "int96"},
                        {name: "durationInSeconds", type: "uint256"},
                        {name: "nonce", type: "uint256"},
                        {name: "expiry", type: "uint256"},
                    ],
                },
                {
                    receiver: borrower.address,
                    token: usdcx.address,
                    origin: payer.address,
                    owner: poolProcessorContract.address,
                    flowrate: flowrate,
                    durationInSeconds: streamDuration,
                    nonce: nonce,
                    expiry: expiry,
                }
            );
            signature = ethers.utils.splitSignature(signatureData);

            calldata = ethers.utils.defaultAbiCoder.encode(
                [
                    "address",
                    "address",
                    "address",
                    "int96",
                    "uint256",
                    "uint256",
                    "uint8",
                    "bytes32",
                    "bytes32",
                ],
                [
                    borrower.address,
                    usdcx.address,
                    payer.address,
                    flowrate,
                    streamDuration,
                    expiry,
                    signature.v,
                    signature.r,
                    signature.s,
                ]
            );

            tos.push(poolProcessorContract.address);
            datas.push(
                poolProcessorContract.interface.encodeFunctionData("mintAndDrawdown", [
                    borrower.address,
                    loanAmount,
                    nftContract.address,
                    calldata,
                ])
            );

            await multisend.multisend(tos, datas);

            const afterAmount = await usdc.balanceOf(borrower.address);
            const afterProcessorFlowrate = await cfa.getNetFlow(
                usdcx.address,
                poolProcessorContract.address
            );
            const afterBorrowerFlowrate = await cfa.getNetFlow(usdcx.address, borrower.address);

            const interest = loanAmount.mul(BN.from(streamDays * 1217)).div(BN.from(365 * 10000));
            const receivedAmount = afterAmount.sub(beforeAmount);

            const streamId = 1;

            expect(receivedAmount).to.equal(loanAmount.sub(interest));
            expect(await nftContract.ownerOf(streamId)).to.equal(poolProcessorContract.address);
            expect(beforeBorrowerFlowrate.sub(afterBorrowerFlowrate)).to.equal(
                afterProcessorFlowrate.sub(beforeProcessorFlowrate)
            );

            let res = await nftContract.getTradableStreamData(streamId);
            flowrate = res[6];
            expect(afterProcessorFlowrate.sub(beforeProcessorFlowrate)).to.equal(flowrate);

            res = await poolProcessorContract.streamInfoMapping(nftContract.address, streamId);
            const dueDate = ts + streamDuration;
            checkResults(res, [borrower.address, ts, dueDate, flowrate, 0, 0]);
            const cr = await poolContract.creditRecordMapping(borrower.address);
            const crs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                cr,
                crs,
                toUSDC(streamAmount),
                0,
                dueDate,
                0,
                loanAmount,
                0,
                0,
                0,
                1217,
                streamDays,
                3,
                0
            );

            expect(await testToken.allowance(borrower.address, nftContract.address)).to.equal(
                allowanceAmount
            );
        });
    });

    describe("payoff", function () {
        beforeEach(async function () {
            await poolContract
                .connect(eaServiceAccount)
                ["approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"](
                    borrower.address,
                    toUSDC(streamAmount),
                    streamDays,
                    1,
                    1217,
                    nftContract.address,
                    ethers.utils.solidityKeccak256(
                        ["address", "address", "address"],
                        [usdcx.address, payer.address, borrower.address]
                    ),
                    toUSDC(streamAmount)
                );
            await usdc.connect(borrower).approve(poolProcessorContract.address, toUSDC(10_000));
            // const ts = Math.ceil(Date.now() / 1000) + 2;
            // await setNextBlockTimestamp(ts);
            let flowrate = toDefaultToken(collateralAmount)
                .div(BN.from(streamDuration))
                .add(BN.from(1));
            loanAmount = flowrate.mul(BN.from(streamDuration));
            console.log(`loanAmount: ${loanAmount}`);
            const nonce = await nftContract.nonces(borrower.address);
            const expiry = Math.ceil(Date.now() / 1000) + 300;
            const signatureData = await borrower._signTypedData(
                {
                    name: "TradableStream",
                    version: nftVersion,
                    chainId: HARDHAT_CHAIN_ID,
                    verifyingContract: nftContract.address,
                },
                {
                    MintToWithAuthorization: [
                        {name: "receiver", type: "address"},
                        {name: "token", type: "address"},
                        {name: "origin", type: "address"},
                        {name: "owner", type: "address"},
                        {name: "flowrate", type: "int96"},
                        {name: "durationInSeconds", type: "uint256"},
                        {name: "nonce", type: "uint256"},
                        {name: "expiry", type: "uint256"},
                    ],
                },
                {
                    receiver: borrower.address,
                    token: usdcx.address,
                    origin: payer.address,
                    owner: poolProcessorContract.address,
                    flowrate: flowrate,
                    durationInSeconds: streamDuration,
                    nonce: nonce,
                    expiry: expiry,
                }
            );
            const signature = ethers.utils.splitSignature(signatureData);
            const calldata = ethers.utils.defaultAbiCoder.encode(
                [
                    "address",
                    "address",
                    "address",
                    "int96",
                    "uint256",
                    "uint256",
                    "uint8",
                    "bytes32",
                    "bytes32",
                ],
                [
                    borrower.address,
                    usdcx.address,
                    payer.address,
                    flowrate,
                    streamDuration,
                    expiry,
                    signature.v,
                    signature.r,
                    signature.s,
                ]
            );
            await poolProcessorContract.mintAndDrawdown(
                borrower.address,
                loanAmount,
                nftContract.address,
                calldata
            );
        });

        it("Should payoff", async function () {
            let cr = await poolContract.creditRecordMapping(borrower.address);
            let crs = await poolContract.creditRecordStaticMapping(borrower.address);
            printRecord(cr, crs);
            const expiration = 10000;
            const nts = cr.dueDate.toNumber() + expiration;
            let block = await ethers.provider.getBlock();
            const beforeBorrowerFlowrate = await cfa.getNetFlow(usdcx.address, borrower.address);
            const beforeReceivedAmount = BN.from(nts)
                .sub(block.timestamp)
                .mul(beforeBorrowerFlowrate);
            await setNextBlockTimestamp(nts);
            const streamId = 1;
            let res = await nftContract.getTradableStreamData(streamId);
            const flowrate = res[6];
            const beforeBorrowAmount = await usdc.balanceOf(borrower.address);
            const beforePoolAmount = await usdc.balanceOf(poolContract.address);
            const beforeBorrowXAmount = await usdcx.balanceOf(borrower.address);
            const beforeProcessorFlowrate = await cfa.getNetFlow(
                usdcx.address,
                poolProcessorContract.address
            );
            await poolProcessorContract.payoff(nftContract.address, streamId);
            const afterBorrowAmount = await usdc.balanceOf(borrower.address);
            const afterPoolAmount = await usdc.balanceOf(poolContract.address);
            const afterBorrowXAmount = await usdcx.balanceOf(borrower.address);
            const afterProcessorFlowrate = await cfa.getNetFlow(
                usdcx.address,
                poolProcessorContract.address
            );
            const afterBorrowerFlowrate = await cfa.getNetFlow(usdcx.address, borrower.address);
            console.log(
                `afterBorrowAmount: ${afterBorrowAmount}, beforeBorrowAmount: ${beforeBorrowAmount}`
            );
            expect(afterBorrowAmount.sub(beforeBorrowAmount)).to.equal(0);
            expect(afterPoolAmount.sub(beforePoolAmount)).to.equal(loanAmount);
            expect(beforeProcessorFlowrate.sub(afterProcessorFlowrate)).to.equal(
                afterBorrowerFlowrate.sub(beforeBorrowerFlowrate)
            );
            expect(afterBorrowerFlowrate.sub(beforeBorrowerFlowrate)).to.equal(flowrate);
            await expect(nftContract.ownerOf(streamId)).to.be.revertedWith(
                "ERC721: invalid token ID"
            );
            const si = await poolProcessorContract.streamInfoMapping(
                nftContract.address,
                streamId
            );
            expect(afterBorrowXAmount.sub(beforeBorrowXAmount).sub(beforeReceivedAmount)).to.equal(
                si.flowrate.mul(BN.from(expiration))
            );
            cr = await poolContract.creditRecordMapping(borrower.address);
            crs = await poolContract.creditRecordStaticMapping(borrower.address);
            printRecord(cr, crs);
            checkRecord(
                cr,
                crs,
                toUSDC(streamAmount),
                0,
                "SKIP",
                "SKIP",
                0,
                0,
                0,
                0,
                1217,
                streamDays,
                0,
                0
            );
            checkResults(await poolContract.receivableInfoMapping(borrower.address), [
                ethers.constants.AddressZero,
                0,
                0,
            ]);
        });

        it("Should payoff after made payment manually", async function () {
            let amount = toUSDC(200);
            await usdc.connect(borrower).approve(poolContract.address, amount);

            let beforeBorrowAmount = await usdc.balanceOf(borrower.address);
            let beforePoolAmount = await usdc.balanceOf(poolContract.address);
            console.log(
                `beforeBorrowAmount: ${beforeBorrowAmount}, beforePoolAmount: ${beforePoolAmount}`
            );
            await poolContract.connect(borrower).makePayment(borrower.address, amount);
            let afterBorrowAmount = await usdc.balanceOf(borrower.address);
            let afterPoolAmount = await usdc.balanceOf(poolContract.address);

            expect(beforeBorrowAmount.sub(afterBorrowAmount)).to.equal(amount);
            expect(afterPoolAmount.sub(beforePoolAmount)).to.equal(amount);

            let block = await ethers.provider.getBlock();
            let cr = await poolContract.creditRecordMapping(borrower.address);
            let crs = await poolContract.creditRecordStaticMapping(borrower.address);
            let correction = calcCorrection(cr, crs, block.timestamp, amount);

            checkRecord(
                cr,
                crs,
                toUSDC(streamAmount),
                0,
                "SKIP",
                correction,
                loanAmount.sub(amount),
                0,
                0,
                0,
                1217,
                streamDays,
                3,
                0
            );

            cr = await poolContract.creditRecordMapping(borrower.address);
            const expiration = 10000;
            const nts = cr.dueDate.toNumber() + expiration;
            block = await ethers.provider.getBlock();
            const beforeBorrowerFlowrate = await cfa.getNetFlow(usdcx.address, borrower.address);
            const beforeReceivedAmount = BN.from(nts)
                .sub(block.timestamp)
                .mul(beforeBorrowerFlowrate);
            await setNextBlockTimestamp(nts);

            const streamId = 1;
            let res = await nftContract.getTradableStreamData(streamId);
            const flowrate = res[6];

            beforeBorrowAmount = await usdc.balanceOf(borrower.address);
            beforePoolAmount = await usdc.balanceOf(poolContract.address);
            const beforeBorrowXAmount = await usdcx.balanceOf(borrower.address);
            const beforeProcessorFlowrate = await cfa.getNetFlow(
                usdcx.address,
                poolProcessorContract.address
            );
            await poolProcessorContract.payoff(nftContract.address, streamId);
            afterBorrowAmount = await usdc.balanceOf(borrower.address);
            afterPoolAmount = await usdc.balanceOf(poolContract.address);
            const afterBorrowXAmount = await usdcx.balanceOf(borrower.address);
            const afterProcessorFlowrate = await cfa.getNetFlow(
                usdcx.address,
                poolProcessorContract.address
            );
            const afterBorrowerFlowrate = await cfa.getNetFlow(usdcx.address, borrower.address);

            expect(afterBorrowAmount.sub(beforeBorrowAmount)).to.equal(amount.sub(correction));
            expect(afterPoolAmount.sub(beforePoolAmount)).to.equal(
                loanAmount.sub(amount).add(correction)
            );
            expect(beforeProcessorFlowrate.sub(afterProcessorFlowrate)).to.equal(
                afterBorrowerFlowrate.sub(beforeBorrowerFlowrate)
            );
            expect(afterBorrowerFlowrate.sub(beforeBorrowerFlowrate)).to.equal(flowrate);

            await expect(nftContract.ownerOf(streamId)).to.be.revertedWith(
                "ERC721: invalid token ID"
            );

            const si = await poolProcessorContract.streamInfoMapping(
                nftContract.address,
                streamId
            );
            expect(afterBorrowXAmount.sub(beforeBorrowXAmount).sub(beforeReceivedAmount)).to.equal(
                si.flowrate.mul(BN.from(expiration))
            );

            cr = await poolContract.creditRecordMapping(borrower.address);
            crs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                cr,
                crs,
                toUSDC(streamAmount),
                0,
                "SKIP",
                0,
                0,
                0,
                0,
                0,
                1217,
                streamDays,
                0,
                0
            );
            checkResults(await poolContract.receivableInfoMapping(borrower.address), [
                ethers.constants.AddressZero,
                0,
                0,
            ]);
        });

        it("Should payoff after paid off manually", async function () {
            await mint(borrower.address, toUSDC(10000));

            let excessAmount = toUSDC(100);
            let amount = loanAmount.add(excessAmount);
            await usdc.connect(borrower).approve(poolContract.address, amount);

            let cr = await poolContract.creditRecordMapping(borrower.address);

            let beforeBorrowAmount = await usdc.balanceOf(borrower.address);
            let beforePoolAmount = await usdc.balanceOf(poolContract.address);
            let amountUsedbyCorrection = cr.totalDue;
            await poolContract.connect(borrower).makePayment(borrower.address, amount);
            let afterBorrowAmount = await usdc.balanceOf(borrower.address);
            let afterPoolAmount = await usdc.balanceOf(poolContract.address);

            let block = await ethers.provider.getBlock();
            let crs = await poolContract.creditRecordStaticMapping(borrower.address);
            let correction = calcCorrection(cr, crs, block.timestamp, amountUsedbyCorrection);
            cr = await poolContract.creditRecordMapping(borrower.address);

            expect(beforeBorrowAmount.sub(afterBorrowAmount)).to.equal(loanAmount.add(correction));
            expect(afterPoolAmount.sub(beforePoolAmount)).to.equal(loanAmount.add(correction));
            checkRecord(
                cr,
                crs,
                toUSDC(streamAmount),
                0,
                "SKIP",
                0,
                0,
                0,
                0,
                0,
                1217,
                streamDays,
                0,
                0
            );

            cr = await poolContract.creditRecordMapping(borrower.address);
            const expiration = 1000;
            const nts = cr.dueDate.toNumber() + expiration;
            block = await ethers.provider.getBlock();
            const beforeBorrowerFlowrate = await cfa.getNetFlow(usdcx.address, borrower.address);
            const beforeReceivedAmount = BN.from(nts)
                .sub(block.timestamp)
                .mul(beforeBorrowerFlowrate);
            await setNextBlockTimestamp(nts);

            const streamId = 1;
            let res = await nftContract.getTradableStreamData(streamId);
            const flowrate = res[6];

            beforeBorrowAmount = await usdc.balanceOf(borrower.address);
            beforePoolAmount = await usdc.balanceOf(poolContract.address);
            const beforeBorrowXAmount = await usdcx.balanceOf(borrower.address);
            const beforeProcessorFlowrate = await cfa.getNetFlow(
                usdcx.address,
                poolProcessorContract.address
            );
            await poolProcessorContract.payoff(nftContract.address, streamId);
            afterBorrowAmount = await usdc.balanceOf(borrower.address);
            afterPoolAmount = await usdc.balanceOf(poolContract.address);
            const afterBorrowXAmount = await usdcx.balanceOf(borrower.address);
            const afterProcessorFlowrate = await cfa.getNetFlow(
                usdcx.address,
                poolProcessorContract.address
            );
            const afterBorrowerFlowrate = await cfa.getNetFlow(usdcx.address, borrower.address);

            expect(afterBorrowAmount.sub(beforeBorrowAmount)).to.equal(loanAmount);
            expect(afterPoolAmount.sub(beforePoolAmount)).to.equal(0);
            expect(beforeProcessorFlowrate.sub(afterProcessorFlowrate)).to.equal(
                afterBorrowerFlowrate.sub(beforeBorrowerFlowrate)
            );
            expect(afterBorrowerFlowrate.sub(beforeBorrowerFlowrate)).to.equal(flowrate);

            await expect(nftContract.ownerOf(streamId)).to.be.revertedWith(
                "ERC721: invalid token ID"
            );

            const si = await poolProcessorContract.streamInfoMapping(
                nftContract.address,
                streamId
            );
            expect(afterBorrowXAmount.sub(beforeBorrowXAmount).sub(beforeReceivedAmount)).to.equal(
                si.flowrate.mul(BN.from(expiration))
            );

            cr = await poolContract.creditRecordMapping(borrower.address);
            crs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                cr,
                crs,
                toUSDC(streamAmount),
                0,
                "SKIP",
                0,
                0,
                0,
                0,
                0,
                1217,
                streamDays,
                0,
                0
            );
            checkResults(await poolContract.receivableInfoMapping(borrower.address), [
                ethers.constants.AddressZero,
                0,
                0,
            ]);
        });
    });

    describe("SuperApp", function () {
        beforeEach(async function () {
            await poolContract
                .connect(eaServiceAccount)
                ["approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"](
                    borrower.address,
                    toUSDC(streamAmount),
                    streamDays,
                    1,
                    1217,
                    nftContract.address,
                    ethers.utils.solidityKeccak256(
                        ["address", "address", "address"],
                        [usdcx.address, payer.address, borrower.address]
                    ),
                    toUSDC(streamAmount)
                );
            await usdc.connect(borrower).approve(poolProcessorContract.address, toUSDC(10_000));
            // const ts = Math.ceil(Date.now() / 1000) + 2;
            // await setNextBlockTimestamp(ts);
            let flowrate = toDefaultToken(collateralAmount)
                .div(BN.from(streamDuration))
                .add(BN.from(1));
            loanAmount = flowrate.mul(BN.from(streamDuration));
            console.log(`loanAmount: ${loanAmount}`);
            const nonce = await nftContract.nonces(borrower.address);
            const expiry = Math.ceil(Date.now() / 1000) + 300;
            const signatureData = await borrower._signTypedData(
                {
                    name: "TradableStream",
                    version: nftVersion,
                    chainId: HARDHAT_CHAIN_ID,
                    verifyingContract: nftContract.address,
                },
                {
                    MintToWithAuthorization: [
                        {name: "receiver", type: "address"},
                        {name: "token", type: "address"},
                        {name: "origin", type: "address"},
                        {name: "owner", type: "address"},
                        {name: "flowrate", type: "int96"},
                        {name: "durationInSeconds", type: "uint256"},
                        {name: "nonce", type: "uint256"},
                        {name: "expiry", type: "uint256"},
                    ],
                },
                {
                    receiver: borrower.address,
                    token: usdcx.address,
                    origin: payer.address,
                    owner: poolProcessorContract.address,
                    flowrate: flowrate,
                    durationInSeconds: streamDuration,
                    nonce: nonce,
                    expiry: expiry,
                }
            );
            const signature = ethers.utils.splitSignature(signatureData);
            const calldata = ethers.utils.defaultAbiCoder.encode(
                [
                    "address",
                    "address",
                    "address",
                    "int96",
                    "uint256",
                    "uint256",
                    "uint8",
                    "bytes32",
                    "bytes32",
                ],
                [
                    borrower.address,
                    usdcx.address,
                    payer.address,
                    flowrate,
                    streamDuration,
                    expiry,
                    signature.v,
                    signature.r,
                    signature.s,
                ]
            );
            await poolProcessorContract.mintAndDrawdown(
                borrower.address,
                loanAmount,
                nftContract.address,
                calldata
            );

            await sfRegisterContract.register(poolProcessorContract.address);
        });

        it("Should payoff and cr.state is delayed when flow was terminated during the loan period, and no enough allowance", async function () {
            let balance = await usdc.balanceOf(borrower.address);
            let remainingBal = toUSDC(50);
            if (balance.gt(remainingBal)) {
                await usdc
                    .connect(borrower)
                    .transfer(defaultDeployer.address, balance.sub(remainingBal));
            } else {
                remainingBal = balance;
            }

            let cr = await poolContract.creditRecordMapping(borrower.address);
            const remainingTime = 3600 * 24 * 7;
            let nts = cr.dueDate.toNumber() - remainingTime;
            await setNextBlockTimestamp(nts);
            console.log(`nts: ${nts}`);

            const streamId = 1;
            let beforeSI = await poolProcessorContract.streamInfoMapping(
                nftContract.address,
                streamId
            );
            let beforeBorrowerBal = await usdc.balanceOf(borrower.address);
            let beforePoolBal = await usdc.balanceOf(poolContract.address);
            await deleteFlow(usdcx, payer, poolProcessorContract);
            let afterBorrowerBal = await usdc.balanceOf(borrower.address);
            let afterPoolBal = await usdc.balanceOf(poolContract.address);
            let afterSI = await poolProcessorContract.streamInfoMapping(
                nftContract.address,
                streamId
            );

            expect(beforeBorrowerBal.sub(afterBorrowerBal)).to.equal(remainingBal);
            expect(afterPoolBal.sub(beforePoolBal)).to.equal(remainingBal);
            expect(afterSI.lastStartTime).to.equal(nts);
            expect(afterSI.flowrate).to.equal(0);
            expect(afterSI.endTime).to.equal(beforeSI.endTime);
            expect(afterSI.receivedFlowAmount).to.equal(
                BN.from(nts).sub(beforeSI.lastStartTime).mul(beforeSI.flowrate)
            );

            cr = await poolContract.creditRecordMapping(borrower.address);
            crs = await poolContract.creditRecordStaticMapping(borrower.address);
            let correction = calcCorrection(cr, crs, nts, remainingBal);
            checkRecord(
                cr,
                crs,
                toUSDC(streamAmount),
                0,
                "SKIP",
                correction,
                loanAmount.sub(remainingBal),
                0,
                0,
                0,
                1217,
                streamDays,
                3,
                0
            );

            const expiration = 1000;
            nts = cr.dueDate.toNumber() + expiration;
            await setNextBlockTimestamp(nts);

            beforeBorrowerBal = await usdc.balanceOf(borrower.address);
            beforePoolBal = await usdc.balanceOf(poolContract.address);
            cr = await poolContract.creditRecordMapping(borrower.address);
            let unbilled = cr.totalDue;
            await poolProcessorContract.payoff(nftContract.address, streamId);
            afterBorrowerBal = await usdc.balanceOf(borrower.address);
            afterPoolBal = await usdc.balanceOf(poolContract.address);

            expect(beforeBorrowerBal.sub(afterBorrowerBal)).to.equal(0);
            expect(afterPoolBal.sub(beforePoolBal)).to.equal(afterSI.receivedFlowAmount);

            cr = await poolContract.creditRecordMapping(borrower.address);
            crs = await poolContract.creditRecordStaticMapping(borrower.address);
            unbilled = unbilled.sub(afterSI.receivedFlowAmount).add(correction);
            let interest = calcInterest(crs, unbilled);
            checkRecord(
                cr,
                crs,
                toUSDC(streamAmount),
                0,
                "SKIP",
                0,
                unbilled.add(interest),
                interest,
                1,
                0,
                1217,
                streamDays,
                4,
                0
            );
        });

        it("Should payoff when flow was terminated during the loan period, and have enough allowance when payoff", async function () {
            let balance = await usdc.balanceOf(borrower.address);
            let remainingBal = toUSDC(100);
            if (balance.gt(remainingBal)) {
                await usdc
                    .connect(borrower)
                    .transfer(defaultDeployer.address, balance.sub(remainingBal));
            } else {
                remainingBal = balance;
            }

            let cr = await poolContract.creditRecordMapping(borrower.address);
            const remainingTime = 3600 * 24 * 7;
            let nts = cr.dueDate.toNumber() - remainingTime;
            await setNextBlockTimestamp(nts);

            const streamId = 1;
            let beforeSI = await poolProcessorContract.streamInfoMapping(
                nftContract.address,
                streamId
            );
            let beforeBorrowerBal = await usdc.balanceOf(borrower.address);
            let beforePoolBal = await usdc.balanceOf(poolContract.address);
            await deleteFlow(usdcx, payer, poolProcessorContract);
            let afterBorrowerBal = await usdc.balanceOf(borrower.address);
            let afterPoolBal = await usdc.balanceOf(poolContract.address);
            let afterSI = await poolProcessorContract.streamInfoMapping(
                nftContract.address,
                streamId
            );

            expect(beforeBorrowerBal.sub(afterBorrowerBal)).to.equal(remainingBal);
            expect(afterPoolBal.sub(beforePoolBal)).to.equal(remainingBal);
            expect(afterSI.lastStartTime).to.equal(nts);
            expect(afterSI.flowrate).to.equal(0);
            expect(afterSI.endTime).to.equal(beforeSI.endTime);
            expect(afterSI.receivedFlowAmount).to.equal(
                BN.from(nts).sub(beforeSI.lastStartTime).mul(beforeSI.flowrate)
            );

            cr = await poolContract.creditRecordMapping(borrower.address);
            crs = await poolContract.creditRecordStaticMapping(borrower.address);
            let correction = calcCorrection(cr, crs, nts, remainingBal);
            checkRecord(
                cr,
                crs,
                toUSDC(streamAmount),
                0,
                "SKIP",
                correction,
                loanAmount.sub(remainingBal),
                0,
                0,
                0,
                1217,
                streamDays,
                3,
                0
            );

            await mint(borrower.address, toUSDC(streamAmount));

            const expiration = 1000;
            nts = cr.dueDate.toNumber() + expiration;
            await setNextBlockTimestamp(nts);

            beforeBorrowerBal = await usdc.balanceOf(borrower.address);
            beforePoolBal = await usdc.balanceOf(poolContract.address);
            await poolProcessorContract.payoff(nftContract.address, streamId);
            afterBorrowerBal = await usdc.balanceOf(borrower.address);
            afterPoolBal = await usdc.balanceOf(poolContract.address);

            expect(afterPoolBal.sub(beforePoolBal)).to.equal(
                loanAmount.sub(remainingBal).add(correction)
            );
            expect(beforeBorrowerBal.sub(afterBorrowerBal)).to.equal(
                loanAmount.sub(remainingBal).sub(afterSI.receivedFlowAmount).add(correction)
            );

            cr = await poolContract.creditRecordMapping(borrower.address);
            crs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                cr,
                crs,
                toUSDC(streamAmount),
                0,
                "SKIP",
                0,
                0,
                0,
                0,
                0,
                1217,
                streamDays,
                0,
                0
            );
        });

        it("Should payoff when flow was terminated during the loan period, and have enough allowance when terminate flow", async function () {
            let balance = await usdc.balanceOf(borrower.address);
            if (balance.lt(loanAmount)) {
                await mint(borrower.address, loanAmount);
            }

            let cr = await poolContract.creditRecordMapping(borrower.address);
            const remainingTime = 3600 * 24 * 7;
            let nts = cr.dueDate.toNumber() - remainingTime;
            await setNextBlockTimestamp(nts);

            const streamId = 1;
            let beforeSI = await poolProcessorContract.streamInfoMapping(
                nftContract.address,
                streamId
            );
            let beforeBorrowerBal = await usdc.balanceOf(borrower.address);
            let beforePoolBal = await usdc.balanceOf(poolContract.address);
            await deleteFlow(usdcx, payer, poolProcessorContract);
            let afterBorrowerBal = await usdc.balanceOf(borrower.address);
            let afterPoolBal = await usdc.balanceOf(poolContract.address);
            let afterSI = await poolProcessorContract.streamInfoMapping(
                nftContract.address,
                streamId
            );

            let remainingBal = loanAmount.sub(afterSI.receivedFlowAmount);
            expect(beforeBorrowerBal.sub(afterBorrowerBal)).to.equal(remainingBal);
            expect(afterPoolBal.sub(beforePoolBal)).to.equal(remainingBal);
            expect(afterSI.lastStartTime).to.equal(nts);
            expect(afterSI.flowrate).to.equal(0);
            expect(afterSI.endTime).to.equal(beforeSI.endTime);
            expect(afterSI.receivedFlowAmount).to.equal(
                BN.from(nts).sub(beforeSI.lastStartTime).mul(beforeSI.flowrate)
            );

            cr = await poolContract.creditRecordMapping(borrower.address);
            crs = await poolContract.creditRecordStaticMapping(borrower.address);
            let correction = calcCorrection(cr, crs, nts, remainingBal);
            checkRecord(
                cr,
                crs,
                toUSDC(streamAmount),
                0,
                "SKIP",
                correction,
                loanAmount.sub(remainingBal),
                0,
                0,
                0,
                1217,
                streamDays,
                3,
                0
            );

            const expiration = 1000;
            nts = cr.dueDate.toNumber() + expiration;
            await setNextBlockTimestamp(nts);

            beforeBorrowerBal = await usdc.balanceOf(borrower.address);
            beforePoolBal = await usdc.balanceOf(poolContract.address);
            await poolProcessorContract.payoff(nftContract.address, streamId);
            afterBorrowerBal = await usdc.balanceOf(borrower.address);
            afterPoolBal = await usdc.balanceOf(poolContract.address);

            console.log(
                `beforeBorrowerBal: ${beforeBorrowerBal}, afterBorrowerBal: ${afterBorrowerBal}`
            );

            expect(afterPoolBal.sub(beforePoolBal)).to.equal(
                loanAmount.sub(remainingBal).add(correction)
            );
            expect(afterBorrowerBal.sub(beforeBorrowerBal)).to.equal(correction.mul(-1));

            cr = await poolContract.creditRecordMapping(borrower.address);
            crs = await poolContract.creditRecordStaticMapping(borrower.address);
            checkRecord(
                cr,
                crs,
                toUSDC(streamAmount),
                0,
                "SKIP",
                0,
                0,
                0,
                0,
                0,
                1217,
                streamDays,
                0,
                0
            );
        });
    });
});
