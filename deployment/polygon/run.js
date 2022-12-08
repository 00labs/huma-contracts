const {getDeployedContracts, sendTransaction} = require("../utils.js");

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const salt = ethers.utils.formatBytes32String("salt");

let deployer, deployedContracts;


async function execute() {
    if (!deployedContracts["ReceivableFactoringPoolConfig"]) {
        throw new Error("ReceivableFactoringPoolConfig not deployed yet!");
    }

    
    const ReceivableFactoringPoolConfig = await hre.ethers.getContractFactory(
        "BasePoolConfig"
    );
    const receivableFactoringPoolConfig = ReceivableFactoringPoolConfig.attach(
        deployedContracts["ReceivableFactoringPoolConfig"]
    );

    await receivableFactoringPoolConfig.checkLiquidityRequirement();
    
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
