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

    // Deploying Receivable factoring pool
    // const usdc = await deploy("TestToken", "USDC");

    const humaConfig = await deploy("HumaConfig", "HumaConfig");
    const humaConfigTL = await deploy("TimelockController", "HumaConfigTimelock", [
        0,
        [HUMA_OWNER_MULTI_SIG],
        [deployer.address],
    ]);

    const receivableFactoringPoolTL = await deploy(
        "TimelockController",
        "ReceivableFactoringPoolTimelock",
        [0, [POOL_OWNER_MULTI_SIG], [deployer.address]]
    );

    const receivableFactoringPoolProxyAdminTL = await deploy(
        "TimelockController",
        "ReceivableFactoringPoolProxyAdminTimelock",
        [0, [POOL_OWNER_MULTI_SIG], [deployer.address]]
    );

    const feeManager = await deploy("BaseFeeManager", "ReceivableFactoringPoolFeeManager");
    const hdtImpl = await deploy("HDT", "HDTImpl");
    const hdt = await deploy("TransparentUpgradeableProxy", "HDT", [
        hdtImpl.address,
        receivableFactoringPoolProxyAdminTL.address,
        [],
    ]);

    const poolConfig = await deploy("BasePoolConfig", "ReceivableFactoringPoolConfig");

    const poolImpl = await deploy("ReceivableFactoringPool", "ReceivableFactoringPoolImpl");
    const pool = await deploy("TransparentUpgradeableProxy", "ReceivableFactoringPool", [
        poolImpl.address,
        receivableFactoringPoolProxyAdminTL.address,
        [],
    ]);

    const evaluationAgentNFT = await deploy("EvaluationAgentNFT", "EANFT", [], deployer);

    const invoiceNFT = await deploy("InvoiceNFT", "RNNFT", ['0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174']);
}

deployContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
