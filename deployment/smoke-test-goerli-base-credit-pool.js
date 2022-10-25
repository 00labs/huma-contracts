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
    if (!deployedContracts["BaseCreditPoolImpl"]) {
        throw new Error("BaseCreditPoolImpl not deployed yet!");
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

    if (!poolOn) {
        throw new Error("baseCreditPool is off!")
    }

    const totalPoolValue = await baseCreditPool.totalPoolValue();
    console.log("baseCreditPool total pool value: " + totalPoolValue);

    console.log("*******************************************************************");
    console.log("*                       Checking fees                             *");
    console.log("*******************************************************************");
    if (!deployedContracts["BaseCreditPoolFeeManager"]) {
        throw new Error("BaseCreditPoolFeeManager not deployed yet!");
    }

    const BaseCreditPoolFeeManager = await hre.ethers.getContractFactory(
        "BaseFeeManager"
    );
    let baseCreditPoolFeeManager = BaseCreditPoolFeeManager.attach(deployedContracts["BaseCreditPoolFeeManager"]);

    const fees = await baseCreditPoolFeeManager.getFees();
    console.log("frontLoadingFeeFlat: " + fees[0]);
    console.log("frontLoadingFeeBps: " + fees[1]);
    console.log("lateFeeFlat:" + fees[2]);
    console.log("lateFeeBps:" + fees[3]);
    console.log("membershipFee:" + fees[4]);

    console.log("*******************************************************************");
    console.log("*                       Checking pool data                        *");
    console.log("*******************************************************************");
    if (!deployedContracts["BaseCreditPoolConfig"]) {
        throw new Error("BaseCreditPoolConfig not deployed yet!");
    }
    const BaseCreditPoolConfig = await hre.ethers.getContractFactory(
        "BasePoolConfig"
    );
    let baseCreditPoolConfig = BaseCreditPoolConfig.attach(deployedContracts["BaseCreditPoolConfig"]);
    const coreData = await baseCreditPoolConfig.getCoreData();
    console.log("underlyingToken address: " + coreData[0]);
    console.log("poolToken (HDT) address: " + coreData[1]);
    console.log("humaConfig address: " + coreData[2]);
    console.log("feeManager address: " + coreData[3]);

    const poolSummary = await baseCreditPoolConfig.getPoolSummary();
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
