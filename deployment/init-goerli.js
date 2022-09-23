const {BigNumber: BN} = require("ethers");
const {
    getInitilizedContract,
    updateInitilizedContract,
    getDeployedContracts,
    sendTransaction,
} = require("./utils.js");

const EA_SERVICE_ACCOUNT = "0xDE5Db91B5F82f8b8c085fA9C5F290B00A0101D81";

let deployer, deployedContracts;
let lender, ea;

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

    const TimelockController = await hre.ethers.getContractFactory("TimelockController");
    const humaConfigTL = TimelockController.attach(deployedContracts["HumaConfigTimelock"]);

    await sendTransaction("HumaConfig", humaConfig, "setProtocolDefaultGracePeriod", [
        30 * 24 * 3600,
    ]);
    await sendTransaction("HumaConfig", humaConfig, "setTreasuryFee", [500]);
    await sendTransaction("HumaConfig", humaConfig, "setEANFTContractAddress", [
        deployedContracts["EANFT"],
    ]);
    await sendTransaction("HumaConfig", humaConfig, "setEAServiceAccount", [EA_SERVICE_ACCOUNT]);

    await sendTransaction("HumaConfig", humaConfig, "transferOwnership", [humaConfigTL.address]);
    const adminRole = await humaConfigTL.TIMELOCK_ADMIN_ROLE();
    await sendTransaction("HumaConfigTimelock", humaConfigTL, "renounceRole", [
        adminRole,
        deployer.address,
    ]);

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
        [0, 500, 0, 500]
    );
    // await sendTransaction("FeeManager", feeManager, "setMinPrincipalRateInBps", [0]);

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

    if (!deployedContracts["USDC"]) {
        throw new Error("USDC not deployed yet!");
    }

    if (!deployedContracts["ReceivableFactoringPool"]) {
        throw new Error("ReceivableFactoringPool not deployed yet!");
    }

    await sendTransaction("HDT", hdt, "initialize", [
        "Base HDT",
        "BHDT",
        deployedContracts["USDC"],
    ]);

    await sendTransaction("HDT", hdt, "setPool", [deployedContracts["ReceivableFactoringPool"]]);

    await updateInitilizedContract("HDT");
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

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("ReceivableFactoringPool");
    const pool = ReceivableFactoringPool.attach(deployedContracts["ReceivableFactoringPool"]);

    if (!deployedContracts["HDT"]) {
        throw new Error("HDT not deployed yet!");
    }
    if (!deployedContracts["HumaConfig"]) {
        throw new Error("HumaConfig not deployed yet!");
    }
    if (!deployedContracts["ReceivableFactoringPoolFeeManager"]) {
        throw new Error("ReceivableFactoringPoolFeeManager not deployed yet!");
    }

    await sendTransaction("ReceivableFactoringPool", pool, "initialize", [
        deployedContracts["HDT"],
        deployedContracts["HumaConfig"],
        deployedContracts["ReceivableFactoringPoolFeeManager"],
        "Receivable Factoring Pool",
    ]);

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["HDT"]);
    const decimals = await hdt.decimals();
    const cap = BN.from(1_000_000).mul(BN.from(10).pow(BN.from(decimals)));
    console.log("cap: " + cap);

    await sendTransaction("ReceivableFactoringPool", pool, "setPoolLiquidityCap", [cap]);
    await sendTransaction(
        "ReceivableFactoringPool",
        pool,
        "setPoolOwnerRewardsAndLiquidity",
        [500, 200]
    );
    await sendTransaction(
        "ReceivableFactoringPool",
        pool,
        "setEARewardsAndLiquidity",
        [1000, 100]
    );
    const maxCL = BN.from(1_000).mul(BN.from(10).pow(BN.from(decimals)));
    console.log("maxCL: " + maxCL);
    await sendTransaction("ReceivableFactoringPool", pool, "setMaxCreditLine", [maxCL]);
    await sendTransaction("ReceivableFactoringPool", pool, "setAPR", [1000]);
    await sendTransaction("ReceivableFactoringPool", pool, "setReceivableRequiredInBps", [10000]);
    await sendTransaction("ReceivableFactoringPool", pool, "setPoolPayPeriod", [30]);
    await sendTransaction("ReceivableFactoringPool", pool, "setWithdrawalLockoutPeriod", [90]);
    await sendTransaction("ReceivableFactoringPool", pool, "setPoolDefaultGracePeriod", [60]);

    await updateInitilizedContract("ReceivableFactoringPool");
}

async function prepare() {
    // prepare lender, browser accounts
    // makeInitialDeposit
    // enable pool
    if (!deployedContracts["ReceivableFactoringPool"]) {
        throw new Error("ReceivableFactoringPool not deployed yet!");
    }
    if (!deployedContracts["USDC"]) {
        throw new Error("USDC not deployed yet!");
    }
    const USDC = await hre.ethers.getContractFactory("TestToken");
    const usdc = USDC.attach(deployedContracts["USDC"]);
    await sendTransaction("TestToken", usdc,
        "mint", [lender.address, 1_000_000*10**6])
    await sendTransaction("TestToken", usdc,
        "mint", [ea.address, 2_000_000*10**6])

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("ReceivableFactoringPool");
    const pool = ReceivableFactoringPool.attach(deployedContracts["ReceivableFactoringPool"]);
    await sendTransaction("ReceivableFactoringPool", pool,
        "setEvaluationAgent", [1, ea.address])

    await sendTransaction("ReceivableFactoringPool", pool,
        "addApprovedLender", [deployer.address])
    await sendTransaction("ReceivableFactoringPool", pool,
        "addApprovedLender", [ea.address])
    await sendTransaction("ReceivableFactoringPool", pool,
        "addApprovedLender", [lender.address])

    await sendTransaction("TestToken", usdc,
        "approve", [pool.address, 20_000])
    await sendTransaction("ReceivableFactoringPool", pool,
        "makeInitialDeposit", [20_000])

    await usdc.connect(ea).approve(pool.address, 10_000);
    await pool.connect(ea).makeInitialDeposit(10_000);

    await expect(pool.connect(deployer).enablePool()).to.emit(
        pool,
        "PoolEnabled"
    );
}

async function initContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    [deployer, proxyOwner, lender, ea] = await accounts;
    console.log("deployer address: " + deployer.address);
    console.log("lender address: " + lender.address);
    console.log("ea address: " + ea.address);

    deployedContracts = await getDeployedContracts();

    await initHumaConfig();
    await initFeeManager();
    await initHDT();
    await initPool();

    await prepare();
}

initContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
