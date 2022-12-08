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

    // const USDC = await hre.ethers.getContractFactory("TestToken");
    // const usdc = USDC.attach(deployedContracts["USDC"]);

    // Add usdc as an asset supported by the protocol
    await sendTransaction("HumaConfig", humaConfig, "setLiquidityAsset", [USDC_ADDRESS, true]);

    // Set treasury for the protocol
    await sendTransaction("HumaConfig", humaConfig, "setHumaTreasury", [HUMA_OWNER_MULTI_SIG]);

    await transferOwnershipToTL("HumaConfig", "HumaConfig", "HumaConfigTimelock")

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

    await transferOwnershipToTL("BaseFeeManager", "ReceivableFactoringPoolFeeManager", "ReceivableFactoringPoolTimelock");

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

    if (!deployedContracts["ReceivableFactoringPool"]) {
        throw new Error("ReceivableFactoringPool not deployed yet!");
    }

    await sendTransaction("HDT", hdt, "initialize", [
        "Receivable HDT",
        "RHDT",
        USDC_ADDRESS,
    ]);

    await sendTransaction("HDT", hdt, "setPool", [deployedContracts["ReceivableFactoringPool"]]);

    await transferOwnershipToTL("HDT", "HDT", "ReceivableFactoringPoolTimelock");

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

    // await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "initialize", [
    //     "ReceivableFactoringPool",
    //     hdt.address,
    //     humaConfig.address,
    //     feeManager.address,
    // ]);

    const decimals = await hdt.decimals();
    const cap = BN.from(20_000).mul(BN.from(10).pow(BN.from(decimals)));
    console.log("cap: " + cap);
    // await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setPoolLiquidityCap", [
    //     cap,
    // ]);

    // await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setPool", [
    //     deployedContracts["ReceivableFactoringPool"],
    // ]);
    // await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setEvaluationAgent", [
    //     1,
    //     EA_ADDRESS,
    // ]);

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

    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "addPoolOperator", ['0x76C89c2d8cDB9299EE32673026faB8a2A177dCa4']);
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "addPoolOperator", ['0x1BACF76592Be393610cA422D7DDED282330CaED8']);
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "addPoolOperator", ['0xEC5c04192A251f6ffD42a48ad3Ee8250F7757D08']);
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "addPoolOperator", ['0x5870C74d8644DAE4Fe2a393e496B1671a5CC7481']);
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "addPoolOperator", ['0x60758B3A6933192D0Ac28Fc1f675364bb4dFAb1d']);
    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setPoolOwnerTreasury", ['0x8d90eB97BA5987A39522FaCbe6a0B847B42494a9']);

    await transferOwnershipToTL("BasePoolConfig", "ReceivableFactoringPoolConfig", "ReceivableFactoringPoolTimelock");

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

    await renounceTLAdminRole("ReceivableFactoringPoolProxyAdminTimelock", deployer.address);

    await updateInitilizedContract("ReceivableFactoringPool");
}

async function prepare() {
    await renounceTLAdminRole("ReceivableFactoringPoolProxyAdminTimelock", deployer.address);
    // if (!deployedContracts["ReceivableFactoringPool"]) {
    //     throw new Error("ReceivableFactoringPool not deployed yet!");
    // }
    // if (!deployedContracts["USDC"]) {
    //     throw new Error("USDC not deployed yet!");
    // }

    // const ReceivableFactoringPool = await hre.ethers.getContractFactory("ReceivableFactoringPool");
    // const pool = ReceivableFactoringPool.attach(deployedContracts["ReceivableFactoringPool"])
    // const poolFromrfpOperator = pool.connect(rfpOperator);

    // await sendTransaction("ReceivableFactoringPool", poolFromrfpOperator, "addApprovedLender", [
    //     deployer.address,
    // ]);
    // await sendTransaction("ReceivableFactoringPool", poolFromrfpOperator, "addApprovedLender", [ea.address]);
    // await sendTransaction("ReceivableFactoringPool", poolFromrfpOperator, "addApprovedLender", [lender.address]);
    // await sendTransaction("ReceivableFactoringPool", poolFromrfpOperator, "addApprovedLender", [rfpOwnerTreasury.address]);

    // const USDC = await hre.ethers.getContractFactory("TestToken");
    // const usdc = USDC.attach(deployedContracts["USDC"]);
    // const decimals = await usdc.decimals();

    // // Owner
    // const usdcFromPoolOwnerTreasury = await usdc.connect(rfpOwnerTreasury);
    // const poolFromPoolOwnerTreasury = await pool.connect(rfpOwnerTreasury);
    // const amountOwner = BN.from(20_000).mul(BN.from(10).pow(BN.from(decimals)));
    // console.log("owner to deposit: " + amountOwner);
    // await sendTransaction("TestToken", usdc, "mint", [rfpOwnerTreasury.address, amountOwner]);
    // await sendTransaction("TestToken", usdcFromPoolOwnerTreasury, "approve", [pool.address, amountOwner]);
    // await sendTransaction("ReceivableFactoringPool", poolFromPoolOwnerTreasury, "makeInitialDeposit", [amountOwner]);

    // // EA
    // const usdcFromEA = await usdc.connect(ea);
    // const poolFromEA = await pool.connect(ea);
    // const amountEA = BN.from(10_000).mul(BN.from(10).pow(BN.from(decimals)));
    // await sendTransaction("TestToken", usdc, "mint", [ea.address, amountEA]);
    // await sendTransaction("TestToken", usdcFromEA, "approve", [pool.address, amountEA]);
    // await sendTransaction("ReceivableFactoringPool", poolFromEA, "makeInitialDeposit", [amountEA]);

    // // await sendTransaction("ReceivableFactoringPool", pool, "enablePool", []);

    // //invoicePayer
    // const amountInvoicePayer = BN.from(10_000_000_000).mul(BN.from(10).pow(BN.from(decimals)));
    // await sendTransaction("TestToken", usdc, "mint", [invoicePayer.address, amountInvoicePayer]);
}

async function initContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    [
        deployer, eaService, pdsService
    ] = await accounts;
    console.log("deployer address: " + deployer.address);
    console.log("ea service address: " + eaService.address);
    console.log("pds service address: " + pdsService.address);

    deployedContracts = await getDeployedContracts();

    // await initHumaConfig();
    // await initFeeManager();
    // await initHDT();
    // // await initEA();
    // await initPoolConfig();
    // await initPool();

    await prepare();
}

initContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
