const {BigNumber: BN} = require("ethers");
const {
    getInitilizedContract,
    updateInitilizedContract,
    getDeployedContracts,
    sendTransaction,
} = require("../utils.js");

let deployer, deployedContracts, lender, ea, eaService, pdsService, treasury, ea_bcp, invoicePayer;

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
        HUMA_OWNER_ADRESS,
    ]);

    await updateInitilizedContract("HumaConfig");
}

async function initFeeManager() {
    const initilized = await getInitilizedContract("ReceivableFactoringPoolFeeManager");
    if (initilized) {
        console.log("ReceivableFactoringPoolFeeManager is already initialized!");
        return;
    }

    if (!deployedContracts["ReceivableFactoringPoolFeeManager"]) {
        throw new Error("ReceivableFactoringPoolFeeManager not deployed yet!");
    }

    const BaseFeeManager = await hre.ethers.getContractFactory("BaseFeeManager");
    const feeManager = BaseFeeManager.attach(
        deployedContracts["ReceivableFactoringPoolFeeManager"]
    );

    await sendTransaction(
        "ReceivableFactoringPoolFeeManager",
        feeManager,
        "setFees",
        [0, 1000, 0, 1000, 0]
    );
    // await sendTransaction("FeeManager", feeManager, "setMinPrincipalRateInBps", [0]);

    await updateInitilizedContract("ReceivableFactoringPoolFeeManager");
}

async function initHDT() {
    const initilized = await getInitilizedContract("HDT");
    if (initilized) {
        console.log("HDT is already initialized!");
        return;
    }

    if (!deployedContracts["HDT"]) {
        throw new Error("HDT not deployed yet!");
    }

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["HDT"]);

    if (!deployedContracts["USDC"]) {
        throw new Error("USDC not deployed yet!");
    }

    if (!deployedContracts["ReceivableFactoringPool"]) {
        throw new Error("ReceivableFactoringPool not deployed yet!");
    }

    await sendTransaction("HDT", hdt, "initialize", [
        "Base HDT",
        "BHDT",
        deployedContracts["USDC"],
    ]);

    await sendTransaction("HDT", hdt, "setPool", [deployedContracts["ReceivableFactoringPool"]]);

    await updateInitilizedContract("HDT");
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

async function initPoolConfig() {
    const initilized = await getInitilizedContract("ReceivableFactoringPoolConfig");
    if (initilized) {
        console.log("ReceivableFactoringPoolConfig is already initialized!");
        return;
    }

    if (!deployedContracts["ReceivableFactoringPoolConfig"]) {
        throw new Error("ReceivableFactoringPoolConfig not deployed yet!");
    }

    const ReceivableFactoringPoolConfig = await hre.ethers.getContractFactory("BasePoolConfig");
    const poolConfig = ReceivableFactoringPoolConfig.attach(
        deployedContracts["ReceivableFactoringPoolConfig"]
    );

    if (!deployedContracts["ReceivableFactoringPool"]) {
        throw new Error("ReceivableFactoringPool not deployed yet!");
    }

    if (!deployedContracts["HDT"]) {
        throw new Error("HDT not deployed yet!");
    }

    if (!deployedContracts["HumaConfig"]) {
        throw new Error("HumaConfig not deployed yet!");
    }

    if (!deployedContracts["ReceivableFactoringPoolFeeManager"]) {
        throw new Error("ReceivableFactoringPoolFeeManager not deployed yet!");
    }

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["HDT"]);

    const HumaConfig = await hre.ethers.getContractFactory("HumaConfig");
    const humaConfig = HumaConfig.attach(deployedContracts["HumaConfig"]);

    const BaseFeeManager = await hre.ethers.getContractFactory("BaseFeeManager");
    const feeManager = BaseFeeManager.attach(
        deployedContracts["ReceivableFactoringPoolFeeManager"]
    );

    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "initialize", [
        "ReceivableFactoringPool",
        hdt.address,
        humaConfig.address,
        feeManager.address,
    ]);

    const decimals = await hdt.decimals();
    const cap = BN.from(1_000_000).mul(BN.from(10).pow(BN.from(decimals)));
    console.log("cap: " + cap);
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setPoolLiquidityCap", [
        cap,
    ]);

    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setPool", [
        deployedContracts["ReceivableFactoringPool"],
    ]);
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setEvaluationAgent", [
        1,
        ea.address,
    ]);

    await sendTransaction(
        "ReceivableFactoringPoolConfig",
        poolConfig,
        "setPoolOwnerRewardsAndLiquidity",
        [500, 200]
    );
    await sendTransaction(
        "ReceivableFactoringPoolConfig",
        poolConfig,
        "setEARewardsAndLiquidity",
        [1000, 100]
    );
    const maxCL = BN.from(1_000).mul(BN.from(10).pow(BN.from(decimals)));
    console.log("maxCL: " + maxCL);
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setMaxCreditLine", [
        maxCL,
    ]);
    await sendTransaction("ReceivableFactoringpoolConfig", poolConfig, "setAPR", [0]);
    await sendTransaction(
        "ReceivableFactoringpoolConfig",
        poolConfig,
        "setReceivableRequiredInBps",
        [12500]
    );
    await sendTransaction("ReceivableFactoringpoolConfig", poolConfig, "setPoolPayPeriod", [30]);
    await sendTransaction("ReceivableFactoringpoolConfig", poolConfig, "setPoolToken", [
        deployedContracts["HDT"],
    ]);
    await sendTransaction(
        "ReceivableFactoringpoolConfig",
        poolConfig,
        "setWithdrawalLockoutPeriod",
        [90]
    );
    await sendTransaction(
        "ReceivableFactoringpoolConfig",
        poolConfig,
        "setPoolDefaultGracePeriod",
        [60]
    );

    await updateInitilizedContract("ReceivableFactoringPoolConfig");
}

async function initPool() {
    const initilized = await getInitilizedContract("ReceivableFactoringPool");
    if (initilized) {
        console.log("ReceivableFactoringPool is already initialized!");
        return;
    }

    if (!deployedContracts["ReceivableFactoringPool"]) {
        throw new Error("ReceivableFactoringPool not deployed yet!");
    }

    if (!deployedContracts["ReceivableFactoringPoolConfig"]) {
        throw new Error("ReceivableFactoringPoolConfig not deployed yet!");
    }

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("ReceivableFactoringPool");
    const pool = ReceivableFactoringPool.attach(deployedContracts["ReceivableFactoringPool"]);

    await sendTransaction("ReceivableFactoringPool", pool, "initialize", [
        deployedContracts["ReceivableFactoringPoolConfig"],
    ]);

    await updateInitilizedContract("ReceivableFactoringPool");
}

async function prepare() {
    if (!deployedContracts["ReceivableFactoringPool"]) {
        throw new Error("ReceivableFactoringPool not deployed yet!");
    }
    if (!deployedContracts["USDC"]) {
        throw new Error("USDC not deployed yet!");
    }

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("ReceivableFactoringPool");
    const pool = ReceivableFactoringPool.attach(deployedContracts["ReceivableFactoringPool"]);

    await sendTransaction("ReceivableFactoringPool", pool, "addApprovedLender", [
        deployer.address,
    ]);
    await sendTransaction("ReceivableFactoringPool", pool, "addApprovedLender", [ea.address]);
    await sendTransaction("ReceivableFactoringPool", pool, "addApprovedLender", [lender.address]);

    const USDC = await hre.ethers.getContractFactory("TestToken");
    const usdc = USDC.attach(deployedContracts["USDC"]);
    const decimals = await usdc.decimals();

    // Owner
    const amountOwner = BN.from(20_000).mul(BN.from(10).pow(BN.from(decimals)));
    await sendTransaction("TestToken", usdc, "mint", [deployer.address, amountOwner]);
    await sendTransaction("TestToken", usdc, "approve", [pool.address, amountOwner]);
    await sendTransaction("ReceivableFactoringPool", pool, "makeInitialDeposit", [amountOwner]);

    // EA
    const usdcFromEA = await usdc.connect(ea);
    const poolFromEA = await pool.connect(ea);
    const amountEA = BN.from(10_000).mul(BN.from(10).pow(BN.from(decimals)));
    await sendTransaction("TestToken", usdc, "mint", [ea.address, amountEA]);
    await sendTransaction("TestToken", usdcFromEA, "approve", [pool.address, amountEA]);
    await sendTransaction("ReceivableFactoringPool", poolFromEA, "makeInitialDeposit", [amountEA]);

    await sendTransaction("ReceivableFactoringPool", pool, "enablePool", []);

    //invoicePayer
    const amountInvoicePayer = BN.from(10_000_000_000).mul(BN.from(10).pow(BN.from(decimals)));
    await sendTransaction("TestToken", usdc, "mint", [invoicePayer.address, amountInvoicePayer]);
}

async function initContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    [deployer, proxyOwner, lender, ea, eaService, pdsService, treasury, ea_bcp, invoicePayer] =
        await accounts;
    console.log("deployer address: " + deployer.address);
    console.log("lender address: " + lender.address);
    console.log("ea address: " + ea.address);

    deployedContracts = await getDeployedContracts();

    await initHumaConfig();
    await initFeeManager();
    await initHDT();
    await initEA();
    await initPoolConfig();
    await initPool();

    await prepare();
}

initContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
