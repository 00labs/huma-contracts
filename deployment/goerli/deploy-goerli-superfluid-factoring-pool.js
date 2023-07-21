const {deploy} = require("../utils.js");

const HUMA_OWNER_MULTI_SIG = "0x1931bD73055335Ba06efB22DB96169dbD4C5B4DB";
const POOL_OWNER_MULTI_SIG = "0xB69cD2CC66583a4f46c1a8C977D5A8Bf9ecc81cA";

const SF_USDC_ADDRESS = "0xc94dd466416A7dFE166aB2cF916D3875C049EBB7";
const SF_HOST_ADDRESS = "0x22ff293e14F1EC3A09B137e9e06084AFd63adDF9";

async function deployContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    if (accounts.length == 0) {
        throw new Error("Accounts not set!");
    }
    const deployer = await accounts[0];
    console.log("deployer address: " + deployer.address);
    const proxyOwner = await accounts[1];

    const eaService = await accounts[4];
    console.log("ea service address: " + eaService.address);

    // Deploying Superfluid factoring pool

    const humaConfig = await deploy("HumaConfig", "HumaConfig");
    const humaConfigTL = await deploy("TimelockController", "HumaConfigTimelock", [
        0,
        [HUMA_OWNER_MULTI_SIG],
        [deployer.address],
    ]);

    const superfluidFactoringPoolTL = await deploy(
        "TimelockController",
        "SuperfluidFactoringPoolTimelock",
        [0, [POOL_OWNER_MULTI_SIG], [deployer.address]]
    );

    const superfluidFactoringPoolProxyAdminTL = await deploy(
        "TimelockController",
        "SuperfluidFactoringPoolProxyAdminTimelock",
        [0, [POOL_OWNER_MULTI_SIG], [deployer.address]]
    );

    const feeManager = await deploy("StreamFeeManager", "SuperfluidFactoringPoolFeeManager");
    const hdtImpl = await deploy("HDT", "SuperfluidPoolHDTImpl");
    const hdt = await deploy("TransparentUpgradeableProxy", "SuperfluidPoolHDT", [
        hdtImpl.address,
        superfluidFactoringPoolProxyAdminTL.address,
        [],
    ]);

    const poolConfig = await deploy("BasePoolConfig", "SuperfluidFactoringPoolConfig");

    const poolImpl = await deploy("SuperfluidFactoringPool", "SuperfluidFactoringPoolImpl");
    const pool = await deploy("TransparentUpgradeableProxy", "SuperfluidFactoringPool", [
        poolImpl.address,
        superfluidFactoringPoolProxyAdminTL.address,
        [],
    ]);

    // const evaluationAgentNFT = await deploy("EvaluationAgentNFT", "EANFT", [], eaService);

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
