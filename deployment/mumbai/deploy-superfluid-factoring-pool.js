const {deploy} = require("../utils.js");

const HUMA_OWNER_EOA = "0x4062A9Eab6a49B2Be6aE4F7240D420f6fbE2e615";
const POOL_OWNER_EOA = "0x7c25422C52e4c5187b9A448df627E79175281d5a";

const SF_USDC_ADDRESS = "0xbe49ac1EadAc65dccf204D4Df81d650B50122aB2";
const SF_HOST_ADDRESS = "0xEB796bdb90fFA0f28255275e16936D25d3418603";

async function deployContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    if (accounts.length == 0) {
        throw new Error("Accounts not set!");
    }
    const deployer = await accounts[0];
    console.log("deployer address: " + deployer.address);
    // const proxyOwner = await accounts[1];

    const eaService = await accounts[1];
    // console.log("ea service address: " + eaService.address);

    // Deploying Superfluid factoring pool

    const humaConfig = await deploy("HumaConfig", "HumaConfig");
    const humaConfigTL = await deploy("TimelockController", "HumaConfigTimelock", [
        0,
        [HUMA_OWNER_EOA],
        [deployer.address],
    ]);

    const superfluidFactoringPoolTL = await deploy(
        "TimelockController",
        "SuperfluidFactoringPoolTimelock",
        [0, [POOL_OWNER_EOA], [deployer.address]]
    );

    const superfluidFactoringPoolProxyAdminTL = await deploy(
        "TimelockController",
        "SuperfluidFactoringPoolProxyAdminTimelock",
        [0, [POOL_OWNER_EOA], [deployer.address]]
    );

    const feeManager = await deploy("SuperfluidFeeManager", "SuperfluidFactoringPoolFeeManager");
    const hdtImpl = await deploy("HDT", "SuperfluidPoolHDTImpl");
    const hdt = await deploy("TransparentUpgradeableProxy", "SuperfluidPoolHDT", [
        hdtImpl.address,
        superfluidFactoringPoolProxyAdminTL.address,
        [],
    ]);

    const poolConfig = await deploy("BasePoolConfig", "SuperfluidFactoringPoolConfig");

    const poolImpl = await deploy("ReceivableFactoringPoolV2", "SuperfluidFactoringPoolImpl");
    const pool = await deploy("TransparentUpgradeableProxy", "SuperfluidFactoringPool", [
        poolImpl.address,
        superfluidFactoringPoolProxyAdminTL.address,
        [],
    ]);

    const processorImpl = await deploy("SuperfluidPoolProcessor", "SuperfluidProcessorImpl");
    const processor = await deploy("TransparentUpgradeableProxy", "SuperfluidProcessor", [
        processorImpl.address,
        superfluidFactoringPoolProxyAdminTL.address,
        [],
    ]);

    const evaluationAgentNFT = await deploy("EvaluationAgentNFT", "EANFT", [], eaService);

    const tradableStream = await deploy("TradableStream", "SuperfluidTradableStream", [
        SF_HOST_ADDRESS,
    ]);

    await deploy("Multisend", "Multisend");
}

deployContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
