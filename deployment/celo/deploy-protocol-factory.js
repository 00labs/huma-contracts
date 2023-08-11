const {deploy} = require("../utils.js");

const HUMA_OWNER_ADDRESS='0xABd48A580F66ad5Ad0Fe983968De686F408c88EE';
// const POOL_OWNER_EOA='0xf9f1f8b93Be684847D8DaF82b1643b2D5BB4419a';

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
        [HUMA_OWNER_ADDRESS],
        [deployer.address],
    ]);

    const HumaProxyAdminTL = await deploy("TimelockController", "HumaProxyAdminTimelock", [
        0,
        [HUMA_OWNER_ADDRESS],
        [deployer.address],
    ]);

    const rwrImpl = await deploy("RealWorldReceivable", "RWReceivableImpl");
    const rwr = await deploy("TransparentUpgradeableProxy", "RWReceivable", [
        rwrImpl.address,
        HumaProxyAdminTL.address,
        [],
    ]);

    const hdtImpl = await deploy("HDT", "HDTImpl");

    const bc_poolImpl = await deploy("BaseCreditPool", "BaseCreditPoolImpl");
    const rf_poolImpl = await deploy("BaseCreditPool", "ReceivableFactoringPoolImpl");

    const libFeeManager = await deploy("LibFeeManager", "LibFeeManager");
    const libPoolConfig = await deploy("LibPoolConfig", "LibPoolConfig");
    const libHDT = await deploy("LibHDT", "LibHDT");
    const libPool = await deploy("LibPool", "LibPool");
    const poolFactory = await deploy("PoolFactory", "HumaPoolFactory",
    [
        HUMA_OWNER_ADDRESS, 
        humaConfig.address, 
        hdtImpl.address,
        bc_poolImpl.address,
        rf_poolImpl.address,
    ],
    {libraries: {
        LibFeeManager: libFeeManager.address,
        LibPoolConfig: libPoolConfig.address,
        LibHDT: libHDT.address,
        LibPool: libPool.address,
    },})
    // End of deploying base credit pool

}

deployContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
