const {BigNumber: BN} = require("ethers");
const {
    getInitilizedContract,
    updateInitilizedContract,
    getDeployedContracts,
    sendTransaction,
} = require("../utils.js");

let deployer, deployedContracts, lender, ea, eaService;
let pdsService, treasury, ea_bcp, bcpOperator, rfpOperator;
let bcpOwnerTreasury, rfpOwnerTreasury;


async function initContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    let invoicePayer;
    [
        deployer, proxyOwner, lender, ea, 
        eaService, pdsService, treasury, ea_bcp,
        invoicePayer, bcpOperator, rfpOperator,
        bcpOwnerTreasury, rfpOwnerTreasury
    ] = await accounts;
    console.log("bcpOperator address: " + bcpOperator.address);
    console.log("rfpOperator address: " + rfpOperator.address);
    
}

initContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
