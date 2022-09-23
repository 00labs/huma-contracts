## Huma contract repo
To run
```
yarn install
yarn compile
yarn test
```

To lint
```
yarn lint-solidity
```

### Deploy and initiate on goerli
Put `DEPLOYER`, `GOERLI_URL` and `PROXY_OWNER` in `.env`.
```
yarn hardhat run --network goerli deployment/deploy-goerli.js
yarn hardhat run --network goerli deployment/init-goerli.js
```
Deployed contract addresses are in `deployment/goerli-deployed-contracts.json`. 

### Upgrade on goerli
Put `DEPLOYER`, `GOERLI_URL` and `PROXY_OWNER` in `.env`.
```
yarn hardhat run --network goerli deployment/upgrade-goerli.js
yarn hardhat run --network goerli deployment/run-goerli.js
```
