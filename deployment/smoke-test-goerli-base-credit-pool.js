const {
    getDeployedContracts
} = require("./utils.js");

let deployedContracts;

async function smokeTest() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);

    deployedContracts = await getDeployedContracts();

    if (!deployedContracts["BaseCreditPoolImpl"]) {
        throw new Error("BaseCreditPool not deployed yet!");
    }

    if (!deployedContracts["BaseCreditPool"]) {
        throw new Error("BaseCreditPool not deployed yet!");
    }

    const BaseCreditPool = await hre.ethers.getContractFactory(
        "BaseCreditPool"
    );
    let baseCreditPool = BaseCreditPool.attach(deployedContracts["BaseCreditPool"]);

    const poolOn = await baseCreditPool.isPoolOn();
    console.log("baseCreditPool is on: " + poolOn);

    const totalPoolValue = await baseCreditPool.totalPoolValue();
    console.log("baseCreditPool total pool value: " + totalPoolValue);
    // More to be added
}


smokeTest()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
