const {
    getInitilizedContract,
    updateInitilizedContract,
    getDeployedContracts,
    sendTransaction,
} = require("../utils.js");

let deployer, eaService, deployedContracts;
const PDSServiceAccount = "0xe906B5CDf5d66036b69d84BAfb2643f3aDCD1CA1";
const SF_FUSDC_ADDRESS = "0xbe49ac1EadAc65dccf204D4Df81d650B50122aB2";
const SF_HOST_ADDRESS = "0xEB796bdb90fFA0f28255275e16936D25d3418603";
const SF_CFA_ADDRESS = "0x49e565Ed1bdc17F3d220f72DF0857C26FA83F873";

const USDC_ADDRESS = SF_FUSDC_ADDRESS;

const poolTreasury = "0x7c25422C52e4c5187b9A448df627E79175281d5a";
const treasuryAccount = "0x4062A9Eab6a49B2Be6aE4F7240D420f6fbE2e615";

// const HUMA_OWNER_MULTI_SIG = "0x1931bD73055335Ba06efB22DB96169dbD4C5B4DB";
// const POOL_OWNER_MULTI_SIG = "0xB69cD2CC66583a4f46c1a8C977D5A8Bf9ecc81cA";

async function transferOwnershipToTL(contractName, contractKey, timeLockKey) {
    if (!deployedContracts[timeLockKey]) {
        throw new Error(`${timeLockKey} not deployed yet!`);
    }

    if (!deployedContracts[contractKey]) {
        throw new Error(`${contractKey} not deployed yet!`);
    }

    const TimeLockController = await hre.ethers.getContractFactory("TimelockController");
    const timeLockController = TimeLockController.attach(deployedContracts[timeLockKey]);

    const Contract = await hre.ethers.getContractFactory(contractName);
    const contract = Contract.attach(deployedContracts[contractKey]);

    await sendTransaction(contractKey, contract, "transferOwnership", [
        timeLockController.address,
    ]);

    const adminRole = await timeLockController.TIMELOCK_ADMIN_ROLE();
    await sendTransaction(contractKey, timeLockController, "renounceRole", [
        adminRole,
        deployer.address,
    ]);
}

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

    const HumaConfig = await hre.ethers.getContractFactory("HumaConfig");
    const humaConfig = HumaConfig.attach(deployedContracts["HumaConfig"]);

    await sendTransaction("HumaConfig", humaConfig, "setProtocolDefaultGracePeriod", [
        30 * 24 * 3600,
    ]);
    await sendTransaction("HumaConfig", humaConfig, "setTreasuryFee", [500]);
    await sendTransaction("HumaConfig", humaConfig, "setEANFTContractAddress", [
        deployedContracts["EANFT"],
    ]);

    await sendTransaction("HumaConfig", humaConfig, "setEAServiceAccount", [eaService.address]);
    await sendTransaction("HumaConfig", humaConfig, "setPDSServiceAccount", [PDSServiceAccount]);

    // Add usdc as an asset supported by the protocol
    await sendTransaction("HumaConfig", humaConfig, "setLiquidityAsset", [USDC_ADDRESS, true]);

    // Set treasury for the protocol
    await sendTransaction("HumaConfig", humaConfig, "setHumaTreasury", [treasuryAccount]);

    // Notice: Gnosis Safe doesn't support Mumbai now
    // await transferOwnershipToTL("HumaConfig", "HumaConfig", "HumaConfigTimelock");

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

    const SuperfluidFeeManager = await hre.ethers.getContractFactory("SuperfluidFeeManager");
    const feeManager = SuperfluidFeeManager.attach(
        deployedContracts["SuperfluidFactoringPoolFeeManager"]
    );

    await sendTransaction(
        "SuperfluidFactoringPoolFeeManager",
        feeManager,
        "setFees",
        [0, 0, 0, 0, 0]
    );
    await sendTransaction(
        "SuperfluidFactoringPoolFeeManager",
        feeManager,
        "setMinPrincipalRateInBps",
        [0]
    );

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

    // Notice: Gnosis Safe doesn't support Mumbai now
    // await transferOwnershipToTL("HDT", "SuperfluidPoolHDT", "SuperfluidFactoringPoolTimelock");

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

    const eaNFTFromEA = eaNFT.connect(ea_sfp);
    await sendTransaction("EvaluationAgentNFT", eaNFTFromEA, "mintNFT", [ea_sfp.address]);
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

    if (!deployedContracts["SuperfluidFactoringPool"]) {
        throw new Error("SuperfluidFactoringPool not deployed yet!");
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

    const SuperfluidFeeManager = await hre.ethers.getContractFactory("SuperfluidFeeManager");
    const feeManager = SuperfluidFeeManager.attach(
        deployedContracts["SuperfluidFactoringPoolFeeManager"]
    );

    await sendTransaction("SuperfluidFactoringPoolConfig", poolConfig, "initialize", [
        "SuperfluidFactoringPool",
        hdt.address,
        humaConfig.address,
        feeManager.address,
    ]);

    const decimals = await hdt.decimals();
    const cap = BigInt(1_000_000) * BigInt(10) ** BigInt(decimals);
    console.log("cap: " + cap);
    await sendTransaction("SuperfluidFactoringPoolConfig", poolConfig, "setPoolLiquidityCap", [
        cap,
    ]);

    await sendTransaction("SuperfluidFactoringPoolConfig", poolConfig, "setPool", [
        deployedContracts["SuperfluidFactoringPool"],
    ]);
    // console.log(`ea_sfp: ${ea_sfp.address}`);
    // await sendTransaction("SuperfluidFactoringPoolConfig", poolConfig, "setEvaluationAgent", [
    //     1,
    //     ea_sfp.address,
    // ]);

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
        [0, 0]
    );
    const maxCL = BigInt(1_000_000) * BigInt(10) ** BigInt(decimals);
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
        deployer.address,
    ]);
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setPoolOwnerTreasury", [
        poolTreasury,
    ]);

    // Notice: Gnosis Safe doesn't support Mumbai now
    // await transferOwnershipToTL(
    //     "BasePoolConfig",
    //     "SuperfluidFactoringPoolConfig",
    //     "SuperfluidFactoringPoolTimelock"
    // );

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

    if (!deployedContracts["SuperfluidProcessor"]) {
        throw new Error("SuperfluidProcessor not deployed yet!");
    }

    if (!deployedContracts["SuperfluidTradableStream"]) {
        throw new Error("SuperfluidTradableStream not deployed yet!");
    }

    const ReceivableFactoringPoolV2 = await hre.ethers.getContractFactory(
        "ReceivableFactoringPoolV2"
    );
    const pool = ReceivableFactoringPoolV2.attach(deployedContracts["SuperfluidFactoringPool"]);

    await sendTransaction("SuperfluidFactoringPool", pool, "initialize(address,address)", [
        deployedContracts["SuperfluidFactoringPoolConfig"],
        deployedContracts["SuperfluidProcessor"],
    ]);

    const SuperfluidPoolProcessor = await hre.ethers.getContractFactory("SuperfluidPoolProcessor");
    const processor = SuperfluidPoolProcessor.attach(deployedContracts["SuperfluidProcessor"]);

    await sendTransaction(
        "SuperfluidProcessor",
        processor,
        "initialize(address,address,address,address)",
        [
            deployedContracts["SuperfluidFactoringPool"],
            SF_HOST_ADDRESS,
            SF_CFA_ADDRESS,
            deployedContracts["SuperfluidTradableStream"],
        ]
    );

    await updateInitilizedContract("SuperfluidFactoringPool");
}

async function prepare() {
    if (!deployedContracts["SuperfluidFactoringPool"]) {
        throw new Error("SuperfluidFactoringPool not deployed yet!");
    }

    const ReceivableFactoringPoolV2 = await hre.ethers.getContractFactory(
        "ReceivableFactoringPoolV2"
    );
    const pool = ReceivableFactoringPoolV2.attach(deployedContracts["SuperfluidFactoringPool"]);
    // const poolFromOperator = pool.connect(deployer);

    await sendTransaction("SuperfluidFactoringPool", pool, "addApprovedLender", [poolTreasury]);

    const USDC = await hre.ethers.getContractFactory("TestToken");
    const usdc = USDC.attach(USDC_ADDRESS);
    const decimals = await usdc.decimals();

    // Owner
    // const usdcFromPoolOwnerTreasury = await usdc.connect(sfpOwnerTreasury);
    // const poolFromPoolOwnerTreasury = await pool.connect(sfpOwnerTreasury);
    const amountOwner = BigInt(20_000) * BigInt(10) ** BigInt(decimals);
    await sendTransaction("TestToken", usdc, "mint", [poolTreasury, amountOwner]);
    // await sendTransaction("TestToken", usdcFromPoolOwnerTreasury, "approve", [
    //     pool.address,
    //     amountOwner,
    // ]);
    // await sendTransaction(
    //     "SuperfluidFactoringPool",
    //     poolFromPoolOwnerTreasury,
    //     "makeInitialDeposit",
    //     [amountOwner]
    // );

    // EA
    // const usdcFromEA = await usdc.connect(ea_sfp);
    // const poolFromEA = await pool.connect(ea_sfp);
    // const amountEA = BN.from(10_000).mul(BN.from(10).pow(BN.from(decimals)));
    // await sendTransaction("TestToken", usdc, "mint", [ea_sfp.address, amountEA]);
    // await sendTransaction("TestToken", usdcFromEA, "approve", [pool.address, amountEA]);
    // await sendTransaction("SuperfluidFactoringPool", poolFromEA, "makeInitialDeposit", [amountEA]);

    // await sendTransaction("SuperfluidFactoringPool", pool, "enablePool", []);

    //payer
    // const amountPayer = BN.from(100_000_000).mul(BN.from(10).pow(BN.from(decimals)));
    // await sendTransaction("TestToken", usdc, "mint", [payer.address, amountPayer]);
}

async function initContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    [deployer, eaService] = await accounts;
    console.log("deployer address: " + deployer.address);
    // console.log("lender address: " + lender.address);
    // console.log("ea address: " + ea_sfp.address);

    deployedContracts = await getDeployedContracts();

    await initHumaConfig();
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