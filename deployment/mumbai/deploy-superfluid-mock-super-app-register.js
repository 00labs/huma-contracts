const {deploy} = require("../utils.js");

const MUMBAI_SF_HOST_ADDRESS = "0xEB796bdb90fFA0f28255275e16936D25d3418603";

async function deployContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    if (accounts.length == 0) {
        throw new Error("Accounts not set!");
    }
    const deployer = await accounts[0];
    console.log("deployer address: " + deployer.address);

    const eaService = await accounts[4];
    console.log("ea service address: " + eaService.address);

    const MockSuperAppRegister = await deploy("MockSuperAppRegister", "MockSuperAppRegister", [
        MUMBAI_SF_HOST_ADDRESS,
    ]);
}

deployContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
