const {getDeployedContracts, impersonate} = require("../utils.js");
const {BigNumber: BN} = require("ethers");
const {displayCreditRecord} = require("../verification-test-utils.js");
const RNNFT_ABI = require("../../abi/request_network/InvoiceNFT_0_1_0.json").abi;

const NETWORK = "goerli";
const REQUEST_NETWORK_NFT_ADDRESS = "0x9aEBB4B8abf7afC96dC00f707F766499C5EbeDF1";
const REQUEST_NETWORK_NFT_MINTER = "0x093c9090cA00Df5Fe84190E151C237ee407B7EfE";

let deployedContracts, accounts;

let usdc, decimals, humaConfig, eaService, pdsService;

async function prepare(network) {
    deployedContracts = await getDeployedContracts(network);
    accounts = await hre.ethers.getSigners();

    const TestToken = await hre.ethers.getContractFactory("TestToken");
    usdc = TestToken.attach(deployedContracts["USDC"]);
    decimals = await usdc.decimals();

    const HumaConfig = await hre.ethers.getContractFactory("HumaConfig");
    humaConfig = HumaConfig.attach(deployedContracts["HumaConfig"]);

    const eaServiceAddress = await humaConfig.eaServiceAccount();
    console.log(`ea service: ${eaServiceAddress}`);
    eaService = await impersonate(eaServiceAddress);

    const pdsServiceAddress = await humaConfig.pdsServiceAccount();
    console.log(`pds service: ${pdsServiceAddress}`);
    pdsService = await impersonate(pdsServiceAddress);
}

async function verifyReceivableFactoringPool() {
    console.log(`\n`);
    console.log("*******************************************************************");
    console.log("*           Prepare ReceivableFactoringPool data                  *");
    console.log("*******************************************************************");
    console.log(`\n`);

    const poolOperator = accounts[0];
    const lender = accounts[1];
    console.log(`pool operator address: ${poolOperator.address}`);
    console.log(`lender address: ${lender.address}`);

    const BasePoolConfig = await hre.ethers.getContractFactory("BasePoolConfig");
    const poolConfig = BasePoolConfig.attach(deployedContracts["ReceivableFactoringPoolConfig"]);

    const BaseCreditPool = await hre.ethers.getContractFactory("ReceivableFactoringPool");
    const pool = BaseCreditPool.attach(deployedContracts["ReceivableFactoringPool"]);

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["HDT"]);

    const poolOwnerAddres = await poolConfig.owner();
    console.log(
        `pool owner: ${poolOwnerAddres}, isOperator: ${await poolConfig.isOperator(
            poolOwnerAddres
        )}`
    );
    const poolOwner = await impersonate(poolOwnerAddres);

    let isOperator = await poolConfig.isOperator(poolOperator.address);
    if (!isOperator) {
        await poolConfig.connect(poolOwner).addPoolOperator(poolOperator.address);
    }
    await pool.connect(poolOperator).addApprovedLender(lender.address);

    const nftMinter = await impersonate(REQUEST_NETWORK_NFT_MINTER);
    const nft = new hre.ethers.Contract(REQUEST_NETWORK_NFT_ADDRESS, RNNFT_ABI, nftMinter);

    // choose borrower

    let borrower, cr;
    for (let i = 2; i < 10; i++) {
        cr = await pool.creditRecordMapping(accounts[i].address);
        if (cr.state == 0 || cr.state == 2) {
            borrower = accounts[i];
        }
        // console.log(`${accounts[i].address} state: ${cr.state}`);
    }
    if (borrower) {
        console.log(`borrower address: ${borrower.address}`);
    } else {
        throw new Error("Can't find available borrower!");
    }

    // deposit by lender

    console.log(`\n`);
    console.log("*******************************************************************");
    console.log("*           Checking ReceivableFactoringPool deposit              *");
    console.log("*******************************************************************");
    console.log(`\n`);

    let balance = await usdc.balanceOf(lender.address);
    let depositAmount = BN.from(10000).mul(BN.from(10).pow(BN.from(decimals)));
    if (balance.lt(depositAmount)) {
        await usdc.mint(lender.address, depositAmount);
    }
    console.log(`lender usdc amount before deposit: ${await usdc.balanceOf(lender.address)}`);

    await usdc.connect(lender).approve(pool.address, depositAmount);
    await pool.connect(lender).deposit(depositAmount);

    console.log(`lender usdc amount after deposit: ${await usdc.balanceOf(lender.address)}`);
    console.log(`lender hdt amount after deposit: ${await hdt.balanceOf(lender.address)}`);

    // borrow

    console.log(`\n`);
    console.log("*******************************************************************");
    console.log("*           Checking ReceivableFactoringPool borrow               *");
    console.log("*******************************************************************");
    console.log(`\n`);

    const tokenId = 999999;

    await nft.mint(borrower.address, tokenId, usdc.address, "");
    console.log(`borrower nft ids: ${await nft.getIds(borrower.address)}`);
    await nft.connect(borrower).approve(pool.address, tokenId);

    let creditLimit = BN.from(1000).mul(BN.from(10).pow(BN.from(decimals)));
    await pool
        .connect(eaService)
        ["approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"](
            borrower.address,
            creditLimit,
            30,
            1,
            1217,
            nft.address,
            tokenId,
            creditLimit.mul(BN.from(2))
        );
    await usdc.connect(borrower).approve(pool.address, creditLimit.mul(BN.from(2)));

    let beforeAmount = await usdc.balanceOf(borrower.address);
    await pool.connect(borrower).drawdownWithReceivable(creditLimit, nft.address, tokenId);
    let afterAmount = await usdc.balanceOf(borrower.address);
    console.log(`${borrower.address} borrowed amount: ${afterAmount.sub(beforeAmount)}`);
    cr = await displayCreditRecord(pool, borrower);

    // makePayment by borrower

    console.log(`\n`);
    console.log("*******************************************************************");
    console.log("*     Checking ReceivableFactoringPool makePayment by borrower    *");
    console.log("*******************************************************************");
    console.log(`\n`);

    beforeAmount = cr.totalDue;
    let paymentAmount = BN.from(10).mul(BN.from(10).pow(BN.from(decimals)));
    await pool.connect(borrower).makePayment(borrower.address, paymentAmount);
    cr = await displayCreditRecord(pool, borrower);
    if (beforeAmount.sub(cr.totalDue).lt(paymentAmount)) {
        throw new Error("totalDue decrease is less than payment amount!");
    }

    // makePayment by PDS

    console.log(`\n`);
    console.log("*******************************************************************");
    console.log("*      Checking ReceivableFactoringPool makePayment by PDS        *");
    console.log("*******************************************************************");
    console.log(`\n`);

    beforeAmount = cr.totalDue;
    paymentAmount = BN.from(10).mul(BN.from(10).pow(BN.from(decimals)));
    await pool.connect(pdsService).makePayment(borrower.address, paymentAmount);
    cr = await displayCreditRecord(pool, borrower);
    if (beforeAmount.sub(cr.totalDue).lt(paymentAmount)) {
        throw new Error("totalDue decrease is less than payment amount!");
    }

    // onReceivedPayment payoff

    console.log(`\n`);
    console.log("*******************************************************************");
    console.log("*    Checking ReceivableFactoringPool onReceivedPayment payoff    *");
    console.log("*******************************************************************");
    console.log(`\n`);

    beforeAmount = cr.totalDue;
    paymentAmount = creditLimit.mul(BN.from(2));

    await usdc.mint(pool.address, paymentAmount);
    await pool
        .connect(pdsService)
        .onReceivedPayment(borrower.address, paymentAmount, ethers.utils.formatBytes32String("1"));
    cr = await displayCreditRecord(pool, borrower);
    if (cr.totalDue > 0 || cr.unbilledPrincipal > 0 || cr.state > 3) {
        throw new Error("Data is wrong after payoff!");
    }

    // TODO onReceivedPayment with review

    // withdraw by lender

    console.log(`\n`);
    console.log("*******************************************************************");
    console.log("*           Checking ReceivableFactoringPool withdraw             *");
    console.log("*******************************************************************");
    console.log(`\n`);

    await poolConfig.connect(poolOwner).setWithdrawalLockoutPeriod(0);

    let amount = await hdt.withdrawableFundsOf(lender.address);
    console.log(`lender ${lender.address} withdrawable amount: ${amount}`);
    if (amount < depositAmount) {
        throw new Error("Withrawable amount is less than deposit amount!");
    }
    beforeAmount = await usdc.balanceOf(lender.address);
    await pool.connect(lender).withdraw(amount);
    afterAmount = await usdc.balanceOf(lender.address);
    console.log(`withdrawn amount: ${afterAmount.sub(beforeAmount)}`);
    if (afterAmount.sub(beforeAmount).lt(amount)) {
        throw new Error("Withrawn amount is less than withdrawable amount!");
    }
}

async function verificationTest(network) {
    console.log("forking network : ", network);

    await prepare(network);
    await verifyReceivableFactoringPool();

    console.log("\n");
}

verificationTest(NETWORK)
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
