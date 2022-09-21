const {deploy} = require("./utils.js");

const PROXY_OWNER_ADDRESS = "0x5Baca8ED2dC6f4410755F619B3A4DFB3eA4cA9F0";

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
    const humaConfigTL = await deploy("TimelockController", "HumaConfigTimelock", [
        0,
        [deployer.address],
        [deployer.address],
    ]);

    const feeManager = await deploy("BaseFeeManager", "ReceivableFactoringPoolFeeManager");
    const hdtImpl = await deploy("HDT", "HDTImpl");
    const hdt = await deploy("TransparentUpgradeableProxy", "HDT", [
        hdtImpl.address,
        PROXY_OWNER_ADDRESS,
        [],
    ]);
    const poolImpl = await deploy("ReceivableFactoringPool", "ReceivableFactoringPoolImpl");
    const pool = await deploy("TransparentUpgradeableProxy", "ReceivableFactoringPool", [
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
