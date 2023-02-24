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

    await feeManager.setFees(
        10_000_000,  // flat originatetion fee to be 10 usdc
        0,  // proportional originatetion fee to be 0%
        10_000_000,  // flat late fee to be 10 usdc
        0,  // proportional late fee to be 0%
        0   // membership fee to be 0 usdc/month
        );

    if (!deployedContracts["BaseCreditPoolConfig"]) {
        throw new Error("BaseCreditPoolConfig not deployed yet!");
    }

    
    const PoolConfig = await hre.ethers.getContractFactory(
        "BasePoolConfig"
    );
    const poolConfig = PoolConfig.attach(
        deployedContracts["BaseCreditPoolConfig"]
    );

    await poolConfig.setAPR(1000); // setting apr to be 10%
    await poolConfig.setWithdrawalLockoutPeriod(0);
    
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
