const fs = require("fs");

async function genFunctionIds(sourceFile, destFile) {
    const errorFunctions = require(sourceFile);
    for (const errFunc of Object.keys(errorFunctions)) {
        const errFuncId = hre.ethers.utils
            .keccak256(hre.ethers.utils.toUtf8Bytes(errFunc))
            .substring(0, 10);
        console.log(`${errFunc} selectId is ${errFuncId}`);
        errorFunctions[errFunc] = errFuncId;
    }
    fs.writeFileSync(destFile, JSON.stringify(errorFunctions));
}

async function addContractComments(sourceFile, contractFile) {
    const data = fs.readFileSync(contractFile, {flag: "a+"});
    let content = data.toString();
    const errorFunctions = require(sourceFile);
    for (const errFunc of Object.keys(errorFunctions)) {
        let oldStr = `error ${errFunc};`;
        let newStr = `error ${errFunc}; // ${errorFunctions[errFunc]}`;
        if (!content.includes(newStr)) {
            content = content.replace(oldStr, newStr);
        }
    }
    fs.writeFileSync(contractFile, content);
}

async function main() {
    const sourceFile = "./error-functions.json";
    const destFile = "./scripts/error-functions.json";
    const errorFile = "./contracts/Errors.sol";

    await genFunctionIds(sourceFile, destFile);
    await addContractComments(sourceFile, errorFile);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
