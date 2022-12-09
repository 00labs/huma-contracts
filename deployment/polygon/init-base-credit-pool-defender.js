const {BigNumber: BN} = require("ethers");
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

const HUMA_OWNER_MULTI_SIG = "0x7E13931931d59f2199fE0b499534412FCD28b7Ed";
const POOL_OWNER_MULTI_SIG = "0xD252073bF424bb13B474004bf9F52195d54aEDb6";
const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const EA_ADDRESS = '0xdB59787549cA50faF9Bd2679856B668eDDBf0A44';

async function renounceTLAdminRole(timeLockKey, account) {
    if (!deployedContracts[timeLockKey]) {
        throw new Error(`${timeLockKey} not deployed yet!`);
    }
    const TimeLockController = await hre.ethers.getContractFactory("TimelockController");
    const timeLockController = TimeLockController.attach(deployedContracts[timeLockKey]);
    
    const adminRole = await timeLockController.TIMELOCK_ADMIN_ROLE();
    await sendTransaction("TimelockController", timeLockController, "renounceRole", [
        adminRole,
        account,
    ]);
}


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

    await sendTransaction(contractKey, contract, "transferOwnership", [timeLockController.address]);

    await renounceTLAdminRole(timeLockKey, deployer.address);
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
    await sendTransaction("HumaConfig", humaConfig, "setPDSServiceAccount", [pdsService.address]);

    const USDC = await hre.ethers.getContractFactory("TestToken");
    const usdc = USDC.attach(deployedContracts["USDC"]);

    // Add usdc as an asset supported by the protocol
    await sendTransaction("HumaConfig", humaConfig, "setLiquidityAsset", [usdc.address, true]);

    // Set treasury for the protocol
    await sendTransaction("HumaConfig", humaConfig, "setHumaTreasury", [treasury.address]);

    await transferOwnershipToTL("HumaConfig", "HumaConfig", "HumaConfigTimelock")

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
        [0, 0, 20_000_000, 0, 0]
    );
    // await sendTransaction("FeeManager", feeManager, "setMinPrincipalRateInBps", [0]);
    
    await transferOwnershipToTL("BaseFeeManager", "BaseCreditPoolFeeManager", "BaseCreditPoolTimelock");

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

    if (!deployedContracts["BaseCreditPool"]) {
        throw new Error("BaseCreditPool not deployed yet!");
    }

    await sendTransaction("HDT", hdt, "initialize", [
        "Credit line HDT",
        "BHDT",
        USDC_ADDRESS,
    ]);

    await sendTransaction("HDT", hdt, "setPool", [deployedContracts["BaseCreditPool"]]);
    
    await transferOwnershipToTL("HDT", "BaseCreditHDT", "BaseCreditPoolTimelock");

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
    const maxCL = BN.from(2_000).mul(BN.from(10).pow(BN.from(decimals)));
    console.log("maxCL: " + maxCL);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setMaxCreditLine", [maxCL]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setAPR", [1000]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setReceivableRequiredInBps", [0]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setPoolPayPeriod", [15]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setPoolToken", [
        deployedContracts["BaseCreditHDT"],
    ]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setWithdrawalLockoutPeriod", [90]);
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setPoolDefaultGracePeriod", [60]);

    await sendTransaction("BaseCreditPoolConfig", poolConfig, "addPoolOperator", ['0x76C89c2d8cDB9299EE32673026faB8a2A177dCa4']); // Richard-pool
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "addPoolOperator", ['0x1BACF76592Be393610cA422D7DDED282330CaED8']); // Erbil-pool
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "addPoolOperator", ['0xEC5c04192A251f6ffD42a48ad3Ee8250F7757D08']); // Ji-pool
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "addPoolOperator", ['0x5870C74d8644DAE4Fe2a393e496B1671a5CC7481']); // Bin
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "addPoolOperator", ['0x60758B3A6933192D0Ac28Fc1f675364bb4dFAb1d']); // Shan
    await sendTransaction("BaseCreditPoolConfig", poolConfig, "addPoolOperator", [deployer.address]);

    await sendTransaction("BaseCreditPoolConfig", poolConfig, "setPoolOwnerTreasury", ['0x062E4fa7b23518B24B6D18F8FAf06dA455D768E2']);

    await transferOwnershipToTL("BasePoolConfig", "BaseCreditPoolConfig", "BaseCreditPoolTimelock");

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

    if (!deployedContracts["BaseCreditPoolTimelock"]) {
        throw new Error("BaseCreditPoolTimelock not deployed yet!");
    }

    await renounceTLAdminRole("BaseCreditPoolTimelock", deployer.address);

    await updateInitilizedContract("BaseCreditPool");
}

async function prepareBaseCreditPool() {
    // The operations commented off need to run with TL on Defender
    if (!deployedContracts["BaseCreditPool"]) {
        throw new Error("BaseCreditPool not deployed yet!");
    }

    const BaseCreditPool = await hre.ethers.getContractFactory("BaseCreditPool");
    const pool = BaseCreditPool.attach(deployedContracts["BaseCreditPool"])

    await sendTransaction("BaseCreditPool", pool, "addApprovedLender", ["0x062E4fa7b23518B24B6D18F8FAf06dA455D768E2"]);
    await sendTransaction("BaseCreditPool", pool, "addApprovedLender", [EA_ADDRESS]);
}

async function initContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    let invoicePayer;
    [
        deployer, eaService, pdsService,
    ] = await accounts;
    console.log("deployer address: " + deployer.address);
    
    deployedContracts = await getDeployedContracts();
    
    // await initHumaConfig();
    // // await initEA();
    // await initBaseCreditPoolFeeManager();
    // await initBaseCreditPoolHDT();
    // await initBaseCreditPoolConfig();
    // await initBaseCreditPool();

    await prepareBaseCreditPool();
    
}

initContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
