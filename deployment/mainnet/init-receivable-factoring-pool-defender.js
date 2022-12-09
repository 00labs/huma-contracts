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
let invoicePayer;

const HUMA_OWNER_MULTI_SIG = "0x1eCD14504885ADfF674842F6b805e202c7C05B75";
const POOL_OWNER_MULTI_SIG = "0x608c2DEA3C90849b0182DBD0F1008240881f3C90";
const POOL_OWNER_TREASURY = "0x999d64075f5d194e163D62035abbaA3E8BF2c7C6";
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const EA_ADDRESS = "0xdB59787549cA50faF9Bd2679856B668eDDBf0A44";

async function checkContractsDeployed(contractKeys) {
    console.log(contractKeys);
    for (contract of contractKeys) {
        console.log(contract);
        checkContractDeployed(contract);
    }
}

async function checkContractDeployed(contract) {
    if (!deployedContracts[contract]) {
        throw new Error(`${contract} not deployed yet!`);
    }
}

async function renounceTLAdminRole(timeLockKey, account) {
    checkContractDeployed(timeLockKey);

    const TimeLockController = await hre.ethers.getContractFactory("TimelockController");
    const timeLockController = TimeLockController.attach(deployedContracts[timeLockKey]);

    const adminRole = await timeLockController.TIMELOCK_ADMIN_ROLE();
    await sendTransaction("TimelockController", timeLockController, "renounceRole", [
        adminRole,
        account,
    ]);
}

async function transferOwnershipToTL(contractName, contractKey, timeLockKey) {
    checkContractsDeployed([timeLockKey, contractKey]);

    const TimeLockController = await hre.ethers.getContractFactory("TimelockController");
    const timeLockController = TimeLockController.attach(deployedContracts[timeLockKey]);

    const Contract = await hre.ethers.getContractFactory(contractName);
    const contract = Contract.attach(deployedContracts[contractKey]);

    await sendTransaction(contractKey, contract, "transferOwnership", [
        timeLockController.address,
    ]);

    await renounceTLAdminRole(timeLockKey, deployer.address);
}

async function initHumaConfig() {
    const initilized = await getInitilizedContract("HumaConfig");
    if (initilized) {
        console.log("HumaConfig is already initialized!");
        return;
    }

    checkContractsDeployed(["HumaConfig", "EANFT"]);

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
    await sendTransaction("HumaConfig", humaConfig, "setPDSServiceAccount", [
        "0x5C7284BD9a0df4cDEF323D180273244dc77e69f2",
    ]);

    // const USDC = await hre.ethers.getContractFactory("TestToken");
    // const usdc = USDC.attach(deployedContracts["USDC"]);

    // Add usdc as an asset supported by the protocol
    await sendTransaction("HumaConfig", humaConfig, "setLiquidityAsset", [USDC_ADDRESS, true]);

    // Set treasury for the protocol
    await sendTransaction("HumaConfig", humaConfig, "setHumaTreasury", [HUMA_OWNER_MULTI_SIG]);

    await updateInitilizedContract("HumaConfig");
}

async function initFeeManager() {
    const initilized = await getInitilizedContract("ReceivableFactoringPoolFeeManager");
    if (initilized) {
        console.log("ReceivableFactoringPoolFeeManager is already initialized!");
        return;
    }

    checkContractDeployed("ReceivableFactoringPoolFeeManager");

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

    await updateInitilizedContract("ReceivableFactoringPoolFeeManager");
}

async function initHDT() {
    const initilized = await getInitilizedContract("HDT");
    if (initilized) {
        console.log("HDT is already initialized!");
        return;
    }

    checkContractsDeployed(["HDT", "ReceivableFactoringPool"]);

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["HDT"]);

    await sendTransaction("HDT", hdt, "initialize", ["Receivable HDT", "RHDT", USDC_ADDRESS]);

    await sendTransaction("HDT", hdt, "setPool", [deployedContracts["ReceivableFactoringPool"]]);

    await updateInitilizedContract("HDT");
}

async function initEA() {
    const initilized = await getInitilizedContract("EANFT");
    if (initilized) {
        console.log("EANFT is already initialized!");
        return;
    }

    checkContractDeployed("EANFT");

    const EANFT = await hre.ethers.getContractFactory("EvaluationAgentNFT");
    const eaNFT = EANFT.attach(deployedContracts["EANFT"]);

    await sendTransaction("EvaluationAgentNFT", eaNFT, "mintNFT", [EA_ADDRESS]);
    await sendTransaction("EvaluationAgentNFT", eaNFT, "mintNFT", [EA_ADDRESS]);

    await updateInitilizedContract("EANFT");
}

async function initPoolConfig() {
    const initilized = await getInitilizedContract("ReceivableFactoringPoolConfig");
    if (initilized) {
        console.log("ReceivableFactoringPoolConfig is already initialized!");
        return;
    }

    checkContractsDeployed([
        "ReceivableFactoringPoolConfig",
        "ReceivableFactoringPool",
        "HDT",
        "HumaConfig",
        "ReceivableFactoringPoolFeeManager",
    ]);

    const ReceivableFactoringPoolConfig = await hre.ethers.getContractFactory("BasePoolConfig");
    const poolConfig = ReceivableFactoringPoolConfig.attach(
        deployedContracts["ReceivableFactoringPoolConfig"]
    );

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
    const cap = BN.from(20_000).mul(BN.from(10).pow(BN.from(decimals)));
    console.log("cap: " + cap);
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setPoolLiquidityCap", [
        cap,
    ]);

    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setPool", [
        deployedContracts["ReceivableFactoringPool"],
    ]);
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setEvaluationAgent", [
        1,
        EA_ADDRESS,
    ]);

    await sendTransaction(
        "ReceivableFactoringPoolConfig",
        poolConfig,
        "setPoolOwnerRewardsAndLiquidity",
        [500, 500]
    );
    await sendTransaction(
        "ReceivableFactoringPoolConfig",
        poolConfig,
        "setEARewardsAndLiquidity",
        [500, 200]
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
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setPoolPayPeriod", [30]);
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setPoolToken", [
        deployedContracts["HDT"],
    ]);
    await sendTransaction(
        "ReceivableFactoringPoolConfig",
        poolConfig,
        "setWithdrawalLockoutPeriod",
        [90]
    );
    await sendTransaction(
        "ReceivableFactoringPoolConfig",
        poolConfig,
        "setPoolDefaultGracePeriod",
        [60]
    );

    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "addPoolOperator", [
        "0x76C89c2d8cDB9299EE32673026faB8a2A177dCa4",
    ]); // Richard-pool
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "addPoolOperator", [
        "0x1BACF76592Be393610cA422D7DDED282330CaED8",
    ]); // Erbil-pool
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "addPoolOperator", [
        "0xEC5c04192A251f6ffD42a48ad3Ee8250F7757D08",
    ]); // Ji-pool
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "addPoolOperator", [
        "0x5870C74d8644DAE4Fe2a393e496B1671a5CC7481",
    ]); // Bin
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "addPoolOperator", [
        "0x60758B3A6933192D0Ac28Fc1f675364bb4dFAb1d",
    ]); // Shan
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "addPoolOperator", [
        "0xE5834DF0cA8F1BbCECFb4E9455eCc5f5E0Dfe8bD",
    ]); // Lei
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "addPoolOperator", [
        "0x54035aa4a295bf909485fcA4B170b53eAe21E560",
    ]); // Michael
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "addPoolOperator", [
        deployer.address,
    ]); // deployer
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setPoolOwnerTreasury", [
        POOL_OWNER_TREASURY,
    ]);

    await updateInitilizedContract("ReceivableFactoringPoolConfig");
}

async function initPool() {
    const initilized = await getInitilizedContract("ReceivableFactoringPool");
    if (initilized) {
        console.log("ReceivableFactoringPool is already initialized!");
        return;
    }

    checkContractsDeployed([
        "ReceivableFactoringPool",
        "ReceivableFactoringPoolConfig",
        "ReceivableFactoringPoolProxyAdminTimelock",
    ]);

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("ReceivableFactoringPool");
    const pool = ReceivableFactoringPool.attach(deployedContracts["ReceivableFactoringPool"]);

    await sendTransaction("ReceivableFactoringPool", pool, "initialize", [
        deployedContracts["ReceivableFactoringPoolConfig"],
    ]);

    await renounceTLAdminRole("ReceivableFactoringPoolProxyAdminTimelock", deployer.address);

    await updateInitilizedContract("ReceivableFactoringPool");
}

async function prepare() {
    checkContractsDeployed(["ReceivableFactoringPool", "ReceivableFactoringPoolConfig"]);

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("ReceivableFactoringPool");
    const pool = ReceivableFactoringPool.attach(deployedContracts["ReceivableFactoringPool"]);

    await sendTransaction("ReceivableFactoringPool", pool, "addApprovedLender", [
        POOL_OWNER_TREASURY,
    ]);
    await sendTransaction("ReceivableFactoringPool", pool, "addApprovedLender", [EA_ADDRESS]);

    const ReceivablePoolConfig = await hre.ethers.getContractFactory("BasePoolConfig");
    const poolConfig = ReceivablePoolConfig.attach(
        deployedContracts["ReceivableFactoringPoolConfig"]
    );
    await sendTransaction("BasePoolConfig", poolConfig, "removePoolOperator", [deployer.address]);
}

async function cleanupReceivablePool() {
    // enable pool after initial deposits and transfer ownerships to TLs
    checkContractsDeployed([
        "HumaConfig",
        "HumaConfigTimelock",
        "ReceivableFactoringPoolFeeManager",
        "ReceivableFactoringPoolTimelock",
        "HDT",
        "ReceivableFactoringPoolConfig",
    ]);

    // const ReceivableFactoringPool = await hre.ethers.getContractFactory("ReceivableFactoringPool");
    // const pool = ReceivableFactoringPool.attach(deployedContracts["ReceivableFactoringPool"]);

    // await sendTransaction("ReceivableFactoringPool", pool, "enablePool", []);

    await transferOwnershipToTL(
        "BaseFeeManager",
        "ReceivableFactoringPoolFeeManager",
        "ReceivableFactoringPoolTimelock"
    );

    await transferOwnershipToTL("HDT", "HDT", "ReceivableFactoringPoolTimelock");

    await transferOwnershipToTL(
        "BasePoolConfig",
        "ReceivableFactoringPoolConfig",
        "ReceivableFactoringPoolTimelock"
    );
}

async function initContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    [deployer, eaService, pdsService] = await accounts;
    console.log("deployer address: " + deployer.address);
    console.log("ea service address: " + eaService.address);

    deployedContracts = await getDeployedContracts();

    await initHumaConfig();
    await initFeeManager();
    await initHDT();
    // await initEA();
    await initPoolConfig();
    await initPool();

    //await prepare();

    // make initial deposits from EA and pool owner treasury on Defender
    await cleanupReceivablePool();
}

initContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
