async function deployContracts(poolOwner, treasury, lender, fees = [1000, 100, 2000, 100]) {
    // Deploy HumaConfig
    const HumaConfig = await ethers.getContractFactory("HumaConfig");
    humaConfigContract = await HumaConfig.deploy(treasury.address);
    await humaConfigContract.setHumaTreasury(treasury.address);
    await humaConfigContract.setTreasuryFee(2000);
    await humaConfigContract.addPauser(poolOwner.address);
    await humaConfigContract.transferOwnership(poolOwner.address);

    // Deploy Fee Manager
    const feeManagerFactory = await ethers.getContractFactory("BaseFeeManager");
    feeManagerContract = await feeManagerFactory.deploy();
    await feeManagerContract.transferOwnership(poolOwner.address);
    await feeManagerContract.connect(poolOwner).setFees(fees[0], fees[1], fees[2], fees[3]);

    // Deploy TestToken, give initial tokens to lender
    const TestToken = await ethers.getContractFactory("TestToken");
    testTokenContract = await TestToken.deploy();

    return [humaConfigContract, feeManagerContract, testTokenContract];
}

async function deployAndSetupPool(
    poolOwner,
    proxyOwner,
    evaluationAgent,
    lender,
    humaConfigContract,
    feeManagerContract,
    testTokenContract,
    principalRateInBps
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
    await poolContract.initialize(
        hdtContract.address,
        humaConfigContract.address,
        feeManagerContract.address,
        "Base Credit Pool"
    );
    await poolContract.deployed();

    await hdtContract.setPool(poolContract.address);

    // Pool setup
    await poolContract.transferOwnership(poolOwner.address);

    // Config rewards and requirements for poolOwner and EA, make initial deposit, and enable pool
    await poolContract.connect(poolOwner).setPoolLiquidityCap(1_000_000_000);
    await poolContract.connect(poolOwner).setPoolOwnerRewardsAndLiquidity(625, 10);
    await poolContract.connect(poolOwner).setEvaluationAgent(evaluationAgent.address);
    await poolContract.connect(poolOwner).setEARewardsAndLiquidity(1875, 10);

    await testTokenContract.connect(poolOwner).approve(poolContract.address, 1_000_000);
    await poolContract.connect(poolOwner).makeInitialDeposit(1_000_000);

    await testTokenContract.connect(evaluationAgent).approve(poolContract.address, 2_000_000);
    await poolContract.connect(evaluationAgent).makeInitialDeposit(2_000_000);

    await poolContract.connect(poolOwner).enablePool();

    await poolContract.connect(poolOwner).setAPR(1217);
    await poolContract.connect(poolOwner).setMaxCreditLine(10_000_000);

    await testTokenContract.connect(lender).approve(poolContract.address, 2_000_000);
    await poolContract.connect(lender).deposit(2_000_000);

    return [hdtContract, poolContract];
}

module.exports = {
    deployContracts,
    deployAndSetupPool,
};
