const {getDeployedContracts} = require("../utils.js");

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const salt = ethers.utils.formatBytes32String("salt");

let deployer, deployedContracts;


async function adjustFees() {
    if (!deployedContracts["BaseCreditPoolFeeManager"]) {
        throw new Error("BaseCreditPoolFeeManager not deployed yet!");
    }

    
    const FeeManager = await hre.ethers.getContractFactory(
        "BaseFeeManager"
    );
    const feeManager = FeeManager.attach(
        deployedContracts["BaseCreditPoolFeeManager"]
    );

    await feeManager.setFees(20_000_000, 20_000_000, 
        20_000_000, 20_000_000, 20_000_000);
    
}

async function main() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    deployer = await accounts[0];
    console.log("deployer address: " + deployer.address);

    deployedContracts = await getDeployedContracts();

    await adjustFees();
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
