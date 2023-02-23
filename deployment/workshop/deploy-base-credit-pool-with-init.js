const {BigNumber: BN} = require("ethers");
const {deploy} = require("../utils.js");

async function deployContracts() {
    const network = (await hre.ethers.provider.getNetwork()).name;
    console.log("network : ", network);
    const [deployer, treasury, eaService,
    pdsService, ea] = await hre.ethers.getSigners();
    
    const usdc = await deploy("TestToken", "USDC");
    const evaluationAgentNFT = await deploy("EvaluationAgentNFT", "EANFT", [], eaService);
    
    const humaConfig = await deploy("HumaConfig", "HumaConfig");
    
    const feeManager = await deploy("BaseFeeManager", "BaseCreditPoolFeeManager");
    const hdt = await deploy("HDT", "BaseCreditHDT");
    const poolConfig = await deploy("BasePoolConfig", "BaseCreditPoolConfig");

    const pool = await deploy("BaseCreditPool", "BaseCreditPool");

    console.log("humaConfig initializing");
    await humaConfig.setHumaTreasury(treasury.address);
    await humaConfig.setTreasuryFee(500);
    await humaConfig.setEANFTContractAddress(evaluationAgentNFT.address);
    await humaConfig.setEAServiceAccount(eaService.address);
    await humaConfig.setPDSServiceAccount(pdsService.address);
    await humaConfig.setProtocolDefaultGracePeriod(30 * 24 * 3600);
    await humaConfig.setLiquidityAsset(usdc.address, true);
    console.log("humaConfig initialized");
    
    console.log("eaNFT initializing");
    await evaluationAgentNFT.connect(ea).mintNFT(ea.address);
    console.log("eaNFT initialized");

    console.log("feeManager initializing");
    await feeManager.setFees(10_000_000, 0, 20_000_000, 0, 5_000_000);
    console.log("feeManager initialized");

    console.log("HDT initializing");
    await hdt.initialize("Credit HDT", "CHDT", usdc.address);
    console.log("HDT initialized");

    console.log("Credit pool initializing");
    await poolConfig.initialize(
        "CreditLinePool", hdt.address, humaConfig.address, feeManager.address
        );
    
    const decimals = 6;
    console.log('pause')
    const cap = BN.from(1_000_000).mul(BN.from(10).pow(BN.from(decimals)));
    console.log("cap: " + cap);
    await poolConfig.setPoolLiquidityCap(cap);
    await poolConfig.setPool(pool.address);
    
    await poolConfig.setPoolOwnerRewardsAndLiquidity(500, 200);
    await poolConfig.setEARewardsAndLiquidity(1000, 100);
    
    await poolConfig.setEvaluationAgent(1, ea.address);

    const maxCL = BN.from(10_000).mul(BN.from(10).pow(BN.from(decimals)));
    console.log("maxCL: " + maxCL);
    await poolConfig.setMaxCreditLine(maxCL);
    await poolConfig.setAPR(1000);
    await poolConfig.setReceivableRequiredInBps(0);
    await poolConfig.setPoolPayPeriod(15);
    await poolConfig.setPoolToken(hdt.address);
    await poolConfig.setWithdrawalLockoutPeriod(0);
    await poolConfig.setPoolDefaultGracePeriod(60);
    await poolConfig.setPoolOwnerTreasury(treasury.address);
    await poolConfig.setCreditApprovalExpiration(5);

    await pool.initialize(poolConfig.address);
    console.log("Credit pool initialized");

    console.log("Enabling pool");
    await pool.addApprovedLender(ea.address);
    await pool.addApprovedLender(treasury.address);
    

    const amountOwner = BN.from(20_000).mul(BN.from(10).pow(BN.from(decimals)));
    await usdc.mint(treasury.address, amountOwner);
    await usdc.connect(treasury).approve(pool.address, amountOwner)
    await pool.connect(treasury).makeInitialDeposit(amountOwner);

    const amountEA = BN.from(10_000).mul(BN.from(10).pow(BN.from(decimals)));
    await usdc.mint(ea.address, amountEA);
    await usdc.connect(ea).approve(pool.address, amountEA);
    await pool.connect(ea).makeInitialDeposit(amountEA);
    await pool.enablePool();
    console.log("Pool is enabled");

}

deployContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
