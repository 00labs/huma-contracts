const {
    getDeployedContracts
} = require("./utils.js");

let deployedContracts;

async function smokeTest() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);

    deployedContracts = await getDeployedContracts();

    console.log("*******************************************************************");
    console.log("*                       Checking humaConfig                       *");
    console.log("*******************************************************************");
    if (!deployedContracts["HumaConfig"]) {
        throw new Error("HumaConfig not deployed yet!");
    }
    const HumaConfig = await hre.ethers.getContractFactory(
        "HumaConfig"
    );
    let humaConfig = HumaConfig.attach(deployedContracts["HumaConfig"]);

    const protocolPaused = await humaConfig.isProtocolPaused();
    console.log("Huma protocol is on: " + !protocolPaused);
    if (protocolPaused) {
        throw new Error("Protocol is Paused!")
    }

    const protocolFee = await humaConfig.protocolFee();
    console.log("Huma protocol fee is: " + protocolFee);

    const humaTreasuryAddress = await humaConfig.humaTreasury();
    console.log("huma treasury address is: " + humaTreasuryAddress);

    console.log("*******************************************************************");
    console.log("*                       Checking pool status                      *");
    console.log("*******************************************************************");
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

    if (!poolOn) {
        throw new Error("ReceivableFactoringPool is off!")
    }

    const totalPoolValue = await receivableFactoringPool.totalPoolValue();
    console.log("ReceivableFactoringPool total pool value: " + totalPoolValue);

    console.log("*******************************************************************");
    console.log("*                       Checking fees                             *");
    console.log("*******************************************************************");
    if (!deployedContracts["ReceivableFactoringPoolFeeManager"]) {
        throw new Error("ReceivableFactoringPoolFeeManager not deployed yet!");
    }

    const ReceivableFactoringPoolFeeManager = await hre.ethers.getContractFactory(
        "BaseFeeManager"
    );
    let receivableFactoringPoolFeeManager = ReceivableFactoringPoolFeeManager.attach(deployedContracts["ReceivableFactoringPoolFeeManager"]);

    const fees = await receivableFactoringPoolFeeManager.getFees();
    console.log("frontLoadingFeeFlat: " + fees[0]);
    console.log("frontLoadingFeeBps: " + fees[1]);
    console.log("lateFeeFlat:" + fees[2]);
    console.log("lateFeeBps:" + fees[3]);
    console.log("membershipFee:" + fees[4]);

    console.log("*******************************************************************");
    console.log("*                       Checking pool data                        *");
    console.log("*******************************************************************");
    if (!deployedContracts["ReceivableFactoringPoolConfig"]) {
        throw new Error("ReceivableFactoringPoolConfig not deployed yet!");
    }
    const ReceivableFactoringPoolConfig = await hre.ethers.getContractFactory(
        "BasePoolConfig"
    );
    let receivableFactoringPoolConfig = ReceivableFactoringPoolConfig.attach(deployedContracts["ReceivableFactoringPoolConfig"]);
    const coreData = await receivableFactoringPoolConfig.getCoreData();
    console.log("underlyingToken address: " + coreData[0]);
    console.log("poolToken (HDT) address: " + coreData[1]);
    console.log("humaConfig address: " + coreData[2]);
    console.log("feeManager address: " + coreData[3]);

    const poolSummary = await receivableFactoringPoolConfig.getPoolSummary();
    console.log("token address: " + poolSummary[0]);
    console.log("token name: " + poolSummary[5]);
    console.log("token symbol: " + poolSummary[6]);
    console.log("token decimal: " + poolSummary[7]);
    console.log("apr: " + poolSummary[1]);
    console.log("payPeriod: " + poolSummary[2]);
    console.log("maxCreditAmount: " + poolSummary[3]);
    console.log("liquidityCap: " + poolSummary[4]);
    console.log("pool eaID: " + poolSummary[8]);
    console.log("EA NFT address: " + poolSummary[9]);
}


smokeTest()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
