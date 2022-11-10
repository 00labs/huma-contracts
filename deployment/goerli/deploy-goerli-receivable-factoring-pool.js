const {deploy} = require("../utils.js");

const HUMA_OWNER_ADRESS='0x1931bD73055335Ba06efB22DB96169dbD4C5B4DB'

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

    // Deploying Receivable factoring pool
    const usdc = await deploy("TestToken", "USDC");

    const humaConfig = await deploy("HumaConfig", "HumaConfig");
    const humaConfigTL = await deploy("TimelockController", "HumaConfigTimelock", [
        0,
        [HUMA_OWNER_ADRESS],
        [HUMA_OWNER_ADRESS],
    ]);

    const feeManager = await deploy("BaseFeeManager", "ReceivableFactoringPoolFeeManager");
    const hdtImpl = await deploy("HDT", "HDTImpl");
    const hdt = await deploy("TransparentUpgradeableProxy", "HDT", [
        hdtImpl.address,
        HUMA_OWNER_ADRESS,
        [],
    ]);

    const poolConfig = await deploy("BasePoolConfig", "ReceivableFactoringPoolConfig");

    const poolImpl = await deploy("ReceivableFactoringPool", "ReceivableFactoringPoolImpl");
    const pool = await deploy("TransparentUpgradeableProxy", "ReceivableFactoringPool", [
        poolImpl.address,
        HUMA_OWNER_ADRESS,
        [],
    ]);

    const evaluationAgentNFT = await deploy("EvaluationAgentNFT", "EANFT", [], eaService);

    const invoiceNFT = await deploy("InvoiceNFT", "RNNFT", [usdc.address]);
}

deployContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });