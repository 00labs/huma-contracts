const {deploy} = require("../utils.js");

const HUMA_OWNER_EOA='0x18A00C3cdb71491eF7c3b890f9df37CB5Ec11D2A';
const POOL_OWNER_EOA='0xf9f1f8b93Be684847D8DaF82b1643b2D5BB4419a';

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

    const usdc = await deploy("TestToken", "USDC");
    const evaluationAgentNFT = await deploy("EvaluationAgentNFT", "EANFT", [], eaService);

    const humaConfig = await deploy("HumaConfig", "HumaConfig");
    const humaConfigTL = await deploy("TimelockController", "HumaConfigTimelock", [
        0,
        [HUMA_OWNER_EOA],
        [deployer.address],
    ]);

    const HumaProxyAdminTL = await deploy("TimelockController", "HumaProxyAdminTimelock", [
        0,
        [HUMA_OWNER_EOA],
        [deployer.address],
    ]);

    const rwrImpl = await deploy("RealWorldReceivable", "RWReceivableImpl");
    const rwr = await deploy("TransparentUpgradeableProxy", "RWReceivable", [
        rwrImpl.address,
        HumaProxyAdminTL.address,
        [],
    ]);

    const baseCreditPoolTL = await deploy("TimelockController", "ArfNewPoolTimelock", [
        0,
        [POOL_OWNER_EOA],
        [deployer.address],
    ]);

    const baseCreditPoolProxyAdminTL = await deploy("TimelockController", "ArfNewPoolProxyAdminTimelock", [
        0,
        [POOL_OWNER_EOA],
        [deployer.address],
    ]);

    const bc_feeManager = await deploy("BaseFeeManager", "ArfNewPoolFeeManager");
    const bc_hdtImpl = await deploy("HDT", "ArfNewHDTImpl");
    const bc_hdt = await deploy("TransparentUpgradeableProxy", "ArfNewHDT", [
        bc_hdtImpl.address,
        baseCreditPoolProxyAdminTL.address,
        [],
    ]);
    const bc_poolConfig = await deploy("BasePoolConfig", "ArfNewPoolConfig");

    const bc_poolImpl = await deploy("BaseCreditPool", "ArfNewPoolImpl");
    const bc_pool = await deploy("TransparentUpgradeableProxy", "ArfNewPool", [
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
