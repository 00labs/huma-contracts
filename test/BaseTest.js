const {ethers} = require("hardhat");
const {use, expect} = require("chai");
const {solidity} = require("ethereum-waffle");

async function deployContracts(
    poolOwner,
    treasury,
    lender,
    protocolOwner,
    eaServiceAccount,
    pdsServiceAccount,
    fees = [1000, 100, 2000, 100, 0]
) {
    // Deploy EvaluationAgentNFT
    const EvaluationAgentNFT = await ethers.getContractFactory("EvaluationAgentNFT");
    eaNFTContract = await EvaluationAgentNFT.deploy();

    // Deploy HumaConfig
    const HumaConfig = await ethers.getContractFactory("HumaConfig");
    humaConfigContract = await HumaConfig.deploy(treasury.address);
    await humaConfigContract.setHumaTreasury(treasury.address);
    await humaConfigContract.setTreasuryFee(2000);
    await humaConfigContract.addPauser(poolOwner.address);
    await humaConfigContract.setEANFTContractAddress(eaNFTContract.address);
    await humaConfigContract.setEAServiceAccount(eaServiceAccount.address);
    await humaConfigContract.setPDSServiceAccount(pdsServiceAccount.address);

    await humaConfigContract.transferOwnership(protocolOwner.address);
    await humaConfigContract.connect(protocolOwner).unpauseProtocol();

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
    eaNFTContract
) {
    await testTokenContract.give1000To(lender.address);
    await testTokenContract.give1000To(poolOwner.address);
    await testTokenContract.give1000To(evaluationAgent.address);

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
    const poolConfig = await BasePoolConfig.deploy(
        "Base Credit Pool",
        hdtContract.address,
        humaConfigContract.address,
        feeManagerContract.address
    );
    await poolConfig.deployed();

    // Deploy BaseCreditPool
    const BaseCreditPool = await ethers.getContractFactory("BaseCreditPool");
    const poolImpl = await BaseCreditPool.deploy();
    await poolImpl.deployed();
    const poolProxy = await TransparentUpgradeableProxy.deploy(
        poolImpl.address,
        proxyOwner.address,
        []
    );
    await poolProxy.deployed();

    poolContract = BaseCreditPool.attach(poolProxy.address);
    await poolContract.initialize(poolConfig.address);
    await poolContract.deployed();

    await poolConfig.setPool(poolContract.address);
    await hdtContract.setPool(poolContract.address);

    // Pool setup
    await poolConfig.transferOwnership(poolOwner.address);

    // Config rewards and requirements for poolOwner and EA, make initial deposit, and enable pool
    await poolConfig.connect(poolOwner).setPoolLiquidityCap(1_000_000_000);
    await poolConfig.connect(poolOwner).setPoolOwnerRewardsAndLiquidity(625, 10);

    let eaNFTTokenId;
    // Mint EANFT to the borrower
    const tx = await eaNFTContract.mintNFT(evaluationAgent.address, "");
    const receipt = await tx.wait();
    for (const evt of receipt.events) {
        if (evt.event === "NFTGenerated") {
            eaNFTTokenId = evt.args.tokenId;
        }
    }

    await poolConfig.connect(poolOwner).setEvaluationAgent(eaNFTTokenId, evaluationAgent.address);
    let s = await poolConfig.getPoolSummary();

    await poolConfig.connect(poolOwner).setEARewardsAndLiquidity(1875, 10);

    await poolContract.connect(poolOwner).addApprovedLender(poolOwner.address);
    await poolContract.connect(poolOwner).addApprovedLender(evaluationAgent.address);
    await poolContract.connect(poolOwner).addApprovedLender(lender.address);

    await testTokenContract.connect(poolOwner).approve(poolContract.address, 1_000_000);
    await poolContract.connect(poolOwner).makeInitialDeposit(1_000_000);

    await testTokenContract.connect(evaluationAgent).approve(poolContract.address, 2_000_000);
    await poolContract.connect(evaluationAgent).makeInitialDeposit(2_000_000);

    await expect(poolContract.connect(poolOwner).enablePool()).to.emit(
        poolContract,
        "PoolEnabled"
    );

    await poolConfig.connect(poolOwner).setAPR(1217);
    await poolConfig.connect(poolOwner).setMaxCreditLine(10_000_000);

    await testTokenContract.connect(lender).approve(poolContract.address, 2_000_000);
    await poolContract.connect(lender).deposit(2_000_000);

    return [hdtContract, poolConfig, poolContract];
}

async function advanceClock(days) {
    await ethers.provider.send("evm_increaseTime", [3600 * 24 * days]);
    await ethers.provider.send("evm_mine", []);
}

async function checkRecord(r, rs, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12) {
    if (v1 != "SKIP") expect(rs.creditLimit).to.equal(v1);
    if (v2 != "SKIP") expect(r.unbilledPrincipal).to.equal(v2);
    if (v3 != "SKIP") expect(r.dueDate).to.be.within(v3 - 60, v3 + 60);
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

async function checkResult(r, v1, v2, v3, v4, v5) {
    expect(r.periodsPassed).to.equal(v1);
    expect(r.feesAndInterestDue).to.equal(v2);
    expect(r.totalDue).to.equal(v3);
    expect(r.unbilledPrincipal).to.equal(v4);
    expect(r.totalCharges).to.equal(v5);
}

module.exports = {
    deployContracts,
    deployAndSetupPool,
    advanceClock,
    checkRecord,
    checkResult,
};
