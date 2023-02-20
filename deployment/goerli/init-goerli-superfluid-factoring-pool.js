const {BigNumber: BN} = require("ethers");
const {
    getInitilizedContract,
    updateInitilizedContract,
    getDeployedContracts,
    sendTransaction,
} = require("../utils.js");

let deployer, deployedContracts, lender, ea, eaService;
let pdsService, treasury, ea_bcp, bcpOperator, rfpOperator;
let bcpOwnerTreasury, rfpOwnerTreasury;
let payer;

const USDC_ADDRESS = "0xc94dd466416A7dFE166aB2cF916D3875C049EBB7";

const HUMA_OWNER_ADRESS = "0x1931bD73055335Ba06efB22DB96169dbD4C5B4DB";

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
    const initilized = await getInitilizedContract("SuperfluidFactoringPoolFeeManager");
    if (initilized) {
        console.log("SuperfluidFactoringPoolFeeManager is already initialized!");
        return;
    }

    if (!deployedContracts["SuperfluidFactoringPoolFeeManager"]) {
        throw new Error("SuperfluidFactoringPoolFeeManager not deployed yet!");
    }

    const StreamFeeManager = await hre.ethers.getContractFactory("StreamFeeManager");
    const feeManager = StreamFeeManager.attach(
        deployedContracts["SuperfluidFactoringPoolFeeManager"]
    );

    // await sendTransaction(
    //     "SuperfluidFactoringPoolFeeManager",
    //     feeManager,
    //     "setFees",
    //     [0, 0, 0, 0, 0]
    // );
    // await sendTransaction(
    //     "SuperfluidFactoringPoolFeeManager",
    //     feeManager,
    //     "setMinPrincipalRateInBps",
    //     [0]
    // );

    await updateInitilizedContract("SuperfluidFactoringPoolFeeManager");
}

async function initHDT() {
    const initilized = await getInitilizedContract("SuperfluidPoolHDT");
    if (initilized) {
        console.log("SuperfluidPoolHDT is already initialized!");
        return;
    }

    if (!deployedContracts["SuperfluidPoolHDT"]) {
        throw new Error("SuperfluidPoolHDT not deployed yet!");
    }

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["SuperfluidPoolHDT"]);

    if (!deployedContracts["SuperfluidFactoringPool"]) {
        throw new Error("SuperfluidFactoringPool not deployed yet!");
    }

    await sendTransaction("SuperfluidPoolHDT", hdt, "initialize", [
        "Superfluid HDT",
        "SFHDT",
        USDC_ADDRESS,
    ]);

    await sendTransaction("SuperfluidPoolHDT", hdt, "setPool", [
        deployedContracts["SuperfluidFactoringPool"],
    ]);

    await updateInitilizedContract("SuperfluidPoolHDT");
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
    const initilized = await getInitilizedContract("SuperfluidFactoringPoolConfig");
    if (initilized) {
        console.log("SuperfluidFactoringPoolConfig is already initialized!");
        return;
    }

    if (!deployedContracts["SuperfluidFactoringPoolConfig"]) {
        throw new Error("SuperfluidFactoringPoolConfig not deployed yet!");
    }

    const BasePoolConfig = await hre.ethers.getContractFactory("BasePoolConfig");
    const poolConfig = BasePoolConfig.attach(deployedContracts["SuperfluidFactoringPoolConfig"]);

    if (!deployedContracts["ReceivableFactoringPool"]) {
        throw new Error("ReceivableFactoringPool not deployed yet!");
    }

    if (!deployedContracts["SuperfluidPoolHDT"]) {
        throw new Error("SuperfluidPoolHDT not deployed yet!");
    }

    if (!deployedContracts["HumaConfig"]) {
        throw new Error("HumaConfig not deployed yet!");
    }

    if (!deployedContracts["SuperfluidFactoringPoolFeeManager"]) {
        throw new Error("SuperfluidFactoringPoolFeeManager not deployed yet!");
    }

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["SuperfluidPoolHDT"]);

    const HumaConfig = await hre.ethers.getContractFactory("HumaConfig");
    const humaConfig = HumaConfig.attach(deployedContracts["HumaConfig"]);

    const StreamFeeManager = await hre.ethers.getContractFactory("StreamFeeManager");
    const feeManager = StreamFeeManager.attach(
        deployedContracts["SuperfluidFactoringPoolFeeManager"]
    );

    await sendTransaction("SuperfluidFactoringPoolConfig", poolConfig, "initialize", [
        "SuperfluidFactoringPool",
        hdt.address,
        humaConfig.address,
        feeManager.address,
    ]);

    const decimals = await hdt.decimals();
    const cap = BN.from(1_000_000).mul(BN.from(10).pow(BN.from(decimals)));
    console.log("cap: " + cap);
    await sendTransaction("SuperfluidFactoringPoolConfig", poolConfig, "setPoolLiquidityCap", [
        cap,
    ]);

    await sendTransaction("SuperfluidFactoringPoolConfig", poolConfig, "setPool", [
        deployedContracts["SuperfluidFactoringPool"],
    ]);
    console.log(`ea: ${ea.address}`);
    await sendTransaction("SuperfluidFactoringPoolConfig", poolConfig, "setEvaluationAgent", [
        1,
        ea.address,
    ]);

    await sendTransaction(
        "SuperfluidFactoringPoolConfig",
        poolConfig,
        "setPoolOwnerRewardsAndLiquidity",
        [500, 200]
    );
    await sendTransaction(
        "SuperfluidFactoringPoolConfig",
        poolConfig,
        "setEARewardsAndLiquidity",
        [1000, 100]
    );
    const maxCL = BN.from(1_000).mul(BN.from(10).pow(BN.from(decimals)));
    console.log("maxCL: " + maxCL);
    await sendTransaction("SuperfluidFactoringPoolConfig", poolConfig, "setMaxCreditLine", [
        maxCL,
    ]);
    await sendTransaction("SuperfluidFactoringPoolConfig", poolConfig, "setAPR", [0]);
    await sendTransaction(
        "SuperfluidFactoringPoolConfig",
        poolConfig,
        "setReceivableRequiredInBps",
        [10000]
    );
    await sendTransaction("SuperfluidFactoringPoolConfig", poolConfig, "setPoolPayPeriod", [30]);
    await sendTransaction("SuperfluidFactoringPoolConfig", poolConfig, "setPoolToken", [
        deployedContracts["SuperfluidPoolHDT"],
    ]);
    await sendTransaction(
        "SuperfluidFactoringPoolConfig",
        poolConfig,
        "setWithdrawalLockoutPeriod",
        [90]
    );
    await sendTransaction(
        "SuperfluidFactoringPoolConfig",
        poolConfig,
        "setPoolDefaultGracePeriod",
        [60]
    );

    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "addPoolOperator", [
        rfpOperator.address,
    ]);
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setPoolOwnerTreasury", [
        rfpOwnerTreasury.address,
    ]);

    await updateInitilizedContract("SuperfluidFactoringPoolConfig");
}

async function initPool() {
    const initilized = await getInitilizedContract("SuperfluidFactoringPool");
    if (initilized) {
        console.log("SuperfluidFactoringPool is already initialized!");
        return;
    }

    if (!deployedContracts["SuperfluidFactoringPool"]) {
        throw new Error("SuperfluidFactoringPool not deployed yet!");
    }

    if (!deployedContracts["SuperfluidFactoringPoolConfig"]) {
        throw new Error("SuperfluidFactoringPoolConfig not deployed yet!");
    }

    const SuperfluidFactoringPool = await hre.ethers.getContractFactory("SuperfluidFactoringPool");
    const pool = SuperfluidFactoringPool.attach(deployedContracts["SuperfluidFactoringPool"]);

    await sendTransaction("SuperfluidFactoringPool", pool, "initialize", [
        deployedContracts["SuperfluidFactoringPoolConfig"],
    ]);

    await updateInitilizedContract("SuperfluidFactoringPool");
}

async function prepare() {
    if (!deployedContracts["SuperfluidFactoringPool"]) {
        throw new Error("SuperfluidFactoringPool not deployed yet!");
    }

    const SuperfluidFactoringPool = await hre.ethers.getContractFactory("SuperfluidFactoringPool");
    const pool = SuperfluidFactoringPool.attach(deployedContracts["SuperfluidFactoringPool"]);
    const poolFromrfpOperator = pool.connect(rfpOperator);

    await sendTransaction("SuperfluidFactoringPool", poolFromrfpOperator, "addApprovedLender", [
        deployer.address,
    ]);
    await sendTransaction("SuperfluidFactoringPool", poolFromrfpOperator, "addApprovedLender", [
        ea.address,
    ]);
    await sendTransaction("SuperfluidFactoringPool", poolFromrfpOperator, "addApprovedLender", [
        lender.address,
    ]);
    await sendTransaction("SuperfluidFactoringPool", poolFromrfpOperator, "addApprovedLender", [
        rfpOwnerTreasury.address,
    ]);

    const USDC = await hre.ethers.getContractFactory("TestToken");
    const usdc = USDC.attach(USDC_ADDRESS);
    const decimals = await usdc.decimals();

    // Owner
    const usdcFromPoolOwnerTreasury = await usdc.connect(rfpOwnerTreasury);
    const poolFromPoolOwnerTreasury = await pool.connect(rfpOwnerTreasury);
    const amountOwner = BN.from(20_000).mul(BN.from(10).pow(BN.from(decimals)));
    await sendTransaction("TestToken", usdc, "mint", [rfpOwnerTreasury.address, amountOwner]);
    await sendTransaction("TestToken", usdcFromPoolOwnerTreasury, "approve", [
        pool.address,
        amountOwner,
    ]);
    await sendTransaction(
        "SuperfluidFactoringPool",
        poolFromPoolOwnerTreasury,
        "makeInitialDeposit",
        [amountOwner]
    );

    // EA
    const usdcFromEA = await usdc.connect(ea);
    const poolFromEA = await pool.connect(ea);
    const amountEA = BN.from(10_000).mul(BN.from(10).pow(BN.from(decimals)));
    await sendTransaction("TestToken", usdc, "mint", [ea.address, amountEA]);
    await sendTransaction("TestToken", usdcFromEA, "approve", [pool.address, amountEA]);
    await sendTransaction("SuperfluidFactoringPool", poolFromEA, "makeInitialDeposit", [amountEA]);

    await sendTransaction("SuperfluidFactoringPool", pool, "enablePool", []);

    //payer
    const amountPayer = BN.from(100_000_000).mul(BN.from(10).pow(BN.from(decimals)));
    await sendTransaction("TestToken", usdc, "mint", [payer.address, amountPayer]);
}

async function initContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    [
        deployer,
        proxyOwner,
        lender,
        ea,
        eaService,
        pdsService,
        treasury,
        ea_bcp,
        payer,
        bcpOperator,
        rfpOperator,
        bcpOwnerTreasury,
        rfpOwnerTreasury,
    ] = await accounts;
    console.log("deployer address: " + deployer.address);
    console.log("lender address: " + lender.address);
    console.log("ea address: " + ea.address);

    deployedContracts = await getDeployedContracts();

    // await initHumaConfig();
    await initFeeManager();
    await initHDT();
    // await initEA();
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
