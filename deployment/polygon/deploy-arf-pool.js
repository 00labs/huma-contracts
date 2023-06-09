const {deploy} = require("../utils.js");

const HUMA_OWNER_SAFE='0x7E13931931d59f2199fE0b499534412FCD28b7Ed';
const POOL_OWNER_SAFE='0xD252073bF424bb13B474004bf9F52195d54aEDb6';

async function deployContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    if (accounts.length == 0) {
        throw new Error("Accounts not set!");
    }
    const [deployer, eaService] = await accounts;
    console.log("deployer address: " + deployer.address);
    console.log("ea service address: " + eaService.address);

    // const usdc = await deploy("TestToken", "USDC");
    const evaluationAgentNFT = await deploy("EvaluationAgentNFT", "EANFT", [], eaService);

    const humaConfig = await deploy("HumaConfig", "HumaConfig");
    const humaConfigTL = await deploy("TimelockController", "HumaConfigTimelock", [
        0,
        [HUMA_OWNER_SAFE],
        [deployer.address],
    ]);

    // const HumaProxyAdminTL = await deploy("TimelockController", "HumaProxyAdminTimelock", [
    //     0,
    //     [HUMA_OWNER_SAFE],
    //     [deployer.address],
    // ]);


    // const rwrImpl = await deploy("RealWorldReceivable", "RWReceivableImpl");
    // const rwr = await deploy("TransparentUpgradeableProxy", "RWReceivable", [
    //     rwrImpl.address,
    //     HumaProxyAdminTL.address,
    //     [],
    // ]);

    const baseCreditPoolTL = await deploy("TimelockController", "ArfPoolTimelock", [
        0,
        [POOL_OWNER_SAFE],
        [deployer.address],
    ]);

    const baseCreditPoolProxyAdminTL = await deploy("TimelockController", "ArfPoolProxyAdminTimelock", [
        0,
        [POOL_OWNER_SAFE],
        [deployer.address],
    ]);

    const bc_feeManager = await deploy("BaseFeeManager", "ArfPoolFeeManager");
    const bc_hdtImpl = await deploy("HDT", "ArfHDTImpl");
    const bc_hdt = await deploy("TransparentUpgradeableProxy", "ArfHDT", [
        bc_hdtImpl.address,
        baseCreditPoolProxyAdminTL.address,
        [],
    ]);
    const bc_poolConfig = await deploy("BasePoolConfig", "ArfPoolConfig");

    const bc_poolImpl = await deploy("BaseCreditPool", "ArfPoolImpl");
    const bc_pool = await deploy("TransparentUpgradeableProxy", "ArfPool", [
        bc_poolImpl.address,
        baseCreditPoolProxyAdminTL.address,
        [],
    ]);
    // End of deploying base credit pool

}

deployContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
