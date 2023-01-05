<p align="center">
  <a href="https://huma.finance"><img src="https://user-images.githubusercontent.com/5999398/210867640-95c8944c-fcd0-4199-9f08-b0ae6eda70c0.jpg" alt="Huma Finance" width="500px"></a>
</p>

<h1 align="center">Welcome to Huma Finance EVM contracts</h1>
<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-1.0.0-blue.svg?cacheSeconds=2592000" />
  <a href="https://docs.huma.finance" target="_blank">
    <img alt="Documentation" src="https://img.shields.io/badge/documentation-yes-brightgreen.svg" />
  </a>
  <a href="https://www.gnu.org/licenses/agpl-3.0.en.html" target="_blank">
    <img alt="License: AGPL v3" src="https://img.shields.io/badge/License-AGPL v3-yellow.svg" />
  </a>
  <a href="https://twitter.com/humafinance" target="_blank">
    <img alt="Twitter: humafinance" src="https://img.shields.io/twitter/follow/humafinance.svg?style=social" />
  </a>
  <a href="https://discord.gg/7e2fdMSCZr" target="_blank">
    <img alt="Join Discord" src="https://badgen.net/badge/Join/HUMAnity/cyan?icon=discord" />
  </a>
</p>

> Huma Finance EVM contracts

### 🏠 [Homepage](https://huma.finance)

### ✨ [Demo](https://app.huma.finance)

## Setup development environment

Prerequisites: You need node.js v16+ and yarn installed.

### Checkout this repository

```sh
git clone https://github.com/00labs/huma-contracts
cd huma-contracts
```

### Install the dependencies

```sh
yarn install
```

### Compile and run tests

```sh
yarn compile
yarn test
```

### Other useful commands

To lint

```
yarn lint-solidity
```

## Deploy on Goerli testnet

Put `DEPLOYER`, `GOERLI_URL` and `PROXY_OWNER` in `.env`.

```sh
yarn hardhat run --network goerli deployment/deploy-goerli.js
yarn hardhat run --network goerli deployment/init-goerli.js
```

Deployed contract addresses are in `deployment/goerli-deployed-contracts.json`.

### Upgrade on goerli

Put `DEPLOYER`, `GOERLI_URL` and `PROXY_OWNER` in `.env`.

```sh
yarn hardhat run --network goerli deployment/upgrade-goerli-receivable-factoring-pool.js
yarn hardhat run --network goerli deployment/run-goerli.js
```

### Verify contracts on etherscan

```sh
yarn hardhat run --network goerli deployment/verify-goerli-receivable-factoring-pool.js
```

## Author

- Twitter: [@humafinance](https://twitter.com/humafinance)

## 🤝 Contributing

Contributions, issues and feature requests are welcome!<br />Feel free to check [issues page](https://github.com/00labs/huma-contracts/issues).

## Show your support

Give a ⭐️ if this project helped you!

## 📝 License

This project is [AGPL v3](https://www.gnu.org/licenses/agpl-3.0.en.html) licensed.

---

_This README was generated with ❤️ by [readme-md-generator](https://github.com/kefranabg/readme-md-generator)_
