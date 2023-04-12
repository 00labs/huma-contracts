const {getDeployedContracts, impersonate, advanceClock} = require("../utils.js");
const {BigNumber: BN} = require("ethers");
const {displayCreditRecord} = require("../verification-test-utils.js");

let chainUrl = process.env["MUMBAI_URL"];
const MUMBAI_CHAIN_ID = 80001;

const NETWORK = "maticmum";
const SF_USDC_ADDRESS = "0xbe49ac1EadAc65dccf204D4Df81d650B50122aB2";
const SF_USDCX_ADDRESS = "0x42bb40bF79730451B11f6De1CbA222F17b87Afd7";
const SF_HOST_ADDRESS = "0xEB796bdb90fFA0f28255275e16936D25d3418603";
const SF_CFA_ADDRESS = "0x49e565Ed1bdc17F3d220f72DF0857C26FA83F873";

let deployedContracts, accounts;

let usdc, decimals, sf, usdcx, cfa, nft, multisend, nftVersion;

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

    const Multisend = await hre.ethers.getContractFactory("Multisend");
    multisend = Multisend.attach(deployedContracts["Multisend"]);

    nftVersion = await nft.version();
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

    const ReceivableFactoringPoolV2 = await hre.ethers.getContractFactory(
        "ReceivableFactoringPoolV2"
    );
    const pool = ReceivableFactoringPoolV2.attach(deployedContracts["SuperfluidFactoringPool"]);

    const SuperfluidPoolProcessor = await hre.ethers.getContractFactory("SuperfluidPoolProcessor");
    const processor = SuperfluidPoolProcessor.attach(deployedContracts["SuperfluidProcessor"]);

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

    await usdc.connect(borrower).approve(processor.address, streamAmount.mul(BN.from(2)));
    let collateralAmount = BN.from(500).mul(BN.from(10).pow(BN.from(decimals)));
    flowrate = collateralAmount.div(BN.from(streamDuration)).add(BN.from(1));
    collateralAmount = flowrate.mul(BN.from(streamDuration));
    let nonce = await nft.nonces(borrower.address);
    let expiry = Math.ceil(Date.now() / 1000) + 300;

    let signatureData = await borrower._signTypedData(
        {
            name: "TradableStream",
            version: nftVersion,
            chainId: MUMBAI_CHAIN_ID,
            verifyingContract: nft.address,
        },
        {
            MintToWithAuthorization: [
                {name: "receiver", type: "address"},
                {name: "token", type: "address"},
                {name: "origin", type: "address"},
                {name: "owner", type: "address"},
                {name: "flowrate", type: "int96"},
                {name: "durationInSeconds", type: "uint256"},
                {name: "nonce", type: "uint256"},
                {name: "expiry", type: "uint256"},
            ],
        },
        {
            receiver: borrower.address,
            token: usdcx.address,
            origin: payer.address,
            owner: processor.address,
            flowrate: flowrate,
            durationInSeconds: streamDuration,
            nonce: nonce,
            expiry: expiry,
        }
    );
    let signature = ethers.utils.splitSignature(signatureData);

    let calldata = ethers.utils.defaultAbiCoder.encode(
        [
            "address",
            "address",
            "address",
            "int96",
            "uint256",
            "uint256",
            "uint8",
            "bytes32",
            "bytes32",
        ],
        [
            borrower.address,
            usdcx.address,
            payer.address,
            flowrate,
            streamDuration,
            expiry,
            signature.v,
            signature.r,
            signature.s,
        ]
    );

    let beforeAmount = await usdc.balanceOf(borrower.address);
    await multisend.multisend(
        [processor.address],
        [
            processor.interface.encodeFunctionData("mintAndDrawdown", [
                borrower.address,
                collateralAmount,
                nft.address,
                calldata,
            ]),
        ]
    );
    let afterAmount = await usdc.balanceOf(borrower.address);
    console.log(`${borrower.address} borrowed amount: ${afterAmount.sub(beforeAmount)}`);
    cr = await displayCreditRecord(pool, borrower);
    const streamId = (await nft.balanceOf(processor.address)).sub(BN.from(1));
    console.log(`streamId: ${streamId}`);

    // makePayment by borrower

    console.log(`\n`);
    console.log("*******************************************************************");
    console.log("*     Checking SuperfluidFactoringPool makePayment by borrower    *");
    console.log("*******************************************************************");
    console.log(`\n`);

    await usdc.connect(borrower).approve(pool.address, streamAmount.mul(BN.from(2)));
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
    console.log("*          Checking SuperfluidFactoringPool settlement            *");
    console.log("*******************************************************************");
    console.log(`\n`);

    await advanceClock(streamDays);

    await processor.settlement(nft.address, streamId);
    cr = await displayCreditRecord(pool, borrower);
    if (cr.totalDue > 0 || cr.unbilledPrincipal > 0 || cr.state > 3) {
        throw new Error("Data is wrong after payoff!");
    }

    // TODO terminate flow

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
    await hre.network.provider.request({
        method: "hardhat_reset",
        params: [
            {
                forking: {
                    jsonRpcUrl: chainUrl,
                },
            },
        ],
    });

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
