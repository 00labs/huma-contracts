const {deploy} = require("./utils.js");

const PROXY_OWNER_ADDRESS = "0x60891b087E81Ee2a61B7606f68019ec112c539B9";

async function deployContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    if (accounts.length == 0) {
        throw new Error("Accounts not set!");
    }
    const deployer = await accounts[0];
    console.log("deployer address: " + deployer.address);

    const usdc = await deploy("TestToken", "USDC");

    const humaConfig = await deploy("HumaConfig", "HumaConfig", [deployer.address]);
    const feeManager = await deploy("BaseFeeManager", "FeeManager");
    const hdtImpl = await deploy("HDT", "HDTImpl");
    const hdt = await deploy("TransparentUpgradeableProxy", "HDT", [
        hdtImpl.address,
        PROXY_OWNER_ADDRESS,
        [],
    ]);
    const poolImpl = await deploy("BaseCreditPool", "PoolImpl");
    const pool = await deploy("TransparentUpgradeableProxy", "Pool", [
        poolImpl.address,
        PROXY_OWNER_ADDRESS,
        [],
    ]);
}

deployContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
