const {BigNumber: BN} = require("ethers");
const {
    getInitilizedContract,
    updateInitilizedContract,
    getDeployedContracts,
    sendTransaction,
} = require("../utils.js");

let deployer, deployedContracts, lender, ea, eaService, pdsService, treasury, ea_bcp;

const HUMA_OWNER_ADRESS='0x1931bD73055335Ba06efB22DB96169dbD4C5B4DB';

async function initHumaConfig() {
    const initilized = await getInitilizedContract("HumaConfig");
    if (initilized) {
        console.log("HumaConfig is already initialized!");
        return;
    }

    if (!deployedContracts["HumaConfig"]) {
        throw new Error("HumaConfig not deployed yet!");
    }

    if (!deployedContracts["HumaConfigTimelock"]) {
        throw new Error("HumaConfigTimelock not deployed yet!");
    }

    if (!deployedContracts["EANFT"]) {
        throw new Error("EANFT not deployed yet!");
    }

    if (!deployedContracts["USDC"]) {
        throw new Error("USDC not deployed yet!");
    }

    const HumaConfig = await hre.ethers.getContractFactory("HumaConfig");
    const humaConfig = HumaConfig.attach(deployedContracts["HumaConfig"]);

    const TimelockController = await hre.ethers.getContractFactory("TimelockController");
    const humaConfigTL = TimelockController.attach(deployedContracts["HumaConfigTimelock"]);

    await sendTransaction("HumaConfig", humaConfig, "setProtocolDefaultGracePeriod", [
        30 * 24 * 3600,
    ]);
    await sendTransaction("HumaConfig", humaConfig, "setTreasuryFee", [500]);
    await sendTransaction("HumaConfig", humaConfig, "setEANFTContractAddress", [
        deployedContracts["EANFT"],
    ]);

    await sendTransaction("HumaConfig", humaConfig, "setEAServiceAccount", [eaService.address]);
    await sendTransaction("HumaConfig", humaConfig, "setPDSServiceAccount", [pdsService.address]);

    const USDC = await hre.ethers.getContractFactory("TestToken");
    const usdc = USDC.attach(deployedContracts["USDC"]);

    // Add usdc as an asset supported by the protocol
    await sendTransaction("HumaConfig", humaConfig, "setLiquidityAsset", [usdc.address, true]);

    // Set treasury for the protocol
    await sendTransaction("HumaConfig", humaConfig, "setHumaTreasury", [treasury.address]);

    await sendTransaction("HumaConfig", humaConfig, "transferOwnership", [humaConfigTL.address]);
    const adminRole = await humaConfigTL.TIMELOCK_ADMIN_ROLE();
    await sendTransaction("HumaConfigTimelock", humaConfigTL, "renounceRole", [
        adminRole,
        deployer.address,
    ]);

    await updateInitilizedContract("HumaConfig");
}

async function initEA() {
    const initilized = await getInitilizedContract("EANFT");
    if (initilized) {
        console.log("EANFT is already initialized!");
        return;
    }

    if (!deployedContracts["EANFT"]) {
        throw new Error("EANFT not deployed yet!");
    }

    const EANFT = await hre.ethers.getContractFactory("EvaluationAgentNFT");
    const eaNFT = EANFT.attach(deployedContracts["EANFT"]);

    const eaNFTFromEA = eaNFT.connect(ea);
    await sendTransaction("EvaluationAgentNFT", eaNFTFromEA, "mintNFT", [ea.address]);
    const eaNFTFromEA_bcp = eaNFT.connect(ea);
    await sendTransaction("EvaluationAgentNFT", eaNFTFromEA_bcp, "mintNFT", [ea_bcp.address]);
    await updateInitilizedContract("EANFT");
}

async function initBaseCreditPoolFeeManager() {
    const initilized = await getInitilizedContract("BaseCreditPoolFeeManager");
    if (initilized) {
        console.log("BaseCreditPoolFeeManager is already initialized!");
        return;
    }

    if (!deployedContracts["BaseCreditPoolFeeManager"]) {
        throw new Error("BaseCreditPoolFeeManager not deployed yet!");
    }

    const BaseFeeManager = await hre.ethers.getContractFactory("BaseFeeManager");
    const feeManager = BaseFeeManager.attach(deployedContracts["BaseCreditPoolFeeManager"]);

    await sendTransaction(
        "BaseCreditPoolFeeManager",
        feeManager,
        "setFees",
        [10_000_000, 0, 20_000_000, 0, 5_000_000]
    );
    // await sendTransaction("FeeManager", feeManager, "setMinPrincipalRateInBps", [0]);

    await updateInitilizedContract("BaseCreditPoolFeeManager");
}

async function initBaseCreditPoolHDT() {
    const initilized = await getInitilizedContract("BaseCreditHDT");
    if (initilized) {
        console.log("BaseCreditHDT is already initialized!");
        return;
    }

    if (!deployedContracts["BaseCreditHDT"]) {
        throw new Error("BaseCreditHDT not deployed yet!");
    }

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["BaseCreditHDT"]);

    if (!deployedContracts["USDC"]) {
        throw new Error("USDC not deployed yet!");
    }

    if (!deployedContracts["BaseCreditPool"]) {
        throw new Error("BaseCreditPool not deployed yet!");
    }

    await sendTransaction("HDT", hdt, "initialize", [
        "Base HDT",
        "BHDT",
        deployedContracts["USDC"],
    ]);

    await sendTransaction("HDT", hdt, "setPool", [deployedContracts["BaseCreditPool"]]);

    await updateInitilizedContract("BaseCreditHDT");
}

async function initBaseCreditPoolConfig() {
    const initilized = await getInitilizedContract("BaseCreditPoolConfig");
    if (initilized) {
        console.log("BaseCreditPoolConfig is already initialized!");
        return;
    }

    if (!deployedContracts["BaseCreditPoolConfig"]) {
        throw new Error("BaseCreditPoolConfig not deployed yet!");
    }

    const ReceivableFactoringPoolConfig = await hre.ethers.getContractFactory("BasePoolConfig");
    const poolConfig = ReceivableFactoringPoolConfig.attach(
        deployedContracts["BaseCreditPoolConfig"]
    );

    if (!deployedContracts["BaseCreditPool"]) {
        throw new Error("BaseCreditPool not deployed yet!");
    }

    if (!deployedContracts["BaseCreditHDT"]) {
        throw new Error("BaseCreditHDT not deployed yet!");
    }

    if (!deployedContracts["HumaConfig"]) {
        throw new Error("HumaConfig not deployed yet!");
    }

    if (!deployedContracts["BaseCreditPoolFeeManager"]) {
        throw new Error("BaseCreditPoolFeeManager not deployed yet!");
    }

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["BaseCreditHDT"]);

    const HumaConfig = await hre.ethers.getContractFactory("HumaConfig");
    const humaConfig = HumaConfig.attach(deployedContracts["HumaConfig"]);

    const BaseFeeManager = await hre.ethers.getContractFactory("BaseFeeManager");
    const feeManager = BaseFeeManager.attach(deployedContracts["BaseCreditPoolFeeManager"]);

    await sendTransaction("BaseCreditPoolConfig", poolConfig, "initialize", [
        "BaseCreditPool",
        hdt.address,
        humaConfig.address,
        feeManager.address,
    ]);

    const decimals = await hdt.decimals();
    const cap = BN.from(1_000_000).mul(BN.from(10).pow(BN.from(decimals)));
    console.log("cap: " + cap);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setPoolLiquidityCap", [cap]);

    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setPool", [
        deployedContracts["BaseCreditPool"],
    ]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setEvaluationAgent", [
        2,
        ea_bcp.address,
    ]);

    await sendTransaction(
        "BaseCreditPoolConfig",
        poolConfig,
        "setPoolOwnerRewardsAndLiquidity",
        [500, 200]
    );
    await sendTransaction(
        "BaseCreditPoolConfig",
        poolConfig,
        "setEARewardsAndLiquidity",
        [1000, 100]
    );
    const maxCL = BN.from(10_000).mul(BN.from(10).pow(BN.from(decimals)));
    console.log("maxCL: " + maxCL);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setMaxCreditLine", [maxCL]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setAPR", [1000]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setReceivableRequiredInBps", [0]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setPoolPayPeriod", [15]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setPoolToken", [
        deployedContracts["BaseCreditHDT"],
    ]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setWithdrawalLockoutPeriod", [1]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setPoolDefaultGracePeriod", [60]);

    await updateInitilizedContract("BaseCreditPoolConfig");
}

async function initBaseCreditPool() {
    const initilized = await getInitilizedContract("BaseCreditPool");
    if (initilized) {
        console.log("BaseCreditPool is already initialized!");
        return;
    }

    if (!deployedContracts["BaseCreditPool"]) {
        throw new Error("BaseCreditPool not deployed yet!");
    }

    if (!deployedContracts["BaseCreditPoolConfig"]) {
        throw new Error("BaseCreditPoolConfig not deployed yet!");
    }

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("BaseCreditPool");
    const pool = ReceivableFactoringPool.attach(deployedContracts["BaseCreditPool"]);

    await sendTransaction("BaseCreditPool", pool, "initialize", [
        deployedContracts["BaseCreditPoolConfig"],
    ]);

    await updateInitilizedContract("BaseCreditPool");
}

async function prepareBaseCreditPool() {
    if (!deployedContracts["BaseCreditPool"]) {
        throw new Error("BaseCreditPool not deployed yet!");
    }
    if (!deployedContracts["USDC"]) {
        throw new Error("USDC not deployed yet!");
    }

    const BaseCreditPool = await hre.ethers.getContractFactory("BaseCreditPool");
    const pool = BaseCreditPool.attach(deployedContracts["BaseCreditPool"]);

    await sendTransaction("BaseCreditPool", pool, "addApprovedLender", [deployer.address]);
    await sendTransaction("BaseCreditPool", pool, "addApprovedLender", [ea_bcp.address]);
    await sendTransaction("BaseCreditPool", pool, "addApprovedLender", [lender.address]);

    const USDC = await hre.ethers.getContractFactory("TestToken");
    const usdc = USDC.attach(deployedContracts["USDC"]);
    const decimals = await usdc.decimals();

    // Owner
    const amountOwner = BN.from(20_000).mul(BN.from(10).pow(BN.from(decimals)));
    await sendTransaction("TestToken", usdc, "mint", [deployer.address, amountOwner]);
    await sendTransaction("TestToken", usdc, "approve", [pool.address, amountOwner]);
    await sendTransaction("BaseCreditPool", pool, "makeInitialDeposit", [amountOwner]);

    // EA
    const usdcFromEA = await usdc.connect(ea_bcp);
    const poolFromEA = await pool.connect(ea_bcp);
    const amountEA = BN.from(10_000).mul(BN.from(10).pow(BN.from(decimals)));
    await sendTransaction("TestToken", usdc, "mint", [ea_bcp.address, amountEA]);
    await sendTransaction("TestToken", usdcFromEA, "approve", [poolFromEA.address, amountEA]);
    await sendTransaction("BaseCreditPool", poolFromEA, "makeInitialDeposit", [amountEA]);

    await sendTransaction("BaseCreditPool", pool, "enablePool", []);
}

async function initContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    [deployer, proxyOwner, lender, ea, eaService, pdsService, treasury, ea_bcp] = await accounts;
    console.log("deployer address: " + deployer.address);
    console.log("lender address: " + lender.address);
    console.log("ea address: " + ea.address);

    deployedContracts = await getDeployedContracts();

    await initHumaConfig();
    await initEA();
    await initBaseCreditPoolFeeManager();
    await initBaseCreditPoolHDT();
    await initBaseCreditPoolConfig();
    await initBaseCreditPool();

    await prepareBaseCreditPool();
}

initContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
