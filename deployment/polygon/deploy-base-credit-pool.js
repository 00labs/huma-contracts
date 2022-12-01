const {deploy} = require("../utils.js");

const HUMA_OWNER_MULTI_SIG = "0x7E13931931d59f2199fE0b499534412FCD28b7Ed";
const POOL_OWNER_MULTI_SIG = "0xD252073bF424bb13B474004bf9F52195d54aEDb6";

async function deployContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    if (accounts.length == 0) {
        throw new Error("Accounts not set!");
    }
    const deployer = await accounts[0];
    console.log("deployer address: " + deployer.address);

    const eaService = await accounts[1];
    console.log("ea service address: " + eaService.address);

    // const usdc = await deploy("TestToken", "USDC");
    const evaluationAgentNFT = await deploy("EvaluationAgentNFT", "EANFT", [], eaService);
    // const invoiceNFT = await deploy("InvoiceNFT", "RNNFT", [usdc.address]);

    const humaConfig = await deploy("HumaConfig", "HumaConfig");
    const humaConfigTL = await deploy("TimelockController", "HumaConfigTimelock", [
        0,
        [HUMA_OWNER_MULTI_SIG],
        [deployer.address],
    ]);

    const baseCreditPoolTL = await deploy("TimelockController", "BaseCreditPoolTimelock", [
        0,
        [POOL_OWNER_MULTI_SIG],
        [deployer.address],
    ]);

    const baseCreditPoolProxyAdminTL = await deploy("TimelockController", "BaseCreditPoolProxyAdminTimelock", [
        0,
        [POOL_OWNER_MULTI_SIG],
        [deployer.address],
    ]);

    const bc_feeManager = await deploy("BaseFeeManager", "BaseCreditPoolFeeManager");
    const bc_hdtImpl = await deploy("HDT", "BaseCreditHDTImpl");
    const bc_hdt = await deploy("TransparentUpgradeableProxy", "BaseCreditHDT", [
        bc_hdtImpl.address,
        baseCreditPoolProxyAdminTL.address,
        [],
    ]);
    const bc_poolConfig = await deploy("BasePoolConfig", "BaseCreditPoolConfig");

    const bc_poolImpl = await deploy("BaseCreditPool", "BaseCreditPoolImpl");
    const bc_pool = await deploy("TransparentUpgradeableProxy", "BaseCreditPool", [
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
