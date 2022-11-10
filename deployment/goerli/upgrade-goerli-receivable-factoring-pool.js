const {
    getUpgradedContract,
    updateUpgradedContract,
    getDeployedContracts,
    sendTransaction,
} = require("./utils.js");

let deployer, proxyOwner, deployedContracts;

async function upgradePool() {
    const upgraded = await getUpgradedContract("ReceivableFactoringPool");
    if (upgraded) {
        console.log("ReceivableFactoringPool is upgraded already!");
        return;
    }

    if (!deployedContracts["ReceivableFactoringPoolImpl"]) {
        throw new Error("ReceivableFactoringPoolImpl not deployed yet!");
    }

    if (!deployedContracts["ReceivableFactoringPool"]) {
        throw new Error("ReceivableFactoringPool not deployed yet!");
    }

    const TransparentUpgradeableProxy = await hre.ethers.getContractFactory(
        "TransparentUpgradeableProxy"
    );
    let proxy = TransparentUpgradeableProxy.attach(deployedContracts["ReceivableFactoringPool"]);
    proxy = await proxy.connect(proxyOwner);

    await sendTransaction("ReceivableFactoringPool", proxy, "upgradeTo", [
        deployedContracts["ReceivableFactoringPoolImpl"],
    ]);

    await updateUpgradedContract("ReceivableFactoringPool");
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
