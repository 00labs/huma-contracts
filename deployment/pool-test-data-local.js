const {BigNumber: BN, ethers} = require("ethers");
const {
    getInitilizedContract,
    getDeployedContracts,
    sendTransaction,
    toFixedDecimal,
} = require("./utils.js");

let deployedContracts,
    deployer,
    _proxyOwner,
    ea,
    borrower1,
    borrower2,
    borrower3,
    borrower4,
    borrower5,
    borrower6;

// TODO move this to the scripts folder
async function initContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    [deployer, _proxyOwner, ea, borrower1, borrower2, borrower3, borrower4, borrower5, borrower6] =
        await accounts;
    console.log("deployer address: " + deployer.address);

    deployedContracts = await getDeployedContracts();

    await setupPool();
}

async function setupPool() {
    const initilized = await getInitilizedContract("ReceivableFactoringPool");
    if (!initilized) {
        console.log("ReceivableFactoringPool is not initilized yet!");
        return;
    }

    if (!deployedContracts["ReceivableFactoringPool"]) {
        throw new Error("ReceivableFactoringPool not deployed yet!");
    }

    const ReceivableFactoringPool = await hre.ethers.getContractFactory("ReceivableFactoringPool");
    const pool = ReceivableFactoringPool.attach(deployedContracts["ReceivableFactoringPool"]);
    const poolFromEA = ReceivableFactoringPool.connect(ea).attach(
        deployedContracts["ReceivableFactoringPool"]
    );

    const TestToken = await hre.ethers.getContractFactory("TestToken");
    const token = TestToken.attach(deployedContracts["USDC"]);
    const tokenFromEA = TestToken.connect(ea).attach(deployedContracts["USDC"]);
    const decimals = await token.decimals();

    await sendTransaction("ReceivableFactoringPool", pool, "setEvaluationAgent", [
        BN.from(1),
        ea.address,
    ]);
    await sendTransaction("ReceivableFactoringPool", pool, "addApprovedLender", [
        deployer.address,
    ]);
    await sendTransaction("ReceivableFactoringPool", pool, "addApprovedLender", [ea.address]);

    await sendTransaction("TestToken", token, "approve", [
        pool.address,
        toFixedDecimal(100_000, decimals),
    ]);
    await sendTransaction("TestToken", tokenFromEA, "approve", [
        pool.address,
        toFixedDecimal(100_000, decimals),
    ]);
    await sendTransaction("TestToken", token, "give100000To", [deployer.address]);
    await sendTransaction("TestToken", token, "give100000To", [ea.address]);

    await sendTransaction("ReceivableFactoringPool", pool, "makeInitialDeposit", [
        toFixedDecimal(100_000, decimals),
    ]);
    await sendTransaction("ReceivableFactoringPool", poolFromEA, "makeInitialDeposit", [
        toFixedDecimal(100_000, decimals),
    ]);
    await sendTransaction("ReceivableFactoringPool", pool, "enablePool", []);

    for (const borrower of [borrower5, borrower6]) {
        await sendTransaction("ReceivableFactoringPool", poolFromEA, "recordApprovedCredit", [
            borrower.address,
            toFixedDecimal(1_000, decimals),
            ethers.constants.AddressZero,
            BN.from(1),
            BN.from(1),
            BN.from(30),
            BN.from(12),
        ]);

        const poolFromBorrower = ReceivableFactoringPool.connect(borrower).attach(
            deployedContracts["ReceivableFactoringPool"]
        );

        await sendTransaction(
            "ReceivableFactoringPool",
            poolFromBorrower,
            "drawdownWithReceivable",
            [
                borrower.address,
                toFixedDecimal(1_000, decimals),
                ethers.constants.AddressZero,
                BN.from(1),
                BN.from(1),
            ]
        );
    }
}

initContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
