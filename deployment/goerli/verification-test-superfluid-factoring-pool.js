const {getDeployedContracts, impersonate, advanceClock} = require("../utils.js");
const {BigNumber: BN} = require("ethers");
const {displayCreditRecord} = require("../verification-test-utils.js");

const NETWORK = "goerli";
const SF_USDC_ADDRESS = "0xc94dd466416A7dFE166aB2cF916D3875C049EBB7";
const SF_USDCX_ADDRESS = "0x8aE68021f6170E5a766bE613cEA0d75236ECCa9a";
const SF_HOST_ADDRESS = "0x22ff293e14F1EC3A09B137e9e06084AFd63adDF9";
const SF_CFA_ADDRESS = "0xEd6BcbF6907D4feEEe8a8875543249bEa9D308E8";

let deployedContracts, accounts;

let usdc, decimals, sf, usdcx, cfa, nft;

let humaConfig, eaService, pdsService;

async function createFlow(xToken, payer, payee, flowrate) {
    const calldata = cfa.interface.encodeFunctionData("createFlow", [
        xToken.address,
        payee.address,
        flowrate,
        "0x",
    ]);

    await sf.connect(payer).callAgreement(cfa.address, calldata, "0x");
}

async function authorizeFlow(xToken, sender, operator) {
    const calldata = cfa.interface.encodeFunctionData("authorizeFlowOperatorWithFullControl", [
        xToken.address,
        operator.address,
        "0x",
    ]);
    await sf.connect(sender).callAgreement(cfa.address, calldata, "0x");
}

async function prepare(network) {
    deployedContracts = await getDeployedContracts(network);
    accounts = await hre.ethers.getSigners();

    const TestToken = await hre.ethers.getContractFactory("TestToken");
    usdc = TestToken.attach(SF_USDC_ADDRESS);
    decimals = await usdc.decimals();

    const HumaConfig = await hre.ethers.getContractFactory("HumaConfig");
    humaConfig = HumaConfig.attach(deployedContracts["HumaConfig"]);

    const eaServiceAddress = await humaConfig.eaServiceAccount();
    console.log(`ea service: ${eaServiceAddress}`);
    eaService = await impersonate(eaServiceAddress);

    const pdsServiceAddress = await humaConfig.pdsServiceAccount();
    console.log(`pds service: ${pdsServiceAddress}`);
    pdsService = await impersonate(pdsServiceAddress);

    sf = await ethers.getContractAt("ISuperfluid", SF_HOST_ADDRESS);
    usdcx = await ethers.getContractAt("ISuperToken", SF_USDCX_ADDRESS);
    cfa = await ethers.getContractAt("IConstantFlowAgreementV1", SF_CFA_ADDRESS);

    const TradableStream = await hre.ethers.getContractFactory("TradableStream");
    nft = TradableStream.attach(deployedContracts["SuperfluidTradableStream"]);
}

async function verifySuperfluidFactoringPool() {
    console.log(`\n`);
    console.log("*******************************************************************");
    console.log("*           Prepare SuperfluidFactoringPool data                  *");
    console.log("*******************************************************************");
    console.log(`\n`);

    const poolOperator = accounts[0];
    const lender = accounts[1];
    const payer = accounts[2];
    console.log(`pool operator address: ${poolOperator.address}`);
    console.log(`lender address: ${lender.address}`);
    console.log(`payer address: ${payer.address}`);

    const BasePoolConfig = await hre.ethers.getContractFactory("BasePoolConfig");
    const poolConfig = BasePoolConfig.attach(deployedContracts["SuperfluidFactoringPoolConfig"]);

    const SuperfluidFactoringPool = await hre.ethers.getContractFactory("SuperfluidFactoringPool");
    const pool = SuperfluidFactoringPool.attach(deployedContracts["SuperfluidFactoringPool"]);

    const HDT = await hre.ethers.getContractFactory("HDT");
    const hdt = HDT.attach(deployedContracts["SuperfluidPoolHDT"]);

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

    // choose borrower

    let borrower, cr;
    for (let i = 3; i < 10; i++) {
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

    let amount = BN.from(10000).mul(BN.from(10).pow(BN.from(decimals)));
    await usdc.mint(payer.address, amount);
    await usdc.connect(payer).approve(usdcx.address, amount);
    await usdcx.connect(payer).upgrade(amount);

    const streamAmount = BN.from(800).mul(BN.from(10).pow(BN.from(decimals)));
    const streamDays = 10;
    const streamDuration = streamDays * 24 * 3600;

    let flowrate = streamAmount.div(BN.from(streamDuration));
    await createFlow(usdcx, payer, borrower, flowrate);

    await authorizeFlow(usdcx, payer, nft);

    // deposit by lender

    console.log(`\n`);
    console.log("*******************************************************************");
    console.log("*           Checking SuperfluidFactoringPool deposit              *");
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
    console.log("*           Checking SuperfluidFactoringPool borrow               *");
    console.log("*******************************************************************");
    console.log(`\n`);

    const collateralAmount = BN.from(500).mul(BN.from(10).pow(BN.from(decimals)));
    flowrate = collateralAmount.div(BN.from(streamDuration)).add(BN.from(1));
    await nft.connect(borrower).mint(usdcx.address, payer.address, flowrate, streamDuration);
    const streamId = (await nft.balanceOf(borrower.address)).sub(BN.from(1));

    await nft.connect(borrower).approve(pool.address, streamId);

    let creditLimit = BN.from(1000).mul(BN.from(10).pow(BN.from(decimals)));
    await pool
        .connect(eaService)
        ["approveCredit(address,uint256,uint256,uint256,uint256,address,uint256,uint256)"](
            borrower.address,
            streamAmount,
            streamDays,
            1,
            1217,
            nft.address,
            ethers.utils.solidityKeccak256(
                ["address", "address", "address"],
                [usdcx.address, payer.address, borrower.address]
            ),
            streamAmount
        );
    await usdc.connect(borrower).approve(pool.address, streamAmount.mul(BN.from(2)));

    let beforeAmount = await usdc.balanceOf(borrower.address);
    await pool.connect(borrower).drawdownWithReceivable(collateralAmount, nft.address, streamId);
    let afterAmount = await usdc.balanceOf(borrower.address);
    console.log(`${borrower.address} borrowed amount: ${afterAmount.sub(beforeAmount)}`);
    cr = await displayCreditRecord(pool, borrower);

    // makePayment by borrower

    console.log(`\n`);
    console.log("*******************************************************************");
    console.log("*     Checking SuperfluidFactoringPool makePayment by borrower    *");
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
    console.log("*      Checking SuperfluidFactoringPool makePayment by PDS        *");
    console.log("*******************************************************************");
    console.log(`\n`);

    beforeAmount = cr.totalDue;
    paymentAmount = BN.from(10).mul(BN.from(10).pow(BN.from(decimals)));
    await pool.connect(pdsService).makePayment(borrower.address, paymentAmount);
    cr = await displayCreditRecord(pool, borrower);
    if (beforeAmount.sub(cr.totalDue).lt(paymentAmount)) {
        throw new Error("totalDue decrease is less than payment amount!");
    }

    // payoff

    console.log(`\n`);
    console.log("*******************************************************************");
    console.log("*            Checking SuperfluidFactoringPool payoff              *");
    console.log("*******************************************************************");
    console.log(`\n`);

    await advanceClock(streamDays);

    await pool.payoff(nft.address, streamId);
    cr = await displayCreditRecord(pool, borrower);
    if (cr.totalDue > 0 || cr.unbilledPrincipal > 0 || cr.state > 3) {
        throw new Error("Data is wrong after payoff!");
    }

    // TODO onReceivedPayment with review

    // withdraw by lender

    console.log(`\n`);
    console.log("*******************************************************************");
    console.log("*           Checking SuperfluidFactoringPool withdraw             *");
    console.log("*******************************************************************");
    console.log(`\n`);

    await poolConfig.connect(poolOwner).setWithdrawalLockoutPeriod(0);

    amount = await hdt.withdrawableFundsOf(lender.address);
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
    await verifySuperfluidFactoringPool();

    console.log("\n");
}

verificationTest(NETWORK)
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
