const {Wallet, utils} = require("ethers");

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ACCOUNT_PRIVATE_KEY = "";
const TO_ADDRESS = "0x07250B0373Aa6a3de47A44e3Cf720A6376296dD5";

async function main() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const account = new Wallet(ACCOUNT_PRIVATE_KEY, await hre.ethers.provider);
    console.log("account address: " + account.address);
    const txCount = await account.getTransactionCount("latest");
    console.log(`transaction account: ${txCount}`);
    const txPendingCount = await account.getTransactionCount("pending");
    console.log(`transaction pending account: ${txPendingCount}`);

    const data = {
        to: TO_ADDRESS,
        value: utils.parseUnits("10", "gwei"),
        maxFeePerGas: utils.parseUnits("280", "gwei"),
        maxPriorityFeePerGas: utils.parseUnits("200", "gwei"),
        nonce: 92173,
    };

    const tx = await account.sendTransaction(data);
    console.log(`send cancel tx: ${JSON.stringify(tx)}`);
    await tx.wait();
    console.log("done");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
