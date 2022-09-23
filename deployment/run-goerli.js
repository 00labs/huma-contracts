const {getDeployedContracts, sendTransaction} = require("./utils.js");

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

async function runTSOperation(contract, name, method, parameters, tsContract) {
    const data = contract.interface.encodeFunctionData(method, parameters);
    console.log(`${name}.${method}(${parameters.toString()}) data: ${data}`);
    const operation = genTSOperation(contract.address, 0, data, ethers.constants.HashZero, salt);

    await sendTransaction(`${name}Timelock`, tsContract, "schedule", [
        operation.target,
        operation.value,
        operation.data,
        operation.predecessor,
        operation.salt,
        0,
    ]);

    // const ready = await tsContract.isOperationReady(operation.id);
    // console.log("ready: " + ready);

    await sendTransaction(`${name}Timelock`, tsContract, "execute", [
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

    if (!deployedContracts["ReceivableFactoringPool"]) {
        throw new Error("ReceivableFactoringPool not deployed yet!");
    }

    if (!deployedContracts["HumaConfig"]) {
        throw new Error("HumaConfig not deployed yet!");
    }

    if (!deployedContracts["ReceivableFactoringPoolFeeManager"]) {
        throw new Error("ReceivableFactoringPoolFeeManager not deployed yet!");
    }

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("ReceivableFactoringPool");
    const pool = ReceivableFactoringPool.attach(deployedContracts["ReceivableFactoringPool"]);

    const ReceivableFactoringPoolConfig = await hre.ethers.getContractFactory("ReceivableFactoringPoolConfig");
    const poolConfig = ReceivableFactoringPoolConfig.attach(deployedContracts["ReceivableFactoringPoolConfig"]);

    const owner = await pool.owner();
    console.log("owner: " + owner);

    const res = await pool.getPoolSummary();
    console.log("res: " + res);

    for (let i = 0; i < 10; i++) {
        let v = await hre.ethers.provider.getStorageAt(pool.address, i);
        console.log(`slot${i}: ${v}`);
    }

    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setHumaConfig", [
        deployedContracts["HumaConfig"],
    ]);

    await sendTransaction("ReceivableFactoringPoolConfig", poolConfig, "setFeeManager", [
        deployedContracts["ReceivableFactoringPoolFeeManager"],
    ]);

    // await sendTransaction("ReceivableFactoringPool", pool, "setHumaConfigAndFeeManager", [
    //     deployedContracts["HumaConfig"],
    //     deployedContracts["ReceivableFactoringPoolFeeManager"],
    // ]);

    const HumaConfig = await hre.ethers.getContractFactory("HumaConfig");
    const humaConfig = HumaConfig.attach(deployedContracts["HumaConfig"]);

    const TimelockController = await hre.ethers.getContractFactory("TimelockController");
    const humaConfigTL = TimelockController.attach(deployedContracts["HumaConfigTimelock"]);

    await runTSOperation(
        humaConfig,
        "HumaConfig",
        "setPDSServiceAccount",
        [PDS_SERVICE_ACCOUNT],
        humaConfigTL
    );

    console.log(await humaConfig.pdsServiceAccount());
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
