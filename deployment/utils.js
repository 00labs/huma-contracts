const {BigNumber: BN, ethers} = require("ethers");
const fs = require("fs");
const DEPLOYED_PATH = "./deployment/";

const MAX_FEE_PER_GAS = 30_000_000_000;
const MAX_PRIORITY_FEE_PER_GAS = 2_000_000_000;

const getContractAddressFile = async function (fileType = "deployed", network) {
    if (!network) {
        network = (await hre.ethers.provider.getNetwork()).name;
        // console.log('network : ', network)
        network = network == "unknown" ? "localhost" : network;
    }
    const contractAddressFile = `${DEPLOYED_PATH}${network}-${fileType}-contracts.json`;
    // console.log("contractAddressFile: ", contractAddressFile);
    return contractAddressFile;
};

const readFileContent = async function (fileType = "deployed", network) {
    const contractAddressFile = await getContractAddressFile(fileType, network);
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

const getVerifiedContract = async function (contractName) {
    return await getContract("verified", contractName);
};

const getDeployedContracts = async function (network) {
    return await getContracts("deployed", network);
};

async function getContracts(type, network) {
    const content = await readFileContent(type, network);
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

const updateVerifiedContract = async function (contractName) {
    await updateContract("verified", contractName, "Done");
};

async function updateContract(type, contractName, value) {
    const oldData = await readFileContent(type);
    let contracts = JSON.parse(oldData);
    contracts[contractName] = value;
    const newData = JSON.stringify(contracts).replace(/\,/g, ",\n");
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

const toFixedDecimal = function (number, decimals) {
    return BN.from(number).mul(BN.from(10).pow(BN.from(decimals)));
};

const impersonate = async function (account) {
    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [account],
    });
    const amount = BN.from(10).mul(ethers.constants.WeiPerEther);
    await network.provider.send("hardhat_setBalance", [account, amount.toHexString()]);
    return await hre.ethers.provider.getSigner(account);
};

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
    toFixedDecimal,
    getVerifiedContract,
    updateVerifiedContract,
    impersonate,
};
