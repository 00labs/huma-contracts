const {
    getInitilizedContract,
    updateInitilizedContract,
    getDeployedContracts,
    sendTransaction,
} = require("../utils.js");

let deployer, eaService;

const PDSServiceAccount = "0x499c50e357fed41801d118dad572f3dfb71d6d0d"
const treasuryAccount = "0x7E13931931d59f2199fE0b499534412FCD28b7Ed"
const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const poolTreasury = "0x96cfdD9531D907c21078f1BF30e87f64D84EdC07"

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

    if (!deployedContracts["EANFT"]) {
        throw new Error("EANFT not deployed yet!");
    }

    if (!deployedContracts["USDC"]) {
        throw new Error("USDC not deployed yet!");
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

    const USDC = await hre.ethers.getContractFactory("TestToken");
    const usdc = USDC.attach(deployedContracts["USDC"]);

    // Add usdc as an asset supported by the protocol
    await sendTransaction("HumaConfig", humaConfig, "setLiquidityAsset", [usdc.address, true]);

    // Set treasury for the protocol
    await sendTransaction("HumaConfig", humaConfig, "setHumaTreasury", [treasuryAccount]);

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

    const eaNFTFromEA = eaNFT.connect(deployer);
    await sendTransaction("EvaluationAgentNFT", eaNFTFromEA, "mintNFT", [deployer.address]);
    // const eaNFTFromEA_bcp = eaNFT.connect(ea);
    // await sendTransaction("EvaluationAgentNFT", eaNFTFromEA_bcp, "mintNFT", [ea_bcp.address]);
    await updateInitilizedContract("EANFT");
}

async function initBaseCreditPoolFeeManager() {
    const initilized = await getInitilizedContract("BSOSPoolFeeManager");
    if (initilized) {
        console.log("BSOSPoolFeeManager is already initialized!");
        return;
    }

    if (!deployedContracts["BSOSPoolFeeManager"]) {
        throw new Error("BSOSPoolFeeManager not deployed yet!");
    }

    const BaseFeeManager = await hre.ethers.getContractFactory("BaseFeeManager");
    const feeManager = BaseFeeManager.attach(deployedContracts["BSOSPoolFeeManager"]);

    // await sendTransaction(
    //     "BSOSPoolFeeManager",
    //     feeManager,
    //     "setFees",
    //     [0, 0, 0, 100, 0]
    // );
    // await sendTransaction("FeeManager", feeManager, "setMinPrincipalRateInBps", [0]);
    
    await transferOwnershipToTL("BaseFeeManager", "BSOSPoolFeeManager", "BSOSPoolTimelock");

    await updateInitilizedContract("BSOSPoolFeeManager");
}

async function initBaseCreditPoolHDT() {
    const initilized = await getInitilizedContract("BSOSHDT");
    if (initilized) {
        console.log("BSOSHDT is already initialized!");
        BSOS
    }

    if (!deployedContracts["BSOSHDT"]) {
        throw new Error("BSOSHDT not deployed yet!");
    }

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["BSOSHDT"]);

    // if (!deployedContracts["USDC"]) {
    //     throw new Error("USDC not deployed yetBSOS  // }

    if (!deployedContracts["BSOSPool"]) {
        throw new Error("BSOSPool not deployed yet!");
    }

    await sendTransaction("HDT", hdt, "initialize", [
        "BSOS HDT",
        "BHDT",
        USDC_ADDRESS,
    ]);

    await sendTransaction("HDT", hdt, "setPool", [deployedContracts["BSOSPool"]]);
    
    await transferOwnershipToTL("HDT", "BSOSHDT", "BSOSPoolTimelock");

    await updateInitilizedContract("BSOSHDT");
}

async function initBaseCreditPoolConfig() {
    const initilized = await getInitilizedContract("BSOSPoolConfig");
    if (initilized) {
        console.log("BSOSPoolConfig is already initialized!");
        return;
    }

    if (!deployedContracts["BSOSPoolConfig"]) {
        throw new Error("BSOSPoolConfig not deployed yet!");
    }

    const ReceivableFactoringPoolConfig = await hre.ethers.getContractFactory("BasePoolConfig");
    const poolConfig = ReceivableFactoringPoolConfig.attach(
        deployedContracts["BSOSPoolConfig"]
    );

    if (!deployedContracts["BSOSPool"]) {
        throw new Error("BSOSPool not deployed yet!");
    }

    if (!deployedContracts["BSOSHDT"]) {
        throw new Error("BSOSHDT not deployed yet!");
    }

    if (!deployedContracts["HumaConfig"]) {
        throw new Error("HumaConfig not deployed yet!");
    }

    if (!deployedContracts["BSOSPoolFeeManager"]) {
        throw new Error("BSOSPoolFeeManager not deployed yet!");
    }

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["BSOSHDT"]);

    const HumaConfig = await hre.ethers.getContractFactory("HumaConfig");
    const humaConfig = HumaConfig.attach(deployedContracts["HumaConfig"]);

    const BaseFeeManager = await hre.ethers.getContractFactory("BaseFeeManager");
    const feeManager = BaseFeeManager.attach(deployedContracts["BSOSPoolFeeManager"]);

    await sendTransaction("BSOSPoolConfig", poolConfig, "initialize", [
        "BSOSPool",
        hdt.address,
        humaConfig.address,
        feeManager.address,
    ]);

    const decimals = await hdt.decimals();
    console.log("decimals: " + BigInt(decimals));
    const cap = BigInt(50_000)*(BigInt(10)**(BigInt(decimals)));
    console.log("cap: " + cap);
    await sendTransaction("BSOSPoolConfig", poolConfig, "setPoolLiquidityCap", [cap]);

    await sendTransaction("BSOSPoolConfig", poolConfig, "setPool", [
        deployedContracts["BSOSPool"],
    ]);

    await sendTransaction(
        "BSOSPoolConfig",
        poolConfig,
        "setPoolOwnerRewardsAndLiquidity",
        [500, 500]
    );
    await sendTransaction(
        "BSOSPoolConfig",
        poolConfig,
        "setEARewardsAndLiquidity",
        [0, 0]
    );

    // // await sendTransaction("ArfPoolConfig", poolConfig, "setEvaluationAgent", [
    // //     1,
    // //     deployer.address,
    // // ]);
  
    const maxCL = BigInt(50_000)*(BigInt(10)**(BigInt(decimals)));
    console.log("maxCL: " + maxCL);
    await sendTransaction("BSOSPoolConfig", poolConfig, "setMaxCreditLine", [maxCL]);
    await sendTransaction("BSOSPoolConfig", poolConfig, "setAPR", [1300]);
    await sendTransaction("BSOSPoolConfig", poolConfig, "setReceivableRequiredInBps", [0]);
    await sendTransaction("BSOSPoolConfig", poolConfig, "setPoolPayPeriod", [30]);
    await sendTransaction("BSOSPoolConfig", poolConfig, "setPoolToken", [
        deployedContracts["BSOSHDT"],
    ]);
    await sendTransaction("BSOSPoolConfig", poolConfig, "setWithdrawalLockoutPeriod", [90]);
    await sendTransaction("BSOSPoolConfig", poolConfig, "setPoolDefaultGracePeriod", [90]);
    await sendTransaction("BSOSPoolConfig", poolConfig, "addPoolOperator", [deployer.address]);


    await sendTransaction("BSOSPoolConfig", poolConfig, "setPoolOwnerTreasury", [poolTreasury]);

    await sendTransaction("BSOSPoolConfig", poolConfig, "setCreditApprovalExpiration", [10]);
    
    await transferOwnershipToTL("BasePoolConfig", "BSOSPoolConfig", "BSOSPoolTimelock");

    await updateInitilizedContract("BSOSPoolConfig");
}

async function initBaseCreditPool() {
    const initilized = await getInitilizedContract("BSOSPool");
    if (initilized) {
        console.log("BSOSPool is already initialized!");
        return;
    }

    if (!deployedContracts["BSOSPool"]) {
        throw new Error("BSOSPool not deployed yet!");
    }

    if (!deployedContracts["BSOSPoolConfig"]) {
        throw new Error("BSOSPoolConfig not deployed yet!");
    }

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("BaseCreditPool");
    const pool = ReceivableFactoringPool.attach(deployedContracts["BSOSPool"]);

    await sendTransaction("BSOSPool", pool, "initialize", [
        deployedContracts["BSOSPoolConfig"],
    ]);

    await updateInitilizedContract("BSOSPool");
}

async function initRWR() {
    const initilized = await getInitilizedContract("RWReceivable");
    if (initilized) {
        console.log("RWReceivable is already initialized!");
        return;
    }

    if (!deployedContracts["RWReceivable"]) {
        throw new Error("RWReceivable not deployed yet!");
    }

    const RealWorldReceivable = await hre.ethers.getContractFactory("RealWorldReceivable");
    const rwReceivable = RealWorldReceivable.attach(deployedContracts["RWReceivable"]);

    await sendTransaction("RWReceivable", rwReceivable, "initialize", []);

    await updateInitilizedContract("RWReceivable");
}

async function prepareBaseCreditPool() {
    // The operations commented off need to run with TL on Defender
    if (!deployedContracts["BSOSPool"]) {
        throw new Error("BSOSPool not deployed yet!");
    }
    // if (!deployedContracts["USDC"]) {
    //     throw new Error("USDC not deployed yet!");
    // }

    const BaseCreditPool = await hre.ethers.getContractFactory("BaseCreditPool");
    const pool = BaseCreditPool.attach(deployedContracts["BSOSPool"])
    // const poolFrombcpOperator = pool.connect(bcpOperator);

    // await sendTransaction("BSOSPool", pool, "addApprovedLender", [deployer.address]);
    // // await sendTransaction("BSOSPool", poolFrombcpOperator, "addApprovedLender", [ea_bcp.address]);
    // // await sendTransaction("BSOSPool", poolFrombcpOperator, "addApprovedLender", [lender.address]);
    await sendTransaction("BSOSPool", pool, "addApprovedLender", [poolTreasury]);

    // const USDC = await hre.ethers.getContractFactory("TestToken");
    // const usdc = USDC.attach(deployedContracts["USDC"]);
    // const decimals = await usdc.decimals();

    // Owner
    // const usdcFromPoolOwnerTreasury = await usdc.connect(poolTreasury);
    // const poolFromPoolOwnerTreasury = await pool.connect(poolTreasury);
    // const amountOwner = BigInt(20_000)*(BigInt(10)**(BigInt(decimals)));
    // console.log("owner to deposit: " + amountOwner);
    // await sendTransaction("TestToken", usdc, "mint", [poolTreasury.address, amountOwner]);
    // await sendTransaction("TestToken", usdcFromPoolOwnerTreasury, "approve", [pool.address, amountOwner]);
    // await sendTransaction("ArfPool", poolFromPoolOwnerTreasury, "makeInitialDeposit", [amountOwner]);

    // EA
    // const usdcFromEA = await usdc.connect(ea_bcp);
    // const poolFromEA = await pool.connect(ea_bcp);
    // const amountEA = BigInt(10_000)*(BigInt(10)**(BigInt(decimals)));
    // await sendTransaction("TestToken", usdc, "mint", [ea_bcp.address, amountEA]);
    // await sendTransaction("TestToken", usdcFromEA, "approve", [poolFromEA.address, amountEA]);
    // await sendTransaction("BaseCreditPool", poolFromEA, "makeInitialDeposit", [amountEA]);

    // await sendTransaction("ArfPool", pool, "enablePool", []);
}

async function initContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    let invoicePayer;
    [
        deployer, eaService  //, poolTreasury
    ] = await accounts;
    console.log("deployer address: " + deployer.address);
    // console.log("ea address: " + eaService.address);

    deployedContracts = await getDeployedContracts();
    
    await initHumaConfig();
    await initEA();
    await initBaseCreditPoolFeeManager();
    await initBaseCreditPoolHDT();
    await initBaseCreditPoolConfig();
    await initBaseCreditPool();
    await initRWR();

    await prepareBaseCreditPool();
    
}

initContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
