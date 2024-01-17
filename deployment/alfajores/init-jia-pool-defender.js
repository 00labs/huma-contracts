const {
    getInitilizedContract,
    updateInitilizedContract,
    getDeployedContracts,
    sendTransaction,
} = require("../utils.js");

let deployer, eaService;

const PDSServiceAccount = "0xD8F15c96825e1724B18dd477583E0DcCE3DfF0b1"
const treasuryAccount = "0x4062A9Eab6a49B2Be6aE4F7240D420f6fbE2e615"
const USDC_ADDRESS = "0x50dc34a634F3E29CfBad79E9cECD2759a6bA8Eae";
const poolTreasury = "0xf9f1f8b93Be684847D8DaF82b1643b2D5BB4419a"

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
    await sendTransaction("HumaConfig", humaConfig, "setLiquidityAsset", [USDC_ADDRESS, true]);

    // Set treasury for the protocol
    await sendTransaction("HumaConfig", humaConfig, "setHumaTreasury", [treasuryAccount]);

    // await transferOwnershipToTL("HumaConfig", "HumaConfig", "HumaConfigTimelock")

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
    const initilized = await getInitilizedContract("ArfNewPoolFeeManager");
    if (initilized) {
        console.log("ArfNewPoolFeeManager is already initialized!");
        return;
    }

    if (!deployedContracts["ArfNewPoolFeeManager"]) {
        throw new Error("ArfNewPoolFeeManager not deployed yet!");
    }

    const BaseFeeManager = await hre.ethers.getContractFactory("BaseFeeManager");
    const feeManager = BaseFeeManager.attach(deployedContracts["ArfNewPoolFeeManager"]);

    await sendTransaction(
        "ArfNewPoolFeeManager",
        feeManager,
        "setFees",
        [0, 0, 0, 0, 0]
    );
    await sendTransaction("FeeManager", feeManager, "setMinPrincipalRateInBps", [0]);
    
    await transferOwnershipToTL("BaseFeeManager", "ArfNewPoolFeeManager", "ArfNewPoolTimelock");

    await updateInitilizedContract("ArfNewPoolFeeManager");
}

async function initBaseCreditPoolHDT() {
    const initilized = await getInitilizedContract("ArfNewHDT");
    if (initilized) {
        console.log("ArfNewHDT is already initialized!");
        return;
    }

    if (!deployedContracts["ArfNewHDT"]) {
        throw new Error("ArfNewHDT not deployed yet!");
    }

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["ArfNewHDT"]);

    // if (!deployedContracts["USDC"]) {
    //     throw new Error("USDC not deployed yet!");
    // }

    if (!deployedContracts["ArfNewPool"]) {
        throw new Error("ArfNewPool not deployed yet!");
    }

    await sendTransaction("HDT", hdt, "initialize", [
        "Arf new HDT",
        "AHDT",
        USDC_ADDRESS,
    ]);

    await sendTransaction("HDT", hdt, "setPool", [deployedContracts["ArfNewPool"]]);
    
    // await transferOwnershipToTL("HDT", "ArfNewHDT", "ArfNewPoolTimelock");

    await updateInitilizedContract("ArfNewHDT");
}

async function initBaseCreditPoolConfig() {
    const initilized = await getInitilizedContract("ArfNewPoolConfig");
    if (initilized) {
        console.log("ArfNewPoolConfig is already initialized!");
        return;
    }

    if (!deployedContracts["ArfNewPoolConfig"]) {
        throw new Error("ArfNewPoolConfig not deployed yet!");
    }

    const ReceivableFactoringPoolConfig = await hre.ethers.getContractFactory("BasePoolConfig");
    const poolConfig = ReceivableFactoringPoolConfig.attach(
        deployedContracts["ArfNewPoolConfig"]
    );

    if (!deployedContracts["ArfNewPool"]) {
        throw new Error("ArfNewPool not deployed yet!");
    }

    if (!deployedContracts["ArfNewHDT"]) {
        throw new Error("ArfNewHDT not deployed yet!");
    }

    if (!deployedContracts["HumaConfig"]) {
        throw new Error("HumaConfig not deployed yet!");
    }

    if (!deployedContracts["ArfNewPoolFeeManager"]) {
        throw new Error("ArfNewPoolFeeManager not deployed yet!");
    }

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["ArfNewHDT"]);

    const HumaConfig = await hre.ethers.getContractFactory("HumaConfig");
    const humaConfig = HumaConfig.attach(deployedContracts["HumaConfig"]);

    const BaseFeeManager = await hre.ethers.getContractFactory("BaseFeeManager");
    const feeManager = BaseFeeManager.attach(deployedContracts["ArfNewPoolFeeManager"]);

    await sendTransaction("ArfNewPoolConfig", poolConfig, "initialize", [
        "ArfNewPool",
        hdt.address,
        humaConfig.address,
        feeManager.address,
    ]);

    const decimals = await hdt.decimals();
    console.log("decimals: " + BigInt(decimals));
    const cap = BigInt(1_000_000)*(BigInt(10)**(BigInt(decimals)));
    console.log("cap: " + cap);
    await sendTransaction("ArfNewPoolConfig", poolConfig, "setPoolLiquidityCap", [cap]);

    await sendTransaction("ArfNewPoolConfig", poolConfig, "setPool", [
        deployedContracts["ArfNewPool"],
    ]);

    await sendTransaction(
        "ArfNewPoolConfig",
        poolConfig,
        "setPoolOwnerRewardsAndLiquidity",
        [0, 0]
    );
    await sendTransaction(
        "ArfNewPoolConfig",
        poolConfig,
        "setEARewardsAndLiquidity",
        [0, 0]
    );

    // // await sendTransaction("ArfPoolConfig", poolConfig, "setEvaluationAgent", [
    // //     1,
    // //     deployer.address,
    // // ]);
  
    const maxCL = BigInt(1_000_000)*(BigInt(10)**(BigInt(decimals)));
    console.log("maxCL: " + maxCL);
    await sendTransaction("ArfNewPoolConfig", poolConfig, "setMaxCreditLine", [maxCL]);
    await sendTransaction("ArfNewPoolConfig", poolConfig, "setAPR", [1300]);
    await sendTransaction("ArfNewPoolConfig", poolConfig, "setReceivableRequiredInBps", [0]);
    await sendTransaction("ArfNewPoolConfig", poolConfig, "setPoolPayPeriod", [30]);
    await sendTransaction("ArfNewPoolConfig", poolConfig, "setPoolToken", [
        deployedContracts["ArfNewHDT"],
    ]);
    await sendTransaction("ArfNewPoolConfig", poolConfig, "setWithdrawalLockoutPeriod", [30]);
    await sendTransaction("ArfNewPoolConfig", poolConfig, "setPoolDefaultGracePeriod", [10]);
    await sendTransaction("ArfNewPoolConfig", poolConfig, "addPoolOperator", [deployer.address]);


    await sendTransaction("ArfNewPoolConfig", poolConfig, "setPoolOwnerTreasury", [poolTreasury]);

    await sendTransaction("ArfNewPoolConfig", poolConfig, "setCreditApprovalExpiration", [10]);
    
    // await transferOwnershipToTL("BasePoolConfig", "ArfNewPoolConfig", "ArfNewPoolTimelock");

    await updateInitilizedContract("ArfNewPoolConfig");
}

async function initBaseCreditPool() {
    const initilized = await getInitilizedContract("ArfNewPool");
    if (initilized) {
        console.log("ArfNewPool is already initialized!");
        return;
    }

    if (!deployedContracts["ArfNewPool"]) {
        throw new Error("ArfNewPool not deployed yet!");
    }

    if (!deployedContracts["ArfNewPoolConfig"]) {
        throw new Error("ArfNewPoolConfig not deployed yet!");
    }

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("BaseCreditPool");
    const pool = ReceivableFactoringPool.attach(deployedContracts["ArfNewPool"]);

    await sendTransaction("ArfNewPool", pool, "initialize", [
        deployedContracts["ArfNewPoolConfig"],
    ]);

    await updateInitilizedContract("ArfNewPool");
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
    if (!deployedContracts["ArfNewPool"]) {
        throw new Error("ArfNewPool not deployed yet!");
    }
    // if (!deployedContracts["USDC"]) {
    //     throw new Error("USDC not deployed yet!");
    // }

    const BaseCreditPool = await hre.ethers.getContractFactory("BaseCreditPool");
    const pool = BaseCreditPool.attach(deployedContracts["ArfNewPool"])
    // const poolFrombcpOperator = pool.connect(bcpOperator);

    // await sendTransaction("ArfNewPool", pool, "addApprovedLender", [deployer.address]);
    // // await sendTransaction("ArfNewPool", poolFrombcpOperator, "addApprovedLender", [ea_bcp.address]);
    // // await sendTransaction("ArfNewPool", poolFrombcpOperator, "addApprovedLender", [lender.address]);
    // await sendTransaction("ArfNewPool", pool, "addApprovedLender", [poolTreasury]);

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

    await sendTransaction("ArfPool", pool, "enablePool", []);
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
    // await initEA();
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
