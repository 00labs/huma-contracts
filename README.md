# Welcome to Huma Finance EVM contracts
## Setup development environment

Prerequisites: You need node.js v16+ and yarn installed.

### Checkout this repository
```
git clone https://github.com/00labs/huma-contracts
cd huma-contracts
```

### Install the dependencies
```
yarn install
```

### Compile and test
```
yarn compile
yarn test
```
### Other useful commands

To lint
```
yarn lint-solidity
```

## Deploy and initiate on goerli
Put `DEPLOYER`, `GOERLI_URL` and `PROXY_OWNER` in `.env`.
```
yarn hardhat run --network goerli deployment/deploy-goerli.js
yarn hardhat run --network goerli deployment/init-goerli.js
```
Deployed contract addresses are in `deployment/goerli-deployed-contracts.json`. 

### Upgrade on goerli
Put `DEPLOYER`, `GOERLI_URL` and `PROXY_OWNER` in `.env`.
```
yarn hardhat run --network goerli deployment/upgrade-goerli-receivable-factoring-pool.js
yarn hardhat run --network goerli deployment/run-goerli.js
```

### Verify contracts on etherscan
```
yarn hardhat run --network goerli deployment/verify-goerli-receivable-factoring-pool.js
```
