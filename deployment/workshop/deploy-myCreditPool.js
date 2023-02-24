const {BigNumber: BN} = require("ethers");
const {deploy, updateInitilizedContract} = require("../utils.js");

async function deployContracts() {
    // await hre.network.provider.send("hardhat_reset")
    const [
        deployer, 
        treasury, 
        eaService,
        pdsService, 
        ea, 
        proxyOwner,
        lender,
        borrower
    ] = await hre.ethers.getSigners();
    
    const myCreditPool = await deploy("MyCreditPool", "MyCreditPool", [], deployer);    
}

deployContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
