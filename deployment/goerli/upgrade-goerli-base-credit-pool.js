const {
    getUpgradedContract,
    updateUpgradedContract,
    getDeployedContracts,
    sendTransaction,
} = require("../utils.js");

let deployer, proxyOwner, deployedContracts;

async function upgradePool() {
    const upgraded = await getUpgradedContract("BaseCreditPool");
    if (upgraded) {
        console.log("BaseCreditPool is upgraded already!");
        return;
    }

    if (!deployedContracts["BaseCreditPoolImpl"]) {
        throw new Error("BaseCreditPoolImpl not deployed yet!");
    }

    if (!deployedContracts["BaseCreditPool"]) {
        throw new Error("BaseCreditPool not deployed yet!");
    }

    const TransparentUpgradeableProxy = await hre.ethers.getContractFactory(
        "TransparentUpgradeableProxy"
    );
    let proxy = TransparentUpgradeableProxy.attach(deployedContracts["BaseCreditPool"]);
    proxy = await proxy.connect(proxyOwner);

    await sendTransaction("BaseCreditPool", proxy, "upgradeTo", [
        deployedContracts["BaseCreditPoolImpl"],
    ]);

    await updateUpgradedContract("BaseCreditPool");
}

async function upgradeContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    deployer = await accounts[0];
    console.log("deployer address: " + deployer.address);
    proxyOwner = await accounts[1];
    console.log("proxyOwner address: " + proxyOwner.address);

    deployedContracts = await getDeployedContracts();

    await upgradePool();
}

upgradeContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
