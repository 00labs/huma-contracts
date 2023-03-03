const {getDeployedContracts, sendTransaction} = require("./utils.js");

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const salt = ethers.utils.formatBytes32String("salt");
const PDS_SERVICE_ACCOUNT = "0x6d748Fd98464EC03b7202C0A3fE9a28ADD0a1e70";

let deployer, proxyOwner, deployedContracts;

function genTSOperation(target, value, data, predecessor, salt) {
    const id = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
            ["address", "uint256", "bytes", "uint256", "bytes32"],
            [target, value, data, predecessor, salt]
        )
    );
    return {id, target, value, data, predecessor, salt};
}

async function runTLOperation(contract, name, method, parameters, tlContract) {
    const data = contract.interface.encodeFunctionData(method, parameters);
    console.log(`${name}.${method}(${parameters.toString()}) data: ${data}`);
    const operation = genTSOperation(contract.address, 0, data, ethers.constants.HashZero, salt);

    await sendTransaction(`${name}Timelock`, tlContract, "schedule", [
        operation.target,
        operation.value,
        operation.data,
        operation.predecessor,
        operation.salt,
        0,
    ]);

    // const ready = await tsContract.isOperationReady(operation.id);
    // console.log("ready: " + ready);

    await sendTransaction(`${name}Timelock`, tlContract, "execute", [
        operation.target,
        operation.value,
        operation.data,
        operation.predecessor,
        operation.salt,
    ]);
}

async function execute() {
    if (!deployedContracts["ReceivableFactoringPoolConfig"]) {
        throw new Error("ReceivableFactoringPoolConfig not deployed yet!");
    }

    if (!deployedContracts["BaseCreditPoolConfig"]) {
        throw new Error("ReceivableFactoringPoolConfig not deployed yet!");
    }

    if (!deployedContracts["ReceivableFactoringPool"]) {
        throw new Error("ReceivableFactoringPool not deployed yet!");
    }

    if (!deployedContracts["BaseCreditPool"]) {
        throw new Error("BaseCreditPool not deployed yet!");
    }

    // if (!deployedContracts["HumaConfig"]) {
    //     throw new Error("HumaConfig not deployed yet!");
    // }

    if (!deployedContracts["BaseCreditPoolFeeManager"]) {
        throw new Error("BaseCreditPoolFeeManager not deployed yet!");
    }

    if (!deployedContracts["ReceivableFactoringPoolFeeManager"]) {
        throw new Error("ReceivableFactoringPoolFeeManager not deployed yet!");
    }

    // const BaseCreditPoolFeeManager = await hre.ethers.getContractFactory("BaseFeeManager");
    // const baseCreditPoolFeeManager = BaseCreditPoolFeeManager.attach(
    //     deployedContracts["BaseCreditPoolFeeManager"]
    // );
    // await sendTransaction(
    //     "BaseCreditPoolFeeManager",
    //     baseCreditPoolFeeManager,
    //     "setFees",
    //     [10_000_000, 0, 20_000_000, 0, 5_000_000]
    // );

    // const ReceivableFactoringPoolFeeManager = await hre.ethers.getContractFactory(
    //     "BaseFeeManager"
    // );
    // const receivableFactoringPoolFeeManager = ReceivableFactoringPoolFeeManager.attach(
    //     deployedContracts["ReceivableFactoringPoolFeeManager"]
    // );
    // await sendTransaction(
    //     "BaseCreditPoolFeeManager",
    //     receivableFactoringPoolFeeManager,
    //     "setFees",
    //     [0, 1000, 0, 1000, 0]
    // );

    // const owner = await poolConfig.owner();
    // console.log("owner: " + owner);
    //
    // const res = await poolConfig.getPoolSummary();
    // console.log("res: " + res);

    // for (let i = 0; i < 1; i++) {
    //     let v = await hre.ethers.provider.getStorageAt(pool.address, i);
    //     console.log(`slot${i}: ${v}`);
    // }

    // console.log("pool status: " + (await pool.isPoolOn()));

    // console.log(
    //     "receivableOwnershipMapping: " + (await pool.receivableOwnershipMapping(ZERO_BYTES32))
    // );

    // await sendTransaction("ReceivableFactoringPool", pool, "updateCoreData", []);

    // await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setHumaConfig", [
    //     deployedContracts["HumaConfig"],
    // ]);
    //

    // const ReceivableFactoringPoolConfig = await hre.ethers.getContractFactory("BasePoolConfig");
    // const receivableFactoringPoolConfig = ReceivableFactoringPoolConfig.attach(
    //     deployedContracts["ReceivableFactoringPoolConfig"]
    // );

    // await sendTransaction(
    //     "ReceivableFactoringPoolConfig",
    //     receivableFactoringPoolConfig,
    //     "setFeeManager",
    //     [deployedContracts["ReceivableFactoringPoolFeeManager"]]
    // );

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("ReceivableFactoringPool");
    const receivableFactoringPool = ReceivableFactoringPool.attach(
        deployedContracts["ReceivableFactoringPool"]
    );

    await sendTransaction(
        "ReceivableFactoringPool",
        receivableFactoringPool,
        "updateCoreData",
        []
    );

    // const BaseCreditPoolConfig = await hre.ethers.getContractFactory("BasePoolConfig");
    // const baseCreditPoolConfig = BaseCreditPoolConfig.attach(
    //     deployedContracts["BaseCreditPoolConfig"]
    // );

    // await sendTransaction("BaseCreditPoolConfig", baseCreditPoolConfig, "setFeeManager", [
    //     deployedContracts["BaseCreditPoolFeeManager"],
    // ]);

    const BaseCreditPool = await hre.ethers.getContractFactory("BaseCreditPool");
    const baseCreditPool = BaseCreditPool.attach(deployedContracts["BaseCreditPool"]);

    await sendTransaction("BaseCreditPool", baseCreditPool, "updateCoreData", []);

    // await sendTransaction("ReceivableFactoringpoolConfig", poolConfig, "setAPR", [0]);
    // const HumaConfig = await hre.ethers.getContractFactory("HumaConfig");
    // const humaConfig = HumaConfig.attach(deployedContracts["HumaConfig"]);
    //
    // const TimelockController = await hre.ethers.getContractFactory("TimelockController");
    // const humaConfigTL = TimelockController.attach(deployedContracts["HumaConfigTimelock"]);
    //
    // await runTLOperation(
    //     humaConfig,
    //     "HumaConfig",
    //     "setEANFTContractAddress",
    //     [deployedContracts["EANFT"]],
    //     humaConfigTL
    // );

    // console.log(await humaConfig.pdsServiceAccount());
}

async function main() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    deployer = await accounts[0];
    console.log("deployer address: " + deployer.address);

    deployedContracts = await getDeployedContracts();

    await execute();
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
