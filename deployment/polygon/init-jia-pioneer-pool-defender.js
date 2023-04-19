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
const POOL_OWNER_MULTI_SIG = "0x06AE4a3bc855c0046F18F4Bdf1Ac6617dc0001B5";
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
    const initilized = await getInitilizedContract("JiaPioneerPoolFeeManager");
    if (initilized) {
        console.log("JiaPioneerPoolFeeManager is already initialized!");
        return;
    }

    if (!deployedContracts["JiaPioneerPoolFeeManager"]) {
        throw new Error("JiaPioneerPoolFeeManager not deployed yet!");
    }

    const BaseFeeManager = await hre.ethers.getContractFactory("BaseFeeManager");
    const feeManager = BaseFeeManager.attach(deployedContracts["JiaPioneerPoolFeeManager"]);

    await sendTransaction(
        "JiaPioneerPoolFeeManager",
        feeManager,
        "setFees",
        [0, 0, 0, 10, 0]
    );
    await sendTransaction("FeeManager", feeManager, "setMinPrincipalRateInBps", [0]);
    
    await transferOwnershipToTL("BaseFeeManager", "JiaPioneerPoolFeeManager", "JiaPioneerPoolTimelock");

    await updateInitilizedContract("JiaPioneerPoolFeeManager");
}

async function initBaseCreditPoolHDT() {
    const initilized = await getInitilizedContract("JiaPioneerHDT");
    if (initilized) {
        console.log("JiaPioneerHDT is already initialized!");
        return;
    }

    if (!deployedContracts["JiaPioneerHDT"]) {
        throw new Error("JiaPioneerHDT not deployed yet!");
    }

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["JiaPioneerHDT"]);

    if (!deployedContracts["JiaPioneerPool"]) {
        throw new Error("JiaPioneerPool not deployed yet!");
    }

    await sendTransaction("HDT", hdt, "initialize", [
        "Jia Pioneer HDT",
        "JHDT",
        USDC_ADDRESS,
    ]);

    await sendTransaction("HDT", hdt, "setPool", [deployedContracts["JiaPioneerPool"]]);
    
    await transferOwnershipToTL("HDT", "JiaPioneerHDT", "JiaPioneerPoolTimelock");

    await updateInitilizedContract("JiaPioneerHDT");
}

async function initBaseCreditPoolConfig() {
    const initilized = await getInitilizedContract("JiaPioneerPoolConfig");
    if (initilized) {
        console.log("JiaPioneerPoolConfig is already initialized!");
        return;
    }

    if (!deployedContracts["JiaPioneerPoolConfig"]) {
        throw new Error("JiaPioneerPoolConfig not deployed yet!");
    }

    const ReceivableFactoringPoolConfig = await hre.ethers.getContractFactory("BasePoolConfig");
    const poolConfig = ReceivableFactoringPoolConfig.attach(
        deployedContracts["JiaPioneerPoolConfig"]
    );

    if (!deployedContracts["JiaPioneerPool"]) {
        throw new Error("JiaPioneerPool not deployed yet!");
    }

    if (!deployedContracts["JiaPioneerHDT"]) {
        throw new Error("JiaPioneerHDT not deployed yet!");
    }

    if (!deployedContracts["HumaConfig"]) {
        throw new Error("HumaConfig not deployed yet!");
    }

    if (!deployedContracts["JiaPioneerPoolFeeManager"]) {
        throw new Error("JiaPioneerPoolFeeManager not deployed yet!");
    }

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["JiaPioneerHDT"]);

    const HumaConfig = await hre.ethers.getContractFactory("HumaConfig");
    const humaConfig = HumaConfig.attach(deployedContracts["HumaConfig"]);

    const BaseFeeManager = await hre.ethers.getContractFactory("BaseFeeManager");
    const feeManager = BaseFeeManager.attach(deployedContracts["JiaPioneerPoolFeeManager"]);

    await sendTransaction("JiaPioneerPoolConfig", poolConfig, "initialize", [
        "JiaPioneerPool",
        hdt.address,
        humaConfig.address,
        feeManager.address,
    ]);

    const decimals = await hdt.decimals();
    const cap = BN.from(500_000).mul(BN.from(10).pow(BN.from(decimals)));
    console.log("cap: " + cap);
    await sendTransaction("JiaPioneerPoolConfig", poolConfig, "setPoolLiquidityCap", [cap]);

    await sendTransaction("JiaPioneerPoolConfig", poolConfig, "setPool", [
        deployedContracts["JiaPioneerPool"],
    ]);
    await sendTransaction("JiaPioneerPoolConfig", poolConfig, "setEvaluationAgent", [
        2,
        EA_ADDRESS,
    ]);

    await sendTransaction(
        "JiaPioneerPoolConfig",
        poolConfig,
        "setPoolOwnerRewardsAndLiquidity",
        [0, 0]
    );
    await sendTransaction(
        "JiaPioneerPoolConfig",
        poolConfig,
        "setEARewardsAndLiquidity",
        [0, 0]
    );
    const maxCL = BN.from(500_000).mul(BN.from(10).pow(BN.from(decimals)));
    console.log("maxCL: " + maxCL);
    await sendTransaction("JiaPioneerPoolConfig", poolConfig, "setMaxCreditLine", [maxCL]);
    await sendTransaction("JiaPioneerPoolConfig", poolConfig, "setAPR", [1000]);
    await sendTransaction("JiaPioneerPoolConfig", poolConfig, "setReceivableRequiredInBps", [0]);
    await sendTransaction("JiaPioneerPoolConfig", poolConfig, "setPoolPayPeriod", [30]);
    await sendTransaction("JiaPioneerPoolConfig", poolConfig, "setPoolToken", [
        deployedContracts["JiaPioneerHDT"],
    ]);
    await sendTransaction("JiaPioneerPoolConfig", poolConfig, "setWithdrawalLockoutPeriod", [365]);
    await sendTransaction("JiaPioneerPoolConfig", poolConfig, "setPoolDefaultGracePeriod", [60]);

    await sendTransaction("JiaPioneerPoolConfig", poolConfig, "addPoolOperator", ['0x1d0C14ef74D4F76B218df9Cd752b3a831C20A909']); // Richard-pool
    await sendTransaction("JiaPioneerPoolConfig", poolConfig, "addPoolOperator", ['0xCCE6e1b4b83D4133C20C3Bd961c519325fac9e8F']); // Erbil-pool
    await sendTransaction("JiaPioneerPoolConfig", poolConfig, "addPoolOperator", ['0xB40a6D4C73766F769Cb3393B62488Fd57db04AA4']); // Ji-pool
    await sendTransaction("JiaPioneerPoolConfig", poolConfig, "addPoolOperator", [deployer.address]);

    await sendTransaction("JiaPioneerPoolConfig", poolConfig, "setPoolOwnerTreasury", ['0xd4F254006d486688cE7515199C55266C581B949A']);

    await transferOwnershipToTL("BasePoolConfig", "JiaPioneerPoolConfig", "JiaPioneerPoolTimelock");

    await updateInitilizedContract("JiaPioneerPoolConfig");
}

async function initBaseCreditPool() {
    const initilized = await getInitilizedContract("JiaPioneerPool");
    if (initilized) {
        console.log("JiaPioneerPool is already initialized!");
        return;
    }

    if (!deployedContracts["JiaPioneerPool"]) {
        throw new Error("JiaPioneerPool not deployed yet!");
    }

    if (!deployedContracts["JiaPioneerPoolConfig"]) {
        throw new Error("JiaPioneerPoolConfig not deployed yet!");
    }

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("BaseCreditPool");
    const pool = ReceivableFactoringPool.attach(deployedContracts["JiaPioneerPool"]);

    await sendTransaction("JiaPioneerPool", pool, "initialize", [
        deployedContracts["JiaPioneerPoolConfig"],
    ]);

    if (!deployedContracts["JiaPioneerPoolTimelock"]) {
        throw new Error("JiaPioneerPoolTimelock not deployed yet!");
    }

    await renounceTLAdminRole("JiaPioneerPoolTimelock", deployer.address);

    await updateInitilizedContract("JiaPioneerPool");
}

async function prepareBaseCreditPool() {
    // The operations commented off need to run with TL on Defender
    if (!deployedContracts["JiaPioneerPool"]) {
        throw new Error("JiaPioneerPool not deployed yet!");
    }

    const JiaPioneerPool = await hre.ethers.getContractFactory("BaseCreditPool");
    const pool = JiaPioneerPool.attach(deployedContracts["JiaPioneerPool"])

    await sendTransaction("JiaPioneerPool", pool, "addApprovedLender", ["0x062E4fa7b23518B24B6D18F8FAf06dA455D768E2"]);
    await sendTransaction("JiaPioneerPool", pool, "addApprovedLender", [EA_ADDRESS]);
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
    
    await initHumaConfig();
    // await initEA();
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
