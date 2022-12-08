const {Wallet, utils} = require("ethers");

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ACCOUNT_PRIVATE_KEY = "";
const TO_ADDRESS = "0x60891b087E81Ee2a61B7606f68019ec112c539B9";

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
        // value: utils.parseUnits("10", "gwei"),
        maxFeePerGas: utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: utils.parseUnits("40", "gwei"),
        nonce: null,
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
