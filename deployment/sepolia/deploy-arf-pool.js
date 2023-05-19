const {deploy} = require("../utils.js");

const HUMA_OWNER_EOA='0x1e7A60fdc43E70d67A3C81AFAE1e95efC48b681b';
const POOL_OWNER_EOA='0x242c334d3bd2882515547fFCF2733F3BB3701ACA';

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

    const rwrImpl = await deploy("RealWorldReceivable", "RWReceivableImpl");
    const rwr = await deploy("TransparentUpgradeableProxy", "RWReceivable", [
        rwrImpl.address,
        humaConfigTL.address,
        [],
    ]);

    const baseCreditPoolTL = await deploy("TimelockController", "ArfPoolTimelock", [
        0,
        [POOL_OWNER_EOA],
        [deployer.address],
    ]);

    const baseCreditPoolProxyAdminTL = await deploy("TimelockController", "ArfPoolProxyAdminTimelock", [
        0,
        [POOL_OWNER_EOA],
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
