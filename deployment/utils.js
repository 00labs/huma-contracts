const fs = require("fs");
const DEPLOYED_PATH = "./deployment/";

const MAX_FEE_PER_GAS = 100_000000000;
const MAX_PRIORITY_FEE_PER_GAS = 10_000000000;

const getContractAddressFile = async function (fileType = "deployed") {
    let network = (await hre.ethers.provider.getNetwork()).name;
    // console.log('network : ', network)
    network = network == "unknown" ? "localhost" : network;
    const contractAddressFile = `${DEPLOYED_PATH}${network}-${fileType}-contracts.json`;
    // console.log('contractAddressFile: ', contractAddressFile)
    return contractAddressFile;
};

const readFileContent = async function (fileType = "deployed") {
    const contractAddressFile = await getContractAddressFile(fileType);
    const data = fs.readFileSync(contractAddressFile, {flag: "a+"});
    const content = data.toString();
    if (content.length == 0) {
        return "{}";
    }
    return content;
};

const getDeployedContract = async function (contractName) {
    return await getContract("deployed", contractName);
};

const getInitilizedContract = async function (contractName) {
    return await getContract("initialized", contractName);
};

const getUpgradedContract = async function (contractName) {
    return await getContract("upgraded", contractName);
};

const getDeployedContracts = async function () {
    return await getContracts("deployed");
};

async function getContracts(type) {
    const content = await readFileContent(type);
    const contracts = JSON.parse(content);
    return contracts;
}

async function getContract(type, contractName) {
    const contracts = await getContracts(type);
    return contracts[contractName];
}

const updateDeployedContract = async function (contractName, contractAddress) {
    await updateContract("deployed", contractName, contractAddress);
};

const updateInitilizedContract = async function (contractName) {
    await updateContract("initialized", contractName, "Done");
};

const updateUpgradedContract = async function (contractName) {
    await updateContract("upgraded", contractName, "Done");
};

async function updateContract(type, contractName, value) {
    const oldData = await readFileContent(type);
    let contracts = JSON.parse(oldData);
    contracts[contractName] = value;
    const newData = JSON.stringify(contracts);
    const deployedContractsFile = await getContractAddressFile(type);
    fs.writeFileSync(deployedContractsFile, newData);
}

const getSigner = async function (index) {
    const accounts = await hre.ethers.getSigners();
    return accounts[index];
};

const checkReceiptOk = async function (transationPromise) {
    const receipt = await transationPromise.wait();

    if (receipt.status == 0) {
        throw new Error("Receipt Revert!");
    }
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const sendTransaction = async function (
    contractName,
    contractInstance,
    methodName,
    parameters = [],
    logMessage
) {
    // const gasPrice = await hre.ethers.provider.getGasPrice()
    await sleep(5000);
    logMessage = !logMessage ? methodName : logMessage;
    const method = contractInstance[methodName];
    console.log(`${contractName}:${logMessage} Start!`);
    console.log(`paramaters: ${parameters}`);
    await checkReceiptOk(
        await method(...parameters, {
            maxFeePerGas: MAX_FEE_PER_GAS,
            maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
        })
    );
    console.log(`${contractName}:${logMessage} End!`);
};

async function deploy(contractName, keyName, contractParameters, deployer) {
    const deployed = await getDeployedContract(keyName);
    if (deployed) {
        console.log(`${keyName} already deployed: ${deployed}`);
        let Contract = await hre.ethers.getContractFactory(contractName);
        return Contract.attach(deployed);
    }
    let Contract = await hre.ethers.getContractFactory(contractName);
    if (deployer) {
        Contract = Contract.connect(deployer);
    }
    // const gasPrice = await hre.ethers.provider.getGasPrice()
    // const gasPrice = web3.utils.toHex('33000000000')

    let contract;
    if (contractParameters) {
        contract = await Contract.deploy(...contractParameters, {
            maxFeePerGas: MAX_FEE_PER_GAS,
            maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
        });
    } else {
        contract = await Contract.deploy({
            maxFeePerGas: MAX_FEE_PER_GAS,
            maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
        });
    }
    console.log(`${keyName} TransactionHash: ${contract.deployTransaction.hash}`);
    await contract.deployed();
    console.log(`${keyName}: ${contract.address}`);
    await updateDeployedContract(keyName, contract.address);
    console.log(`Deploy ${keyName} Done!`);
    return contract;
}

module.exports = {
    getInitilizedContract,
    updateInitilizedContract,
    getDeployedContract,
    getDeployedContracts,
    updateDeployedContract,
    getUpgradedContract,
    updateUpgradedContract,
    getSigner,
    checkReceiptOk,
    sendTransaction,
    deploy,
};
