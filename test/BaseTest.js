const {ethers, network} = require("hardhat");
const {expect} = require("chai");
const {BigNumber: BN} = require("ethers");
const {hasRestParameter} = require("typescript");

function toBN(number, decimals) {
    return BN.from(number).mul(BN.from(10).pow(BN.from(decimals)));
}

function toToken(number) {
    return toBN(number, 6);
}

async function deployContracts(
    poolOwner,
    treasury,
    lender,
    protocolOwner,
    eaServiceAccount,
    pdsServiceAccount,
    fees = [toToken(1000), 100, toToken(2000), 100, 0]
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

    // Deploy Fee Manager
    const feeManagerFactory = await ethers.getContractFactory("BaseFeeManager");
    feeManagerContract = await feeManagerFactory.deploy();
    await feeManagerContract.transferOwnership(poolOwner.address);
    await feeManagerContract
        .connect(poolOwner)
        .setFees(fees[0], fees[1], fees[2], fees[3], fees[4]);

    // Deploy TestToken, give initial tokens to lender
    const TestToken = await ethers.getContractFactory("TestToken");
    testTokenContract = await TestToken.deploy();

    await humaConfigContract
        .connect(protocolOwner)
        .setLiquidityAsset(testTokenContract.address, true);

    return [humaConfigContract, feeManagerContract, testTokenContract, eaNFTContract];
}

async function deployAndSetupPool(
    poolOwner,
    proxyOwner,
    evaluationAgent,
    lender,
    humaConfigContract,
    feeManagerContract,
    testTokenContract,
    principalRateInBps,
    eaNFTContract,
    isReceivableContractFlag,
    poolOperator,
    poolOwnerTreasury
) {
    await testTokenContract.mint(lender.address, toToken(10_000_000));
    await testTokenContract.mint(poolOwnerTreasury.address, toToken(10_000_000));
    await testTokenContract.mint(evaluationAgent.address, toToken(10_000_000));

    await feeManagerContract.connect(poolOwner).setMinPrincipalRateInBps(principalRateInBps);

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
    hdtContract = HDT.attach(hdtProxy.address);
    await hdtContract.initialize("Base Credit HDT", "CHDT", testTokenContract.address);

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
    let poolContractFactory;
    if (isReceivableContractFlag)
        poolContractFactory = await ethers.getContractFactory("ReceivableFactoringPool");
    else poolContractFactory = await ethers.getContractFactory("BaseCreditPool");

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
    await poolConfig.connect(poolOwner).setPoolLiquidityCap(toToken(1_000_000_000));
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

    await testTokenContract
        .connect(poolOwnerTreasury)
        .approve(poolContract.address, toToken(1_000_000));
    await poolContract.connect(poolOwnerTreasury).makeInitialDeposit(toToken(1_000_000));

    await testTokenContract
        .connect(evaluationAgent)
        .approve(poolContract.address, toToken(2_000_000));
    await poolContract.connect(evaluationAgent).makeInitialDeposit(toToken(2_000_000));

    await expect(poolContract.connect(poolOwner).enablePool()).to.emit(
        poolContract,
        "PoolEnabled"
    );

    await poolConfig.connect(poolOwner).setAPR(1217);
    await poolConfig.connect(poolOwner).setMaxCreditLine(toToken(10_000_000));

    await testTokenContract.connect(lender).approve(poolContract.address, toToken(2_000_000));
    await poolContract.connect(lender).deposit(toToken(2_000_000));

    return [hdtContract, poolConfig, poolContract, poolImpl, poolProxy];
}

async function getCreditInfo(poolContract, account) {
    const cr = await poolContract.creditRecordMapping(account);
    const crs = await poolContract.creditRecordStaticMapping(account);

    return {...cr, ...crs};
}

async function advanceClock(days) {
    await ethers.provider.send("evm_increaseTime", [3600 * 24 * days]);
    await ethers.provider.send("evm_mine", []);
}

async function setNextBlockTimestamp(nextTS) {
    await network.provider.request({
        method: "evm_setNextBlockTimestamp",
        params: [nextTS],
    });
}

async function mineNextBlockWithTimestamp(nextTS) {
    await network.provider.request({
        method: "evm_setNextBlockTimestamp",
        params: [nextTS],
    });
    await network.provider.send("evm_mine", []);
}

async function evmSnapshot() {
    return await network.provider.request({
        method: "evm_snapshot",
        params: [],
    });
}

async function evmRevert(sId) {
    const res = await network.provider.request({
        method: "evm_revert",
        params: [sId],
    });
    if (!res) {
        console.log(`emvRevert failed: ${sId}`);
    }
    return res;
}

function checkRecord(r, rs, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12) {
    if (v1 != "SKIP") expect(rs.creditLimit).to.equal(v1);
    if (v2 != "SKIP") expect(r.unbilledPrincipal).to.equal(v2);
    if (v3 != "SKIP") expect(r.dueDate).to.be.equal(v3);
    if (v4 != "SKIP") expect(r.correction).to.equal(v4); //be.within(v4 - 1, v4 + 1);
    if (v5 != "SKIP") expect(r.totalDue).to.equal(v5);
    if (v6 != "SKIP") expect(r.feesAndInterestDue).to.equal(v6);
    if (v7 != "SKIP") expect(r.missedPeriods).to.equal(v7);
    if (v8 != "SKIP") expect(r.remainingPeriods).to.equal(v8);
    if (v9 != "SKIP") expect(rs.aprInBps).to.equal(v9);
    if (v10 != "SKIP") expect(rs.intervalInDays).to.equal(v10);
    if (v11 != "SKIP") expect(r.state).to.equal(v11);
    if (v12 != "SKIP") expect(rs.defaultAmount).to.equal(v12);
}

function checkResult(r, v1, v2, v3, v4, v5) {
    expect(r.periodsPassed).to.equal(v1);
    expect(r.feesAndInterestDue).to.equal(v2);
    expect(r.totalDue).to.equal(v3);
    expect(r.unbilledPrincipal).to.equal(v4);
    expect(r.totalCharges).to.equal(v5);
}

function checkArruedIncome(r, v1, v2, v3) {
    expect(r.protocolIncome).to.equal(v1);
    expect(r.eaIncome).to.equal(v2);
    expect(r.poolOwnerIncome).to.equal(v3);
}

module.exports = {
    deployContracts,
    deployAndSetupPool,
    advanceClock,
    checkRecord,
    checkResult,
    checkArruedIncome,
    getCreditInfo,
    toToken,
    setNextBlockTimestamp,
    mineNextBlockWithTimestamp,
    evmSnapshot,
    evmRevert,
};
