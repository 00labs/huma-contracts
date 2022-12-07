const {BigNumber: BN} = require("ethers");
const {check} = require("prettier");
const {
    getInitilizedContract,
    updateInitilizedContract,
    getDeployedContracts,
    sendTransaction,
    deploy,
} = require("../utils.js");

let deployer, deployedContracts, lender, ea, eaService;
let pdsService, treasury, ea_bcp, bcpOperator, rfpOperator;
let bcpOwnerTreasury, rfpOwnerTreasury;

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

    // Add usdc as an asset supported by the protocol
    await sendTransaction("HumaConfig", humaConfig, "setLiquidityAsset", [USDC_ADDRESS, true]);

    // Set treasury for the protocol
    await sendTransaction("HumaConfig", humaConfig, "setHumaTreasury", [HUMA_OWNER_MULTI_SIG]);

    await updateInitilizedContract("HumaConfig");
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

    //const eaNFTFromEA = eaNFT.connect(ea);
    await sendTransaction("EvaluationAgentNFT", eaNFT, "mintNFT", [EA_ADDRESS]);
    await sendTransaction("EvaluationAgentNFT", eaNFT, "mintNFT", [EA_ADDRESS]);

    await updateInitilizedContract("EANFT");
}

async function initBaseCreditPoolFeeManager() {
    const initilized = await getInitilizedContract("BaseCreditPoolFeeManager");
    if (initilized) {
        console.log("BaseCreditPoolFeeManager is already initialized!");
        return;
    }
    checkContractDeployed("BaseCreditPoolFeeManager");

    const BaseFeeManager = await hre.ethers.getContractFactory("BaseFeeManager");
    const feeManager = BaseFeeManager.attach(deployedContracts["BaseCreditPoolFeeManager"]);

    await sendTransaction(
        "BaseCreditPoolFeeManager",
        feeManager,
        "setFees",
        [0, 0, 20_000_000, 0, 0]
    );
    await sendTransaction("FeeManager", feeManager, "setMinPrincipalRateInBps", [500]);

    await updateInitilizedContract("BaseCreditPoolFeeManager");
}

async function initBaseCreditPoolHDT() {
    const initilized = await getInitilizedContract("BaseCreditHDT");
    if (initilized) {
        console.log("BaseCreditHDT is already initialized!");
        return;
    }
    checkContractsDeployed(["BaseCreditHDT", "BaseCreditPool"]);

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["BaseCreditHDT"]);

    await sendTransaction("HDT", hdt, "initialize", ["Credit line HDT", "CLHDT", USDC_ADDRESS]);

    await sendTransaction("HDT", hdt, "setPool", [deployedContracts["BaseCreditPool"]]);

    await updateInitilizedContract("BaseCreditHDT");
}

async function initBaseCreditPoolConfig() {
    const initilized = await getInitilizedContract("BaseCreditPoolConfig");
    if (initilized) {
        console.log("BaseCreditPoolConfig is already initialized!");
        return;
    }

    checkContractsDeployed([
        "BaseCreditPoolConfig",
        "BaseCreditPool",
        "BaseCreditHDT",
        "HumaConfig",
        "BaseCreditPoolFeeManager",
    ]);

    const ReceivableFactoringPoolConfig = await hre.ethers.getContractFactory("BasePoolConfig");
    const poolConfig = ReceivableFactoringPoolConfig.attach(
        deployedContracts["BaseCreditPoolConfig"]
    );

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
    const cap = BN.from(20_000).mul(BN.from(10).pow(BN.from(decimals)));
    console.log("cap: " + cap);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setPoolLiquidityCap", [cap]);

    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setPool", [
        deployedContracts["BaseCreditPool"],
    ]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setEvaluationAgent", [
        2,
        EA_ADDRESS,
    ]);

    await sendTransaction(
        "BaseCreditPoolConfig",
        poolConfig,
        "setPoolOwnerRewardsAndLiquidity",
        [500, 500]
    );
    await sendTransaction(
        "BaseCreditPoolConfig",
        poolConfig,
        "setEARewardsAndLiquidity",
        [500, 200]
    );
    const maxCL = BN.from(1_000).mul(BN.from(10).pow(BN.from(decimals)));
    console.log("maxCL: " + maxCL);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setMaxCreditLine", [maxCL]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setAPR", [1000]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setReceivableRequiredInBps", [0]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setPoolPayPeriod", [30]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setPoolToken", [
        deployedContracts["BaseCreditHDT"],
    ]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setWithdrawalLockoutPeriod", [90]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setPoolDefaultGracePeriod", [60]);

    await sendTransaction("BaseCreditPoolConfig", poolConfig, "addPoolOperator", [
        "0x76C89c2d8cDB9299EE32673026faB8a2A177dCa4",
    ]); // Richard-pool
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "addPoolOperator", [
        "0x1BACF76592Be393610cA422D7DDED282330CaED8",
    ]); // Erbil-pool
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "addPoolOperator", [
        "0xEC5c04192A251f6ffD42a48ad3Ee8250F7757D08",
    ]); // Ji-pool
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "addPoolOperator", [
        "0x5870C74d8644DAE4Fe2a393e496B1671a5CC7481",
    ]); // Bin
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "addPoolOperator", [
        "0x60758B3A6933192D0Ac28Fc1f675364bb4dFAb1d",
    ]); // Shan
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "addPoolOperator", [
        "0xE5834DF0cA8F1BbCECFb4E9455eCc5f5E0Dfe8bD",
    ]); // Lei
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "addPoolOperator", [
        "0x54035aa4a295bf909485fcA4B170b53eAe21E560",
    ]); // Michael
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "addPoolOperator", [
        deployer.address,
    ]);

    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setPoolOwnerTreasury", [
        POOL_OWNER_TREASURY,
    ]);

    await updateInitilizedContract("BaseCreditPoolConfig");
}

async function initBaseCreditPool() {
    const initilized = await getInitilizedContract("BaseCreditPool");
    if (initilized) {
        console.log("BaseCreditPool is already initialized!");
        return;
    }

    checkContractsDeployed(["BaseCreditPool", "BaseCreditPoolConfig", "BaseCreditPoolTimelock"]);

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("BaseCreditPool");
    const pool = ReceivableFactoringPool.attach(deployedContracts["BaseCreditPool"]);

    await sendTransaction("BaseCreditPool", pool, "initialize", [
        deployedContracts["BaseCreditPoolConfig"],
    ]);

    await renounceTLAdminRole("BaseCreditPoolTimelock", deployer.address);

    await updateInitilizedContract("BaseCreditPool");
}

async function prepareBaseCreditPool() {
    // The operations commented off need to run with TL on Defender
    checkContractsDeployed(["BaseCreditPool", "BaseCreditPoolConfig"]);

    const BaseCreditPool = await hre.ethers.getContractFactory("BaseCreditPool");
    const pool = BaseCreditPool.attach(deployedContracts["BaseCreditPool"]);

    await sendTransaction("BaseCreditPool", pool, "addApprovedLender", [POOL_OWNER_TREASURY]);
    await sendTransaction("BaseCreditPool", pool, "addApprovedLender", [EA_ADDRESS]);

    const BaseCreditPoolConfig = await hre.ethers.getContractFactory("BasePoolConfig");
    const poolConfig = BaseCreditPoolConfig.attach(deployedContracts["BaseCreditPoolConfig"]);
    await sendTransaction("BasePoolConfig", poolConfig, "removePoolOperator", [deployer.address]);
}

async function cleanupBaseCreditPool() {
    // enable pool after initial deposits and transfer ownerships to TLs
    checkContractsDeployed([
        "HumaConfig",
        "HumaConfigTimelock",
        "BaseCreditPoolFeeManager",
        "BaseCreditPoolTimelock",
        "BaseCreditHDT",
        "BaseCreditPoolConfig",
    ]);

    const BaseCreditPool = await hre.ethers.getContractFactory("BaseCreditPool");
    const pool = BaseCreditPool.attach(deployedContracts["BaseCreditPool"]);
    // await sendTransaction("BaseCreditPool", pool, "enablePool", []);

    await transferOwnershipToTL("HumaConfig", "HumaConfig", "HumaConfigTimelock");

    await transferOwnershipToTL(
        "BaseFeeManager",
        "BaseCreditPoolFeeManager",
        "BaseCreditPoolTimelock"
    );

    await transferOwnershipToTL("HDT", "BaseCreditHDT", "BaseCreditPoolTimelock");

    await transferOwnershipToTL(
        "BasePoolConfig",
        "BaseCreditPoolConfig",
        "BaseCreditPoolTimelock"
    );
}

async function initContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    const accounts = await hre.ethers.getSigners();
    let invoicePayer;
    [deployer, eaService, pdsService] = await accounts;

    deployedContracts = await getDeployedContracts();

    // await initHumaConfig();
    // await initEA();

    // await initBaseCreditPoolFeeManager();
    // await initBaseCreditPoolHDT();
    // await initBaseCreditPoolConfig();
    // await initBaseCreditPool();

    // await prepareBaseCreditPool();
    // make initial deposits from EA and pool owner treasury on Defender
    await cleanupBaseCreditPool();
}

initContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
