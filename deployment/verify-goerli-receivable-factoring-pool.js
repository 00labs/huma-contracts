const execSync = require('child_process').execSync;
const {
    getDeployedContracts,
    getVerifiedContract,
    updateVerifiedContract,
} = require("./utils.js");
const net = require("net");

let deployedContracts;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function etherscanVerify(contractName, contractAddress, argsFilePath, logMessage) {
    let network = (await hre.ethers.provider.getNetwork()).name;
    await sleep(5000);
    logMessage = !logMessage ? contractAddress : logMessage;
    console.log(`Verifying ${contractName}:${logMessage}`)
    const command = !argsFilePath ? `yarn hardhat verify '${contractAddress}' --network ${network}` : `yarn hardhat verify ${contractAddress} --constructor-args ${argsFilePath} --network ${network}`
    const verifyResult = execSync(command)
    console.log(verifyResult)
    console.log(`Verifying ${contractName}:${logMessage} ended!`)
}

async function verifyPool() {
    const verified = await getVerifiedContract("ReceivableFactoringPool");
    if (verified) {
        console.log("ReceivableFactoringPool is already verified!");
        return;
    }

    if (!deployedContracts["ReceivableFactoringPool"]) {
        throw new Error("ReceivableFactoringPool not deployed yet!");
    }

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("ReceivableFactoringPool");
    const pool = ReceivableFactoringPool.attach(deployedContracts["ReceivableFactoringPool"]);

    await etherscanVerify(pool.address)

    await updateVerifiedContract("ReceivableFactoringPool");
}

async function verifyPoolImpl() {
    const verified = await getVerifiedContract("ReceivableFactoringPoolImpl");
    if (verified) {
        console.log("ReceivableFactoringPoolImpl is already verified!");
        return;
    }

    if (!deployedContracts["ReceivableFactoringPoolImpl"]) {
        throw new Error("ReceivableFactoringPoolImpl not deployed yet!");
    }

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("ReceivableFactoringPool");
    const pool = ReceivableFactoringPool.attach(deployedContracts["ReceivableFactoringPoolImpl"]);

    await etherscanVerify("ReceivableFactoringPoolImpl", pool.address)

    await updateVerifiedContract("ReceivableFactoringPoolImpl");
}

async function verifyContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    deployedContracts = await getDeployedContracts();

    // await verifyPool();
    await verifyPoolImpl();
}

verifyContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
