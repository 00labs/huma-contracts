const {
    getDeployedContracts
} = require("./utils.js");

let deployedContracts;

async function smokeTest() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);

    deployedContracts = await getDeployedContracts();

    if (!deployedContracts["ReceivableFactoringPoolImpl"]) {
        throw new Error("ReceivableFactoringPoolImpl not deployed yet!");
    }

    if (!deployedContracts["ReceivableFactoringPool"]) {
        throw new Error("ReceivableFactoringPool not deployed yet!");
    }

    const ReceivableFactoringPool = await hre.ethers.getContractFactory(
        "ReceivableFactoringPool"
    );
    let receivableFactoringPool = ReceivableFactoringPool.attach(deployedContracts["ReceivableFactoringPool"]);

    const poolOn = await receivableFactoringPool.isPoolOn();
    console.log("ReceivableFactoringPool is on: " + poolOn);

    const totalPoolValue = await receivableFactoringPool.totalPoolValue();
    console.log("ReceivableFactoringPool total pool value: " + totalPoolValue);
}


smokeTest()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
