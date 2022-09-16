const {BigNumber} = require("ethers");
const {
    getInitilizedContract,
    updateInitilizedContracts,
    getDeployedContracts,
    sendTransaction,
    getSigner,
} = require("./utils.js");

let deployedContracts;

async function initFeeManager() {
    const initilized = await getInitilizedContract("FeeManager");
    if (initilized) {
        console.log("FeeManager is initilized yet!");
        return;
    }

    if (!deployedContracts["FeeManager"]) {
        throw new Error("FeeManager not deployed yet!");
    }

    const BaseFeeManager = await hre.ethers.getContractFactory("BaseFeeManager");
    const feeManager = BaseFeeManager.attach(deployedContracts["FeeManager"]);

    await sendTransaction("FeeManager", feeManager, "setFees", [0, 100, 0, 500]);
    await sendTransaction("FeeManager", feeManager, "setMinPrincipalRateInBps", [500]);

    await updateInitilizedContracts("FeeManager");
}
async function initHDT() {
    const initilized = await getInitilizedContract("HDT");
    if (initilized) {
        console.log("HDT is initilized yet!");
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

    await sendTransaction("HDT", hdt, "initialize", [
        "Base HDT",
        "BHDT",
        deployedContracts["USDC"],
    ]);

    await updateInitilizedContracts("HDT");
}
async function initPool() {
    const initilized = await getInitilizedContract("BaseCreditPool");
    if (initilized) {
        console.log("BaseCreditPool is initilized yet!");
        return;
    }

    if (!deployedContracts["Pool"]) {
        throw new Error("Pool not deployed yet!");
    }

    const BaseCreditPool = await hre.ethers.getContractFactory("BaseCreditPool");
    const pool = BaseCreditPool.attach(deployedContracts["Pool"]);

    if (!deployedContracts["HDT"]) {
        throw new Error("HDT not deployed yet!");
    }
    if (!deployedContracts["HumaConfig"]) {
        throw new Error("HumaConfig not deployed yet!");
    }
    if (!deployedContracts["FeeManager"]) {
        throw new Error("FeeManager not deployed yet!");
    }

    await sendTransaction("BaseCreditPool", pool, "initialize", [
        deployedContracts["HDT"],
        deployedContracts["HumaConfig"],
        deployedContracts["FeeManager"],
        "Base Credit Pool",
    ]);

    await updateInitilizedContracts("BaseCreditPool");
}

async function initContracts(mainnet = false) {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    const deployer = await accounts[0];
    console.log("deployer address: " + deployer.address);

    deployedContracts = await getDeployedContracts();

    await initFeeManager();
    await initHDT();
    await initPool();
}

initContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
