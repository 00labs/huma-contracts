const execSync = require("child_process").execSync;
const {getDeployedContracts, getVerifiedContract, updateVerifiedContract} = require("../utils.js");

const fs = require("fs");

const VERIFY_ARGS_PATH = "./deployment/goerli/verify_args/";

const HUMA_OWNER_MULTI_SIG = "0x1931bD73055335Ba06efB22DB96169dbD4C5B4DB";
const POOL_OWNER_MULTI_SIG = "0xB69cD2CC66583a4f46c1a8C977D5A8Bf9ecc81cA";

const SF_USDC_ADDRESS = "0xc94dd466416A7dFE166aB2cF916D3875C049EBB7";
const SF_HOST_ADDRESS = "0x22ff293e14F1EC3A09B137e9e06084AFd63adDF9";

let deployedContracts, proxyOwner, network, deployer;

const getArgsFile = async function (contractName) {
    const argsFile = `${VERIFY_ARGS_PATH}${contractName}.js`;
    return argsFile;
};

const writeVerifyArgs = async function (contractName, args) {
    const argsFile = await getArgsFile(contractName);
    let data = `module.exports = [
        ${args.toString()},
        ];`;
    // console.log(data)
    await fs.mkdir(`${VERIFY_ARGS_PATH}`, {recursive: true}, (err) => {
        if (err) throw err;
    });
    fs.writeFileSync(argsFile, data, {flag: "w"});
    return argsFile;
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function etherscanVerify(contractName, contractAddress, argsFile, logMessage) {
    await sleep(5000);
    logMessage = !logMessage ? contractAddress : logMessage;
    console.log(`Verifying ${contractName}:${logMessage}`);

    const command = !argsFile
        ? `yarn hardhat verify '${contractAddress}' --network ${network}`
        : `yarn hardhat verify ${contractAddress} --constructor-args ${argsFile} --network ${network}`;
    let result;
    try {
        const verifyResult = execSync(command);
        // console.log(verifyResult);
        result = "successful";
    } catch (error) {
        if (!error.toString().toLowerCase().includes("already verified")) {
            throw error;
        } else {
            result = "already verified";
        }
    }
    console.log(`Verifying ${contractName}:${logMessage} ended!`);
    return result;
}

async function verifyContract(contractKey, args) {
    const verified = await getVerifiedContract(contractKey);
    if (verified) {
        console.log(`${contractKey} is already verified!`);
        return "already verified";
    }

    if (!deployedContracts[contractKey]) {
        throw new Error(`${contractKey} not deployed yet!`);
    }
    let result;
    if (args) {
        const argsFile = await writeVerifyArgs(contractKey, args);
        result = await etherscanVerify(contractKey, deployedContracts[contractKey], argsFile);
    } else {
        result = await etherscanVerify(contractKey, deployedContracts[contractKey]);
    }
    await updateVerifiedContract(contractKey);
    return result;
}

async function verifyContracts() {
    network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    deployedContracts = await getDeployedContracts();
    const accounts = await hre.ethers.getSigners();
    if (accounts.length == 0) {
        throw new Error("Accounts not set!");
    }
    deployer = await accounts[0];
    proxyOwner = await accounts[1];
    console.log("proxyOwner address: " + proxyOwner.address);

    // const verifyUsdc = await verifyContract('USDC');
    // console.log(`Verify USDC result: ${verifyUsdc}`);

    // const verifyEANFT = await verifyContract('EANFT');
    // console.log(`Verify EANFT result: ${verifyEANFT}`);

    const verifyTradableStream = await verifyContract("SuperfluidTradableStream", [
        `'${SF_HOST_ADDRESS}'`,
    ]);
    console.log(`Verify SuperfluidTradableStream result: ${verifyTradableStream}`);

    // const verifyHumaConfig = await verifyContract("HumaConfig");
    // console.log(`Verify HumaConfig result: ${verifyHumaConfig}`);

    // const verifyHumaConfigTL = await verifyContract("HumaConfigTimelock", [
    //     0,
    //     `['${HUMA_OWNER_MULTI_SIG}']`,
    //     `['${deployer.address}']`,
    // ]);
    // console.log(`Verify HumaConfigTimelock result: ${verifyHumaConfigTL}`);

    const verifySuperfluidFactoringPoolTL = await verifyContract(
        "SuperfluidFactoringPoolTimelock",
        [0, `['${POOL_OWNER_MULTI_SIG}']`, `['${deployer.address}']`]
    );
    console.log(
        `Verify SuperfluidFactoringPoolTimelock result: ${verifySuperfluidFactoringPoolTL}`
    );

    const verifyrSuperfluidFactoringPoolProxyAdminTL = await verifyContract(
        "SuperfluidFactoringPoolProxyAdminTimelock",
        [0, `['${POOL_OWNER_MULTI_SIG}']`, `['${deployer.address}']`]
    );
    console.log(
        `Verify SuperfluidFactoringPoolProxyAdminTimelock result: ${verifyrSuperfluidFactoringPoolProxyAdminTL}`
    );

    const verifyFeeManager = await verifyContract("SuperfluidFactoringPoolFeeManager");
    console.log(`Verify FeeManager result: ${verifyFeeManager}`);

    const verifyHDTImpl = await verifyContract("SuperfluidPoolHDTImpl");
    console.log(`Verify SuperfluidPoolHDTImpl result: ${verifyHDTImpl}`);

    const verifyHDT = await verifyContract("SuperfluidPoolHDT", [
        `'${deployedContracts["SuperfluidPoolHDTImpl"]}'`,
        `'${deployedContracts["SuperfluidFactoringPoolProxyAdminTimelock"]}'`,
        "[]",
    ]);
    console.log(`Verify SuperfluidPoolHDT result: ${verifyHDT}`);

    const verifyPoolConfig = await verifyContract("SuperfluidFactoringPoolConfig");
    console.log(`Verify SuperfluidFactoringPoolConfig result: ${verifyPoolConfig}`);

    const verifyPoolImpl = await verifyContract("SuperfluidFactoringPoolImpl");
    console.log(`Verify SuperfluidFactoringPoolImpl result: ${verifyPoolImpl}`);

    const verifyPool = await verifyContract("SuperfluidFactoringPool", [
        `'${deployedContracts["SuperfluidFactoringPoolImpl"]}'`,
        `'${deployedContracts["SuperfluidFactoringPoolProxyAdminTimelock"]}'`,
        "[]",
    ]);
    console.log(`Verify SuperfluidFactoringPool result: ${verifyPool}`);
}

verifyContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

// Reason: Already Verified
