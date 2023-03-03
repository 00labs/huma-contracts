const {getDeployedContracts, sendTransaction} = require("./utils.js");

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

const MAX_FEE_PER_GAS = 100_000000000;
const MAX_PRIORITY_FEE_PER_GAS = 10_000000000;

let deployer, pds, deployedContracts;

async function testRequire(contractInst, method, parameters, errMsg) {
    console.log(`test require ${errMsg}`);
    let tx;

    try {
        // the error happens during gas estimation, no transaction is sent out.
        tx = await contractInst[method](...parameters);
    } catch (e) {
        // console.log(JSON.stringify(e));
        if (e.reason.includes(errMsg)) {
            console.log(`Find ${errMsg} in e.reason when estimating gas`);
        } else {
            console.log(`Can't find ${errMsg} in e.reason when estimating gas`);
        }
    }

    try {
        // the error happens during calling, no transaction is sent out.
        await contractInst.callStatic[method](...parameters);
    } catch (e) {
        // console.log(e);
        if (e.reason.includes(errMsg)) {
            console.log(`Find ${errMsg} in e.reason when calling`);
        } else {
            console.log(`Can't find ${errMsg} in e.reason when calling`);
        }
    }

    let txHash;
    try {
        // the error happens during sending, a transaction is sent out.
        tx = await contractInst[method](...parameters, {
            gasLimit: 500000,
            maxFeePerGas: MAX_FEE_PER_GAS,
            maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
        });
        txHash = tx.hash;
        await tx.wait();
    } catch (e) {
        // console.log(e);
        if (e.toString().includes(errMsg)) {
            console.log(`Find ${errMsg} when sending`);
        } else {
            console.log(`Can't find ${errMsg} when sending`);
        }
    }

    // get error data by replaying failed transaction on that block
    tx = await hre.ethers.provider.getTransaction(txHash);
    const ntx = {from: tx.from, to: tx.to, data: tx.data};
    const errData = await hre.ethers.provider.call(ntx, tx.blockNumber);
    const errHex = hre.ethers.utils.hexlify(hre.ethers.utils.toUtf8Bytes(errMsg)).substring(2);
    if (errData.toString().includes(errHex)) {
        console.log(`Get ${errMsg} by replaying tx: ${txHash} on block: ${tx.blockNumber}`);
    } else {
        console.log(`Can't get ${errMsg} by replaying tx: ${txHash} on block: ${tx.blockNumber}`);
    }
    console.log("");
}

async function testError(contractInst, method, parameters, errFunc) {
    console.log(`test Error ${errFunc}`);
    let tx;

    const errFuncId = hre.ethers.utils
        .keccak256(hre.ethers.utils.toUtf8Bytes(errFunc))
        .substring(0, 10);
    console.log(`${errFunc} selectId is ${errFuncId}`);

    try {
        // the error happens during gas estimation, no transaction is sent out.
        tx = await contractInst[method](...parameters);
    } catch (e) {
        // console.log(JSON.stringify(e));
        if (e.error.data === errFuncId) {
            console.log(`Find ${errFuncId} in e.error.data when estimating gas`);
        } else {
            console.log(`Can't find ${errFuncId} in e.error.data when estimating gas`);
        }
    }

    try {
        // the error happens during calling, no transaction is sent out.
        await contractInst.callStatic[method](...parameters);
    } catch (e) {
        // console.log(e);
        if (e.data === errFuncId) {
            console.log(`Find ${errFuncId} in e.data when calling`);
        } else {
            console.log(`Can't find ${errFuncId} in e.data when calling`);
        }
    }

    let txHash;
    try {
        // the error happens during sending, a transaction is sent out.
        tx = await contractInst[method](...parameters, {
            gasLimit: 500000,
            maxFeePerGas: MAX_FEE_PER_GAS,
            maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
        });
        txHash = tx.hash;
        // console.log(tx);
        await tx.wait();
    } catch (e) {
        // console.log(e);
        if (e.toString().includes(errFuncId)) {
            console.log(`Find ${errFuncId} when sending`);
        } else {
            console.log(`Can't find ${errFuncId} when sending`);
        }
    }

    // get error data by replaying failed transaction on that block
    tx = await hre.ethers.provider.getTransaction(txHash);
    const ntx = {from: tx.from, to: tx.to, data: tx.data};
    const errData = await hre.ethers.provider.call(ntx, tx.blockNumber);
    if (errData === errFuncId) {
        console.log(`Get ${errFuncId} by replaying tx: ${txHash} on block: ${tx.blockNumber}`);
    } else {
        console.log(
            `Can't get ${errFuncId} by replaying tx: ${txHash} on block: ${tx.blockNumber}`
        );
    }
    console.log("");
}

async function verifyOnchainError(txHash, errFunc) {
    const errFuncId = hre.ethers.utils
        .keccak256(hre.ethers.utils.toUtf8Bytes(errFunc))
        .substring(0, 10);
    console.log(`${errFunc} selectId is ${errFuncId}`);
    const tx = await hre.ethers.provider.getTransaction(txHash);
    const ntx = {from: tx.from, to: tx.to, data: tx.data};
    const errData = await hre.ethers.provider.call(ntx, tx.blockNumber);
    if (errData === errFuncId) {
        console.log(`Get ${errFuncId} by replaying tx: ${txHash} on block: ${tx.blockNumber}`);
    } else {
        console.log(
            `Can't get ${errFuncId} by replaying tx: ${txHash} on block: ${tx.blockNumber}`
        );
    }
    console.log("");
}

async function test() {
    const ReceivableFactoringPoolConfig = await hre.ethers.getContractFactory("BasePoolConfig");
    const poolConfig = ReceivableFactoringPoolConfig.attach(
        deployedContracts["ReceivableFactoringPoolConfig"]
    );

    const accounts = await hre.ethers.getSigners();
    const poolConfigPDS = await poolConfig.connect(pds);

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("ReceivableFactoringPool");
    const pool = ReceivableFactoringPool.attach(deployedContracts["ReceivableFactoringPool"]);

    // 1. revert Errors.zeroAmountProvided() in external function
    await testError(poolConfig, "setMaxCreditLine", [0], "zeroAmountProvided()");

    // 2. revert Errors.permissionDeniedNotAdmin() in internal function
    await testError(poolConfigPDS, "setMaxCreditLine", [0], "permissionDeniedNotAdmin()");

    // 3. require "Ownable: new owner is the zero address" in external function
    await testRequire(
        poolConfig,
        "transferOwnership",
        [ZERO_ADDR],
        "Ownable: new owner is the zero address"
    );

    // 4. require "zeroAmountProvided()" in internal function
    await testRequire(pool, "makePayment", [ZERO_ADDR, 0], "zeroAmountProvided()");

    await verifyOnchainError(
        "0x6daee41086d0793fb8010527266a1e2ac27f7ffd48a8122fb11bf9e60f5d3144",
        "insufficientReceivableAmount()"
    );
}

async function main() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    deployer = await accounts[0];
    console.log("deployer address: " + deployer.address);
    pds = await accounts[5];
    console.log("pds address: " + pds.address);

    deployedContracts = await getDeployedContracts();

    await test();
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
