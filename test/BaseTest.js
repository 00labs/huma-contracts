const {ethers} = require("hardhat");
const {use, expect} = require("chai");
const {solidity} = require("ethereum-waffle");

async function deployContracts(
    poolOwner,
    treasury,
    lender,
    protocolOwner,
    fees = [1000, 100, 2000, 100]
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

    await humaConfigContract.transferOwnership(protocolOwner.address);
    await humaConfigContract.connect(protocolOwner).unpauseProtocol();

    // Deploy Fee Manager
    const feeManagerFactory = await ethers.getContractFactory("BaseFeeManager");
    feeManagerContract = await feeManagerFactory.deploy();
    await feeManagerContract.transferOwnership(poolOwner.address);
    await feeManagerContract.connect(poolOwner).setFees(fees[0], fees[1], fees[2], fees[3]);

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

    let eaNFTTokenId;
    // Mint EANFT to the borrower
    const tx = await eaNFTContract.mint(evaluationAgent.address, "");
    const receipt = await tx.wait();
    for (const evt of receipt.events) {
        if (evt.event === "EANFTGenerated") {
            eaNFTTokenId = evt.args[0];
        }
    }
    await poolContract
        .connect(poolOwner)
        .setEvaluationAgent(eaNFTTokenId, evaluationAgent.address);

    await poolContract.connect(poolOwner).setEARewardsAndLiquidity(1875, 10);

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

    await poolContract.connect(poolOwner).setAPR(1217);
    await poolContract.connect(poolOwner).setMaxCreditLine(10_000_000);

    await testTokenContract.connect(lender).approve(poolContract.address, 2_000_000);
    await poolContract.connect(lender).deposit(2_000_000);

    return [hdtContract, poolContract];
}

async function advanceClock(days) {
    await ethers.provider.send("evm_increaseTime", [3600 * 24 * days]);
    await ethers.provider.send("evm_mine", []);
}

module.exports = {
    deployContracts,
    deployAndSetupPool,
    advanceClock,
};
