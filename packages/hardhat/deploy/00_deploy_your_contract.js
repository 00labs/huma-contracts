// deploy/00_deploy_your_contract.js

const { ethers } = require("hardhat");

// const localChainId = "31337";

// const sleep = (ms) =>
//   new Promise((r) =>
//     setTimeout(() => {
//       console.log(`waited for ${(ms / 1000).toFixed(3)} seconds`);
//       r();
//     }, ms)
//   );

module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  // const chainId = await getChainId();
  const [_deployer, treasury] = await ethers.getSigners();

  const decimalToExpandedString = function(value, decimals) {
    return Number(value * 10 ** decimals).toLocaleString("fullwide", {
      useGrouping: false
    });
  };

  await deploy("TestToken", {
    from: deployer,
    log: true,
    waitConfirmations: 5
  });
  const TestToken = await ethers.getContract("TestToken", deployer);
  const poolTokenDecimals = await TestToken.decimals();

  await deploy("HumaConfig", {
    from: deployer,
    log: true,
    args: [treasury.address],
    waitConfirmations: 5
  });
  const HumaConfig = await ethers.getContract("HumaConfig", deployer);
  await HumaConfig.setLiquidityAsset(TestToken.address, true);
  await HumaConfig.setHumaTreasury(treasury.address);

  await deploy("BaseFeeManager", {
    from: deployer,
    log: true,
    args: [],
    waitConfirmations: 5
  });
  const BaseFeeManager = await ethers.getContract("BaseFeeManager", deployer);
  await BaseFeeManager.setFees(
    decimalToExpandedString(10, poolTokenDecimals),
    100,
    decimalToExpandedString(20, poolTokenDecimals),
    100,
    decimalToExpandedString(30, poolTokenDecimals),
    100
  );

  await deploy("PoolLockerFactory", {
    from: deployer,
    log: true,
    waitConfirmations: 5
  });
  const PoolLockerFactory = await ethers.getContract(
    "PoolLockerFactory",
    deployer
  );

  await deploy("HumaInvoiceFactoring", {
    from: deployer,
    log: true,
    args: [
      TestToken.address,
      HumaConfig.address,
      PoolLockerFactory.address,
      BaseFeeManager.address,
      "Huma Invoice Factory Pool",
      "HumaIF HDT",
      "HHDT"
    ],
    waitConfirmations: 5
  });

  const HumaInvoiceFactoring = await ethers.getContract(
    "HumaInvoiceFactoring",
    deployer
  );

  await HumaInvoiceFactoring.enablePool();
  await HumaInvoiceFactoring.addEvaluationAgent(
    process.env.INITIAL_HUMA_CREDIT_APPROVER
  );
  const maxBorrowAmount = decimalToExpandedString(10000, poolTokenDecimals);
  await HumaInvoiceFactoring.setMinMaxBorrowAmount(10, maxBorrowAmount);

  await deploy("InvoiceNFT", {
    from: deployer,
    log: true,
    waitConfirmations: 5
  });

  await TestToken.give100000To(deployer);

  await TestToken.approve(
    HumaInvoiceFactoring.address,
    decimalToExpandedString(100000, poolTokenDecimals)
  );

  await HumaInvoiceFactoring.makeInitialDeposit(
    decimalToExpandedString(100000, poolTokenDecimals)
  );

  ////////////////////////////////////////////
  // Getting a previously deployed contract
  // const TestToken = await ethers.getContract("TestToken", deployer);
  /*  await YourContract.setPurpose("Hello");
  
    To take ownership of yourContract using the ownable library uncomment next line and add the 
    address you want to be the owner. 
    // await yourContract.transferOwnership(YOUR_ADDRESS_HERE);

    //const yourContract = await ethers.getContractAt('YourContract', "0xaAC799eC2d00C013f1F11c37E654e59B0429DF6A") //<-- if you want to instantiate a version of a contract at a specific address!
  */

  /*
  //If you want to send value to an address from the deployer
  const deployerWallet = ethers.provider.getSigner()
  await deployerWallet.sendTransaction({
    to: "0x34aA3F359A9D614239015126635CE7732c18fDF3",
    value: ethers.utils.parseEther("0.001")
  })
  */

  /*
  //If you want to send some ETH to a contract on deploy (make your constructor payable!)
  const yourContract = await deploy("YourContract", [], {
  value: ethers.utils.parseEther("0.05")
  });
  */

  /*
  //If you want to link a library into your contract:
  // reference: https://github.com/austintgriffith/scaffold-eth/blob/using-libraries-example/packages/hardhat/scripts/deploy.js#L19
  // const yourContract = await deploy("YourContract", [], {}, {
  //  LibraryName: **LibraryAddress**
  // });
  */

  // Verify from the command line by running `yarn verify`

  // You can also Verify your contracts with Etherscan here...
  // You don't want to verify on localhost
  // try {
  //   if (chainId !== localChainId) {
  //     await run("verify:verify", {
  //       address: YourContract.address,
  //       contract: "contracts/YourContract.sol:YourContract",
  //       constructorArguments: [],
  //     });
  //   }
  // } catch (error) {
  //   console.error(error);
  // }
};
module.exports.tags = ["YourContract"];
