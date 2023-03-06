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
} = require("./BaseTest");

require("dotenv").config();

const GOERLI_CHAIN_ID = 5;

const POLYGON_USDC_MAP_SLOT = "0x0";
const GOERLI_USDC_MAP_SLOT = "0x0";

let polygonUrl = process.env["POLYGON_URL"];
let goerliUrl = process.env["GOERLI_URL"];

const POLYGON_USDC_ADDRESS = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";
const POLYGON_SF_USDCX_ADDRESS = "0xCAa7349CEA390F89641fe306D93591f87595dc1F";
const POLYGON_SF_HOST_ADDRESS = "0x3E14dC1b13c488a8d5D310918780c983bD5982E7";
const POLYGON_SF_CFA_ADDRESS = "0x6EeE6060f715257b970700bc2656De21dEdF074C";

const GOERLI_USDC_ADDRESS = "0xc94dd466416A7dFE166aB2cF916D3875C049EBB7";
const GOERLI_SF_USDCX_ADDRESS = "0x8aE68021f6170E5a766bE613cEA0d75236ECCa9a";
const GOERLI_SF_HOST_ADDRESS = "0x22ff293e14F1EC3A09B137e9e06084AFd63adDF9";
const GOERLI_SF_CFA_ADDRESS = "0xEd6BcbF6907D4feEEe8a8875543249bEa9D308E8";

// let chainUrl = polygonUrl;
// let usdcMapSlot = POLYGON_USDC_MAP_SLOT;
// let usdcDecimals = 6;

// let usdcAddress = POLYGON_USDC_ADDRESS;
// let sfUsdcxAddress = POLYGON_SF_USDCX_ADDRESS;
// let sfHostAddress = POLYGON_SF_HOST_ADDRESS;
// let sfCFAAddress = POLYGON_SF_CFA_ADDRESS;

let chainUrl = goerliUrl;
let usdcMapSlot = GOERLI_USDC_MAP_SLOT;
let usdcDecimals = 18;

let usdcAddress = GOERLI_USDC_ADDRESS;
let sfUsdcxAddress = GOERLI_SF_USDCX_ADDRESS;
let sfHostAddress = GOERLI_SF_HOST_ADDRESS;
let sfCFAAddress = GOERLI_SF_CFA_ADDRESS;

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
    nftContract;

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
    const feeManagerFactory = await ethers.getContractFactory("StreamFeeManager");
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
    const poolContractFactory = await ethers.getContractFactory("SuperfluidFactoringPool");

    const poolImpl = await poolContractFactory.deploy();
    //const BaseCreditPool = await ethers.getContractFactory("BaseCreditPool");
    //const poolImpl = await BaseCreditPool.deploy();
    await poolImpl.deployed();
    const poolProxy = await TransparentUpgradeableProxy.deploy(
        poolImpl.address,
        proxyOwner.address,
        []
    );
    await poolProxy.deployed();

    const poolContract = poolContractFactory.attach(poolProxy.address);
    await poolContract.initialize(poolConfig.address);
    await poolContract.deployed();

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

    return [feeManagerContract, hdtContract, poolConfig, poolContract, poolImpl, poolProxy];
}

describe("Superfluid Factoring", function () {
    before(async function () {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: chainUrl,
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
        nftContract = await nftContractFactory.deploy(GOERLI_CHAIN_ID, sfHostAddress);
        await nftContract.deployed();
    });

    let streamAmount, streamDays, streamDuration, collateralAmount, streamId;

    async function prepare() {
        [humaConfigContract, eaNFTContract] = await deployContracts(
            poolOwner,
            treasury,
            protocolOwner,
            eaServiceAccount,
            pdsServiceAccount,
            usdc
        );

        [feeManagerContract, hdtContract, poolConfigContract, poolContract] =
            await deployAndSetupPool(
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

    describe("drawdownWithReceivable", function () {
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

    describe("drawdownWithAuthorization", function () {
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

        it.only("Should drawdown with authorization", async function () {
            await usdc.connect(borrower).approve(poolContract.address, toUSDC(10_000));

            let flowrate = toDefaultToken(collateralAmount)
                .div(BN.from(streamDuration))
                .add(BN.from(1));

            let nonce = await nftContract.nonces(borrower.address);
            console.log(`nonce: ${nonce}`);

            const version = await nftContract.version();
            const expiry = Math.ceil(Date.now() / 1000) + 300;

            const signatureData = await borrower._signTypedData(
                {
                    name: "TradableStream",
                    version: version,
                    chainId: GOERLI_CHAIN_ID,
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
                    owner: poolContract.address,
                    flowrate: flowrate,
                    durationInSeconds: streamDuration,
                    nonce: nonce,
                    expiry: expiry,
                }
            );

            console.log(`signatureData: ${signatureData}`);

            const signature = ethers.utils.splitSignature(signatureData);
            console.log(`signature: ${JSON.stringify(signature)}`);

            const calldata = nftContract.interface.encodeFunctionData("mintToWithAuthorization", [
                borrower.address,
                usdcx.address,
                payer.address,
                poolContract.address,
                flowrate,
                streamDuration,
                nonce,
                expiry,
                signature.v,
                signature.r,
                signature.s,
            ]);

            await poolContract.drawdownWithAuthorization(
                toUSDC(collateralAmount),
                nftContract.address,
                calldata
            );

            // await nftContract.mintToWithAuthorization(
            //     borrower.address,
            //     usdcx.address,
            //     payer.address,
            //     poolContract.address,
            //     flowrate,
            //     streamDuration,
            //     nonce,
            //     expiry,
            //     signature.v,
            //     signature.r,
            //     signature.s
            // );
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

            await usdc.connect(borrower).approve(poolContract.address, toUSDC(10_000));

            // const ts = Math.ceil(Date.now() / 1000) + 2;
            // await setNextBlockTimestamp(ts);
            await poolContract
                .connect(borrower)
                .drawdownWithReceivable(toUSDC(collateralAmount), nftContract.address, streamId);
        });

        it("Should payoff", async function () {
            let cr = await poolContract.creditRecordMapping(borrower.address);
            const nts = cr.dueDate.toNumber() + 10000;

            let block = await ethers.provider.getBlock();
            const beforeBorrowerFlowrate = await cfa.getNetFlow(usdcx.address, borrower.address);
            const beforeReceivedAmount = BN.from(nts)
                .sub(block.timestamp)
                .mul(beforeBorrowerFlowrate);

            await setNextBlockTimestamp(nts);

            let res = await nftContract.getTradableStreamData(streamId);
            const flowrate = res[6];

            const beforeBorrowAmount = await usdc.balanceOf(borrower.address);
            const beforePoolAmount = await usdc.balanceOf(poolContract.address);
            const beforeBorrowXAmount = await usdcx.balanceOf(borrower.address);
            const beforePoolFlowrate = await cfa.getNetFlow(usdcx.address, poolContract.address);
            await poolContract.payoff(nftContract.address, streamId);
            const afterBorrowAmount = await usdc.balanceOf(borrower.address);
            const afterPoolAmount = await usdc.balanceOf(poolContract.address);
            const afterBorrowXAmount = await usdcx.balanceOf(borrower.address);
            const afterPoolFlowrate = await cfa.getNetFlow(usdcx.address, poolContract.address);
            const afterBorrowerFlowrate = await cfa.getNetFlow(usdcx.address, borrower.address);

            expect(afterBorrowAmount.sub(beforeBorrowAmount)).to.equal(
                convertDefaultToUSDC(flowrate.mul(BN.from(streamDuration))).sub(
                    toUSDC(collateralAmount)
                )
            );
            expect(afterPoolAmount.sub(beforePoolAmount)).to.equal(toUSDC(collateralAmount));
            expect(beforePoolFlowrate.sub(afterPoolFlowrate)).to.equal(
                afterBorrowerFlowrate.sub(beforeBorrowerFlowrate)
            );
            expect(afterBorrowerFlowrate.sub(beforeBorrowerFlowrate)).to.equal(flowrate);

            await expect(nftContract.ownerOf(streamId)).to.be.revertedWith(
                "ERC721: invalid token ID"
            );

            const sr = await poolContract.streamInfoMapping(nftContract.address, streamId);
            expect(afterBorrowXAmount.sub(beforeBorrowXAmount).sub(beforeReceivedAmount)).to.equal(
                sr.flowrate.mul(BN.from(10000))
            );

            cr = await poolContract.creditRecordMapping(borrower.address);
            const crs = await poolContract.creditRecordStaticMapping(borrower.address);
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
                0,
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
});
