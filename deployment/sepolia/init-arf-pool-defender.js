const {
    getInitilizedContract,
    updateInitilizedContract,
    getDeployedContracts,
    sendTransaction,
} = require("../utils.js");

let deployer, eaService;

const PDSServiceAccount = "0x4b2ea800c9791ea68faa284a69ac0df226eafa2b"
const treasuryAccount = "0x37f3591F7Ee1D53Ea445b710e6310FF3F92D5446"
// const poolTreasury = "0x942836828c2fbb046CE8C944d61143a0cE3608A5"

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
    const initilized = await getInitilizedContract("ArfPoolFeeManager");
    if (initilized) {
        console.log("ArfPoolFeeManager is already initialized!");
        return;
    }

    if (!deployedContracts["ArfPoolFeeManager"]) {
        throw new Error("ArfPoolFeeManager not deployed yet!");
    }

    const BaseFeeManager = await hre.ethers.getContractFactory("BaseFeeManager");
    const feeManager = BaseFeeManager.attach(deployedContracts["ArfPoolFeeManager"]);

    await sendTransaction(
        "ArfPoolFeeManager",
        feeManager,
        "setFees",
        [10_000_000, 0, 20_000_000, 0, 0]
    );
    // await sendTransaction("FeeManager", feeManager, "setMinPrincipalRateInBps", [0]);
    
    await transferOwnershipToTL("BaseFeeManager", "ArfPoolFeeManager", "ArfPoolTimelock");

    await updateInitilizedContract("ArfPoolFeeManager");
}

async function initBaseCreditPoolHDT() {
    const initilized = await getInitilizedContract("ArfHDT");
    if (initilized) {
        console.log("ArfHDT is already initialized!");
        return;
    }

    if (!deployedContracts["ArfHDT"]) {
        throw new Error("ArfHDT not deployed yet!");
    }

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["ArfHDT"]);

    if (!deployedContracts["USDC"]) {
        throw new Error("USDC not deployed yet!");
    }

    if (!deployedContracts["ArfPool"]) {
        throw new Error("ArfPool not deployed yet!");
    }

    await sendTransaction("HDT", hdt, "initialize", [
        "Arf HDT",
        "AHDT",
        deployedContracts["USDC"],
    ]);

    await sendTransaction("HDT", hdt, "setPool", [deployedContracts["ArfPool"]]);
    
    await transferOwnershipToTL("HDT", "ArfHDT", "ArfPoolTimelock");

    await updateInitilizedContract("ArfHDT");
}

async function initBaseCreditPoolConfig() {
    const initilized = await getInitilizedContract("ArfPoolConfig");
    if (initilized) {
        console.log("ArfPoolConfig is already initialized!");
        return;
    }

    if (!deployedContracts["ArfPoolConfig"]) {
        throw new Error("ArfPoolConfig not deployed yet!");
    }

    const ReceivableFactoringPoolConfig = await hre.ethers.getContractFactory("BasePoolConfig");
    const poolConfig = ReceivableFactoringPoolConfig.attach(
        deployedContracts["ArfPoolConfig"]
    );

    if (!deployedContracts["ArfPool"]) {
        throw new Error("ArfPool not deployed yet!");
    }

    if (!deployedContracts["ArfHDT"]) {
        throw new Error("ArfHDT not deployed yet!");
    }

    if (!deployedContracts["HumaConfig"]) {
        throw new Error("HumaConfig not deployed yet!");
    }

    if (!deployedContracts["ArfPoolFeeManager"]) {
        throw new Error("ArfPoolFeeManager not deployed yet!");
    }

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["ArfHDT"]);

    const HumaConfig = await hre.ethers.getContractFactory("HumaConfig");
    const humaConfig = HumaConfig.attach(deployedContracts["HumaConfig"]);

    const BaseFeeManager = await hre.ethers.getContractFactory("BaseFeeManager");
    const feeManager = BaseFeeManager.attach(deployedContracts["ArfPoolFeeManager"]);

    // await sendTransaction("ArfPoolConfig", poolConfig, "initialize", [
    //     "ArfPool",
    //     hdt.address,
    //     humaConfig.address,
    //     feeManager.address,
    // ]);

    const decimals = await hdt.decimals();
    console.log("decimals: " + BigInt(decimals));
    const cap = BigInt(1_000_000)*(BigInt(10)**(BigInt(decimals)));
    console.log("cap: " + cap);
    await sendTransaction("ArfPoolConfig", poolConfig, "setPoolLiquidityCap", [cap]);

    await sendTransaction("ArfPoolConfig", poolConfig, "setPool", [
        deployedContracts["ArfPool"],
    ]);

    await sendTransaction(
        "ArfPoolConfig",
        poolConfig,
        "setPoolOwnerRewardsAndLiquidity",
        [500, 200]
    );
    await sendTransaction(
        "ArfPoolConfig",
        poolConfig,
        "setEARewardsAndLiquidity",
        [0, 0]
    );

    await sendTransaction("ArfPoolConfig", poolConfig, "setEvaluationAgent", [
        1,
        deployer.address,
    ]);
    
    const maxCL = BigInt(10_000)*(BigInt(10)**(BigInt(decimals)));
    console.log("maxCL: " + maxCL);
    await sendTransaction("ArfPoolConfig", poolConfig, "setMaxCreditLine", [maxCL]);
    await sendTransaction("ArfPoolConfig", poolConfig, "setAPR", [1000]);
    await sendTransaction("ArfPoolConfig", poolConfig, "setReceivableRequiredInBps", [0]);
    await sendTransaction("ArfPoolConfig", poolConfig, "setPoolPayPeriod", [15]);
    await sendTransaction("ArfPoolConfig", poolConfig, "setPoolToken", [
        deployedContracts["ArfHDT"],
    ]);
    await sendTransaction("ArfPoolConfig", poolConfig, "setWithdrawalLockoutPeriod", [0]);
    await sendTransaction("ArfPoolConfig", poolConfig, "setPoolDefaultGracePeriod", [60]);
    await sendTransaction("ArfPoolConfig", poolConfig, "addPoolOperator", [deployer.address]);
    await sendTransaction("ArfPoolConfig", poolConfig, "setPoolOwnerTreasury", [poolTreasury.address]);

    await sendTransaction("ArfPoolConfig", poolConfig, "setCreditApprovalExpiration", [30]);
    
    await transferOwnershipToTL("BasePoolConfig", "ArfPoolConfig", "ArfPoolTimelock");

    await updateInitilizedContract("ArfPoolConfig");
}

async function initBaseCreditPool() {
    const initilized = await getInitilizedContract("ArfPool");
    if (initilized) {
        console.log("ArfPool is already initialized!");
        return;
    }

    if (!deployedContracts["ArfPool"]) {
        throw new Error("ArfPool not deployed yet!");
    }

    if (!deployedContracts["ArfPoolConfig"]) {
        throw new Error("ArfPoolConfig not deployed yet!");
    }

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("BaseCreditPool");
    const pool = ReceivableFactoringPool.attach(deployedContracts["ArfPool"]);

    await sendTransaction("ArfPool", pool, "initialize", [
        deployedContracts["ArfPoolConfig"],
    ]);

    await updateInitilizedContract("ArfPool");
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
    if (!deployedContracts["ArfPool"]) {
        throw new Error("ArfPool not deployed yet!");
    }
    if (!deployedContracts["USDC"]) {
        throw new Error("USDC not deployed yet!");
    }

    const BaseCreditPool = await hre.ethers.getContractFactory("BaseCreditPool");
    const pool = BaseCreditPool.attach(deployedContracts["ArfPool"])
    // const poolFrombcpOperator = pool.connect(bcpOperator);

    await sendTransaction("ArfPool", poolFrombcpOperator, "addApprovedLender", [deployer.address]);
    // await sendTransaction("ArfPool", poolFrombcpOperator, "addApprovedLender", [ea_bcp.address]);
    // await sendTransaction("ArfPool", poolFrombcpOperator, "addApprovedLender", [lender.address]);
    await sendTransaction("ArfPool", poolFrombcpOperator, "addApprovedLender", [poolTreasury.address]);

    const USDC = await hre.ethers.getContractFactory("TestToken");
    const usdc = USDC.attach(deployedContracts["USDC"]);
    const decimals = await usdc.decimals();

    // Owner
    const usdcFromPoolOwnerTreasury = await usdc.connect(poolTreasury);
    const poolFromPoolOwnerTreasury = await pool.connect(poolTreasury);
    const amountOwner = BigInt(20_000)*(BigInt(10)**(BigInt(decimals)));
    console.log("owner to deposit: " + amountOwner);
    await sendTransaction("TestToken", usdc, "mint", [bcpOwnerTreasury.address, amountOwner]);
    await sendTransaction("TestToken", usdcFromPoolOwnerTreasury, "approve", [pool.address, amountOwner]);
    await sendTransaction("ArfPool", poolFromPoolOwnerTreasury, "makeInitialDeposit", [amountOwner]);

    // EA
    // const usdcFromEA = await usdc.connect(ea_bcp);
    // const poolFromEA = await pool.connect(ea_bcp);
    // const amountEA = BigInt(10_000)*(BigInt(10)**(BigInt(decimals)));
    // await sendTransaction("TestToken", usdc, "mint", [ea_bcp.address, amountEA]);
    // await sendTransaction("TestToken", usdcFromEA, "approve", [poolFromEA.address, amountEA]);
    // await sendTransaction("BaseCreditPool", poolFromEA, "makeInitialDeposit", [amountEA]);

    // await sendTransaction("BaseCreditPool", pool, "enablePool", []);
}

async function initContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    let invoicePayer;
    [
        deployer, eaService, poolTreasury
    ] = await accounts;
    console.log("deployer address: " + deployer.address);
    console.log("ea address: " + eaService.address);

    deployedContracts = await getDeployedContracts();
    
    await initHumaConfig();
    await initEA();
    await initBaseCreditPoolFeeManager();
    await initBaseCreditPoolHDT();
    await initBaseCreditPoolConfig();
    await initBaseCreditPool();
    await initRWR();

    // await prepareBaseCreditPool();
    
}

initContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
