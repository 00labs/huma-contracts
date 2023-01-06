require("dotenv").config();
require("hardhat-contract-sizer");

require("@nomicfoundation/hardhat-chai-matchers");
require("@tenderly/hardhat-tenderly");

require("hardhat-gas-reporter");
require("hardhat-abi-exporter");

require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-etherscan");
require("hardhat-prettier");
require("solidity-coverage");

require("hardhat-abi-exporter");
require("dotenv").config();
const fs = require("fs");

const EMPTY_URL = "empty url";
const EMPTY_PRIVATE_KEY = "0x0000000000000000000000000000000000000000000000000000000000000000";

let goerliUrl = process.env["GOERLI_URL"];
if (!goerliUrl) {
    goerliUrl = EMPTY_URL;
}
let mumbaiUrl = process.env["MUMBAI_URL"];
if (!mumbaiUrl) {
    mumbaiUrl = EMPTY_URL;
}
let polygonUrl = process.env["POLYGON_URL"];
if (!polygonUrl) {
    polygonUrl = EMPTY_URL;
}
let mainnetUrl = process.env["MAINNET_URL"];
if (!mainnetUrl) {
    mainnetUrl = EMPTY_URL;
}
let deployer = process.env["DEPLOYER"];
if (!deployer) {
    deployer = EMPTY_PRIVATE_KEY;
}
let proxyOwner = process.env["PROXY_OWNER"];
if (!proxyOwner) {
    proxyOwner = EMPTY_PRIVATE_KEY;
}
let lender = process.env["LENDER"];
if (!lender) {
    lender = EMPTY_PRIVATE_KEY;
}
let ea = process.env["EA"];
if (!ea) {
    ea = EMPTY_PRIVATE_KEY;
}
let eaService = process.env["EA_SERVICE"];
if (!eaService) {
    eaService = EMPTY_PRIVATE_KEY;
}
let pdsService = process.env["PDS_SERVICE"];
if (!pdsService) {
    pdsService = EMPTY_PRIVATE_KEY;
}
let treasury = process.env["TREASURY"];
if (!treasury) {
    treasury = EMPTY_PRIVATE_KEY;
}
let ea_bcp = process.env["EA_BASE_CREDIT"];
if (!ea_bcp) {
    ea_bcp = EMPTY_PRIVATE_KEY;
}
let invoicePayer = process.env["INVOICE_PAYER"];
if (!invoicePayer) {
    invoicePayer = EMPTY_PRIVATE_KEY;
}
let baseCreditPoolOperator = process.env["BASE_CREDIT_POOL_OPERATOR"];
if (!baseCreditPoolOperator) {
    baseCreditPoolOperator = EMPTY_PRIVATE_KEY;
}
let receivableFactoringPoolOperator = process.env["RECEIVABLE_FACTORING_POOL_OPERATOR"];
if (!receivableFactoringPoolOperator) {
    receivableFactoringPoolOperator = EMPTY_PRIVATE_KEY;
}
let receivableFactoringPoolOwnerTreasury = process.env["RECEIVABLE_FACTORING_POOL_OWNER_TREASURY"];
if (!receivableFactoringPoolOwnerTreasury) {
    receivableFactoringPoolOwnerTreasury = EMPTY_PRIVATE_KEY;
}
let baseCreditPoolOwnerTreasury = process.env["BASE_CREDIT_POOL_OWNER_TREASURY"];
if (!baseCreditPoolOwnerTreasury) {
    baseCreditPoolOwnerTreasury = EMPTY_PRIVATE_KEY;
}

//
// Select the network you want to deploy to here:
//
const defaultNetwork = "localhost";

const mainnetGwei = 21;

function mnemonic() {
    try {
        return fs.readFileSync("./mnemonic.txt").toString().trim();
    } catch (e) {
        if (defaultNetwork !== "localhost") {
            console.log(
                "☢️ WARNING: No mnemonic file created for a deploy account. Try `yarn run generate` and then `yarn run account`."
            );
        }
    }
    return "";
}

module.exports = {
    defaultNetwork,

    /**
     * gas reporter configuration that let's you know
     * an estimate of gas for contract deployments and function calls
     * More here: https://hardhat.org/plugins/hardhat-gas-reporter.html
     */
    gasReporter: {
        currency: "USD",
        coinmarketcap: process.env.COINMARKETCAP || null,
    },

    // if you want to deploy to a testnet, mainnet, or xdai, you will need to configure:
    // 1. An Infura key (or similar)
    // 2. A private key for the deployer
    // DON'T PUSH THESE HERE!!!
    // An `example.env` has been provided in the Hardhat root. Copy it and rename it `.env`
    // Follow the directions, and uncomment the network you wish to deploy to.

    networks: {
        localhost: {
            url: "http://0.0.0.0:8545",
            /*
              notice no mnemonic here? it will just use account 0 of the hardhat node to deploy
              (you can put in a mnemonic here to set the deployer locally)
            */
        },
        rinkeby: {
            url: "https://rinkeby.infura.io/v3/460f40a260564ac4a4f4b3fffb032dad", // <---- YOUR INFURA ID! (or it won't work)
            //    url: "https://speedy-nodes-nyc.moralis.io/XXXXXXXXXXXXXXXXXXXXXXX/eth/rinkeby", // <---- YOUR MORALIS ID! (not limited to infura)
            accounts: {
                mnemonic: mnemonic(),
            },
        },
        kovan: {
            url: "https://kovan.infura.io/v3/460f40a260564ac4a4f4b3fffb032dad", // <---- YOUR INFURA ID! (or it won't work)
            //    url: "https://speedy-nodes-nyc.moralis.io/XXXXXXXXXXXXXXXXXXXXXXX/eth/kovan", // <---- YOUR MORALIS ID! (not limited to infura)
            accounts: {
                mnemonic: mnemonic(),
            },
        },
        mainnet: {
            url: mainnetUrl,
            accounts: [deployer, eaService],
        },
        ropsten: {
            url: "https://ropsten.infura.io/v3/460f40a260564ac4a4f4b3fffb032dad", // <---- YOUR INFURA ID! (or it won't work)
            //      url: "https://speedy-nodes-nyc.moralis.io/XXXXXXXXXXXXXXXXXXXXXXXXX/eth/ropsten",// <---- YOUR MORALIS ID! (not limited to infura)
            accounts: {
                mnemonic: mnemonic(),
            },
        },
        goerli: {
            url: goerliUrl,
            accounts: [
                deployer,
                proxyOwner,
                lender,
                ea,
                eaService,
                pdsService,
                treasury,
                ea_bcp,
                invoicePayer,
                baseCreditPoolOperator,
                receivableFactoringPoolOperator,
                baseCreditPoolOwnerTreasury,
                receivableFactoringPoolOwnerTreasury,
            ],
        },
        xdai: {
            url: "https://rpc.xdaichain.com/",
            gasPrice: 1000000000,
            accounts: {
                mnemonic: mnemonic(),
            },
        },
        fantom: {
            url: "https://rpcapi.fantom.network",
            gasPrice: 1000000000,
            accounts: {
                mnemonic: mnemonic(),
            },
        },
        testnetFantom: {
            url: "https://rpc.testnet.fantom.network",
            gasPrice: 1000000000,
            accounts: {
                mnemonic: mnemonic(),
            },
        },
        polygon: {
            url: polygonUrl,
            accounts: [deployer, eaService],
        },
        mumbai: {
            url: mumbaiUrl,
            accounts: [
                deployer,
                proxyOwner,
                lender,
                ea,
                eaService,
                pdsService,
                treasury,
                ea_bcp,
                invoicePayer,
            ],
        },
        matic: {
            url: polygonUrl,
            accounts: [deployer, eaService, pdsService],
        },
        optimism: {
            url: "https://mainnet.optimism.io",
            accounts: {
                mnemonic: mnemonic(),
            },
            companionNetworks: {
                l1: "mainnet",
            },
        },
        kovanOptimism: {
            url: "https://kovan.optimism.io",
            accounts: {
                mnemonic: mnemonic(),
            },
            companionNetworks: {
                l1: "kovan",
            },
        },
        localOptimism: {
            url: "http://localhost:8545",
            accounts: {
                mnemonic: mnemonic(),
            },
            companionNetworks: {
                l1: "localOptimismL1",
            },
        },
        localOptimismL1: {
            url: "http://localhost:9545",
            gasPrice: 0,
            accounts: {
                mnemonic: mnemonic(),
            },
            companionNetworks: {
                l2: "localOptimism",
            },
        },
        localAvalanche: {
            url: "http://localhost:9650/ext/bc/C/rpc",
            gasPrice: 225000000000,
            chainId: 43112,
            accounts: {
                mnemonic: mnemonic(),
            },
        },
        fujiAvalanche: {
            url: "https://api.avax-test.network/ext/bc/C/rpc",
            gasPrice: 225000000000,
            chainId: 43113,
            accounts: {
                mnemonic: mnemonic(),
            },
        },
        mainnetAvalanche: {
            url: "https://api.avax.network/ext/bc/C/rpc",
            gasPrice: 225000000000,
            chainId: 43114,
            accounts: {
                mnemonic: mnemonic(),
            },
        },
        testnetHarmony: {
            url: "https://api.s0.b.hmny.io",
            gasPrice: 1000000000,
            chainId: 1666700000,
            accounts: {
                mnemonic: mnemonic(),
            },
        },
        mainnetHarmony: {
            url: "https://api.harmony.one",
            gasPrice: 1000000000,
            chainId: 1666600000,
            accounts: {
                mnemonic: mnemonic(),
            },
        },
        moonbeam: {
            url: "https://rpc.api.moonbeam.network",
            chainId: 1284,
            accounts: {
                mnemonic: mnemonic(),
            },
        },
        moonriver: {
            url: "https://rpc.api.moonriver.moonbeam.network",
            chainId: 1285,
            accounts: {
                mnemonic: mnemonic(),
            },
        },
        moonbaseAlpha: {
            url: "https://rpc.api.moonbase.moonbeam.network",
            chainId: 1287,
            accounts: {
                mnemonic: mnemonic(),
            },
        },
        moonbeamDevNode: {
            url: "http://127.0.0.1:9933",
            chainId: 1281,
            accounts: {
                mnemonic: mnemonic(),
            },
        },
        godwoken: {
            url: "https://godwoken-testnet-v1.ckbapp.dev",
            chainId: 71401,
            accounts: {
                mnemonic: mnemonic(),
            },
        },
    },
    solidity: {
        compilers: [
            {
                version: "0.8.4",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
        ],
    },
    ovm: {
        solcVersion: "0.8.16",
    },
    namedAccounts: {
        deployer: {
            default: 0, // here this will by default take the first account as deployer
        },
    },

    etherscan: {
        apiKey: {
            goerli: process.env.ETHERSCAN_API_KEY || null,
            polygon: process.env.POLYGONSCAN_API_KEY || null,
            mainnet: process.env.ETHERSCAN_API_KEY || null,
        },
    },
    contractSizer: {
        alphaSort: true,
        disambiguatePaths: false,
        runOnCompile: true,
        strict: true,
    },
    abiExporter: {
        path: "./abi",
        runOnCompile: true,
        clear: true,
        flat: true,
        only: [],
        spacing: 2,
        pretty: false,
    },
};
