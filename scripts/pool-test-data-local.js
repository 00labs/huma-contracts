const {BigNumber: BN, ethers} = require("ethers");
const {
    getInitilizedContract,
    getDeployedContracts,
    sendTransaction,
    toFixedDecimal,
} = require("../deployment/utils.js");

let deployedContracts,
    deployer,
    ea,
    borrower1,
    borrower2,
    borrower3,
    borrower4,
    borrower5,
    borrower6,
    eaServiceAccount;

async function initContracts() {
    let network = (await hre.ethers.provider.getNetwork()).name;
    network = network == "unknown" ? "localhost" : network;
    console.log("network : ", network);
    const accounts = await hre.ethers.getSigners();
    [
        deployer,
        _proxyOwner,
        _lender,
        ea,
        _eaService,
        _pdsService,
        borrower1,
        borrower2,
        borrower3,
        borrower4,
        borrower5,
        borrower6,
    ] = await accounts;
    eaServiceAccount = new ethers.Wallet(process.env.EA_SERVICE, deployer.provider);
    console.log("deployer address: " + deployer.address);

    deployedContracts = await getDeployedContracts();

    const balance = await hre.ethers.provider.getBalance(eaServiceAccount.address);
    if (balance < ethers.utils.parseEther("100")) {
        // Fund eaServiceAccount
        await deployer.sendTransaction({
            to: eaServiceAccount.address,
            value: ethers.utils.parseEther("100"),
        });
    }

    const HumaConfig = await hre.ethers.getContractFactory("HumaConfig");
    const humaConfig = HumaConfig.attach(deployedContracts["HumaConfig"]);

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
    const poolFromEAServiceAccount = ReceivableFactoringPool.connect(eaServiceAccount).attach(
        deployedContracts["ReceivableFactoringPool"]
    );
    const InvoiceNFT = await hre.ethers.getContractFactory("InvoiceNFT");
    const rnNft = InvoiceNFT.attach(deployedContracts["RNNFT"]);
    const TestToken = await hre.ethers.getContractFactory("TestToken");
    const token = TestToken.attach(deployedContracts["USDC"]);
    const decimals = await token.decimals();

    await sendTransaction("TestToken", token, "give1000To", [deployer.address]);
    await sendTransaction("TestToken", token, "approve", [
        rnNft.address,
        toFixedDecimal(1000, decimals),
    ]);

    let baseTokenId = await rnNft.getCurrentTokenId();
    baseTokenId = BN.from(baseTokenId).toNumber();

    for (const [index, borrower] of [
        borrower1,
        borrower2,
        borrower3,
        borrower4,
        borrower5,
        borrower6,
    ].entries()) {
        const tokenId = baseTokenId + index + 1;
        await sendTransaction("InvoiceNFT", rnNft, "mintNFT", [borrower.address, "testURI"]);

        try {
            await sendTransaction(
                "ReceivableFactoringPool",
                poolFromEAServiceAccount,
                "approveCredit",
                [
                    borrower.address,
                    toFixedDecimal(100, decimals),
                    BN.from(30),
                    BN.from(12),
                    rnNft.address,
                    tokenId,
                    toFixedDecimal(150, decimals),
                ]
            );

            const rnNftFromBorrower = InvoiceNFT.connect(borrower).attach(
                deployedContracts["RNNFT"]
            );
            await sendTransaction("InvoiceNFT", rnNftFromBorrower, "approve", [
                pool.address,
                tokenId,
            ]);

            const poolFromBorrower = ReceivableFactoringPool.connect(borrower).attach(
                deployedContracts["ReceivableFactoringPool"]
            );

            await sendTransaction(
                "ReceivableFactoringPool",
                poolFromBorrower,
                "drawdownWithReceivable",
                [borrower.address, toFixedDecimal(100, decimals), rnNft.address, tokenId]
            );

            // Send some payments
            await sendTransaction("InvoiceNFT", rnNft, "payOwner", [
                tokenId,
                toFixedDecimal(20, decimals),
            ]);
            await sendTransaction("InvoiceNFT", rnNft, "payOwner", [
                tokenId,
                toFixedDecimal(25, decimals),
            ]);
        } catch (err) {
            console.log(err);
        }
    }
}

initContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
