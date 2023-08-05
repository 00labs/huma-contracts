const execSync = require('child_process').execSync;
const {
    getDeployedContracts,
    getVerifiedContract,
    updateVerifiedContract,
} = require("../utils.js");

const fs = require("fs");

const VERIFY_ARGS_PATH = "./deployment/mumbai/verify_args/"

const HUMA_OWNER_EOA='0x7E13931931d59f2199fE0b499534412FCD28b7Ed';
const POOL_OWNER_EOA='0xD252073bF424bb13B474004bf9F52195d54aEDb6';
const PROXY_EOA = '0x8fDd4aB7832Fa9B3AC9104b7Afa16a0661705b36';

let deployedContracts, proxyOwner, network, deployer;

const getArgsFile = async function (contractName) {
    const argsFile = `${VERIFY_ARGS_PATH}${contractName}.js`;
    return argsFile;
}

const writeVerifyArgs = async function (contractName, args) {
    const argsFile =  await getArgsFile(contractName);
    let data = `module.exports = [
        ${args.toString()},
        ];`
    // console.log(data)
    await fs.mkdir(`${VERIFY_ARGS_PATH}`, { recursive: true }, (err) => {
        if (err) throw err;
    });
    fs.writeFileSync(argsFile, data, {flag: "w"});
    return argsFile;
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function etherscanVerify(contractName, contractAddress, argsFile, logMessage) {
    await sleep(5000);
    logMessage = !logMessage ? contractAddress : logMessage;
    console.log(`Verifying ${contractName}:${logMessage}`)

    const command = !argsFile ? `yarn hardhat verify '${contractAddress}' --network ${network}` : `yarn hardhat verify ${contractAddress} --constructor-args ${argsFile} --network ${network}`
    let result;
    try {
        const verifyResult = execSync(command)
        // console.log(verifyResult);
        result = 'successful';
    }
    catch (error) {
        if (!error.toString().toLowerCase().includes("already verified" )) {
            throw error;
        }
        else {
            result = 'already verified';
        }
    };
    console.log(`Verifying ${contractName}:${logMessage} ended!`);
    return result;
}

async function verifyContract(contractKey, args) {
    const verified = await getVerifiedContract(contractKey);
    if (verified) {
        console.log(`${contractKey} is already verified!`);
        return 'already verified';
    }

    if (!deployedContracts[contractKey]) {
        throw new Error(`${contractKey} not deployed yet!`);
    }
    let result;
    if (args) {
        const argsFile = await writeVerifyArgs(contractKey, args);
        result = await etherscanVerify(contractKey, deployedContracts[contractKey], argsFile);
    }
    else {
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
    // proxyOwner = await accounts[1];
    // console.log("proxyOwner address: " + proxyOwner.address);

    // const verifyUsdc = await verifyContract('USDC');
    // console.log(`Verify USDC result: ${verifyUsdc}`);

    const verifyEANFT = await verifyContract('EANFT');
    console.log(`Verify EANFT result: ${verifyEANFT}`);

    // const verifyRNNFT = await verifyContract('RNNFT', [
    //     `'${deployedContracts['USDC']}'`
    // ]);
    // console.log(`Verify RNNFT result: ${verifyRNNFT}`);

    const verifyHumaConfig = await verifyContract('HumaConfig');
    console.log(`Verify HumaConfig result: ${verifyHumaConfig}`);

    const verifyHumaConfigTL = await verifyContract('HumaConfigTimelock',
        [
            0,
            `['${HUMA_OWNER_EOA}']`,
            `['${deployer.address}']`,
        ]);
    console.log(`Verify HumaConfigTimelock result: ${verifyHumaConfigTL}`);

    // const verifyHumaProxyAdminTL = await verifyContract('HumaProxyAdminTimelock',
    //     [
    //         0,
    //         `['${HUMA_OWNER_EOA}']`,
    //         `['${deployer.address}']`,
    //     ]);
    // console.log(`Verify HumaConfigTimelock result: ${verifyHumaConfigTL}`);

    const verifyRWRImpl = await verifyContract('RWReceivableImpl');
    console.log(`Verify RWRImpl result: ${verifyRWRImpl}`);

    const verifyRWR = await verifyContract('RWReceivable',
        [
            `'${deployedContracts['RWReceivableImpl']}'`,
            `'${deployedContracts['HumaConfigTimelock']}'`,
            '[]'
        ]);
    console.log(`Verify RWR result: ${verifyRWR}`);


    const verifyBaseCreditPoolTL = await verifyContract('BSOSPoolTimelock',
        [
            0,
            `['${POOL_OWNER_EOA}']`,
            `['${deployer.address}']`,
        ]);
    console.log(`Verify BSOSPoolTimelock result: ${verifyBaseCreditPoolTL}`);

    const verifyBaseCreditPoolProxyAdminTL = await verifyContract('BSOSPoolProxyAdminTimelock',
        [
            0,
            `['${POOL_OWNER_EOA}']`,
            `['${deployer.address}']`,
        ]);
    console.log(`Verify BSOSPoolProxyAdminTimelock result: ${verifyBaseCreditPoolProxyAdminTL}`);

    const verifyFeeManager = await verifyContract('BSOSPoolFeeManager');
    console.log(`Verify FeeManager result: ${verifyFeeManager}`);

    const verifyHDTImpl = await verifyContract('HDTImpl');
    console.log(`Verify HDTImpl result: ${verifyHDTImpl}`);

    const verifyHDT = await verifyContract('BSOSHDT',
        [
            `'${deployedContracts['ArfNewHDTImpl']}'`,
            `'${PROXY_EOA}'`,
            '[]'
        ]);
    console.log(`Verify HDT result: ${verifyHDT}`);

    const verifyPoolConfig = await verifyContract('BSOSPoolConfig');
    console.log(`Verify poolConfig result: ${verifyPoolConfig}`);

    const verifyPoolImpl = await verifyContract('BaseCreditPoolImpl');
    console.log(`Verify PoolImpl result: ${verifyPoolImpl}`);

    const verifyPool = await verifyContract('BSOSPool',
        [
            `'${deployedContracts['BaseCreditPoolImpl']}'`,
            `'${PROXY_EOA}'`,
            '[]',
        ]);
    console.log(`Verify Pool result: ${verifyPool}`);
}

verifyContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

// Reason: Already Verified