/* eslint-disable no-underscore-dangle */
const {ethers} = require("hardhat");
const {use, expect} = require("chai");
const {solidity} = require("ethereum-waffle");

use(solidity);

describe("Huma Config", function () {
    let configContract;
    let origOwner, pauser, poolAdmin, treasury, newOwner, newTreasury, randomUser;

    before(async function () {
        [origOwner, pauser, poolAdmin, treasury, newOwner, newTreasury, randomUser] =
            await ethers.getSigners();

        const HumaConfig = await ethers.getContractFactory("HumaConfig");
        configContract = await HumaConfig.deploy(treasury.address);
    });

    describe("Initial Value", function () {
        it("Should have the right initial owner", async function () {
            expect(await configContract.owner()).to.equal(origOwner.address);
        });

        it("Should have the right initial treasury", async function () {
            expect(await configContract.humaTreasury()).to.equal(treasury.address);
        });

        it("Should have the right treasury fee", async function () {
            expect(await configContract.protocolFee()).to.equal(1000);
        });

        it("Should have the right protocol default grace period", async function () {
            expect(await configContract.protocolDefaultGracePeriod()).to.equal(5 * 3600 * 24);
        });

        it("Should have set owner as a pauser", async function () {
            expect(await configContract.isPauser(origOwner.address)).to.equal(true);
        });

        it("Should have set owner as a pool admin", async function () {
            expect(await configContract.isPoolAdmin(origOwner.address)).to.equal(true);
        });
    });

    describe("Update owner", function () {
        it("Should disallow non-owner to change ownership", async function () {
            await expect(
                configContract.connect(newOwner).transferOwnership(newOwner.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should reject 0 address to be the new owner", async function () {
            await expect(
                configContract.connect(origOwner).transferOwnership(ethers.constants.AddressZero)
            ).to.be.revertedWith("Ownable: new owner is the zero address");
        });

        it("Should be able to transfer ownership to new owner", async function () {
            await configContract.connect(origOwner).transferOwnership(newOwner.address);
            expect(await configContract.owner()).to.equal(newOwner.address);

            // change back to orgOwner to continue the testing flow.
            await configContract.connect(newOwner).transferOwnership(origOwner.address);
            expect(await configContract.owner()).to.equal(origOwner.address);
        });
    });

    describe("Update Huma Treasury Address", function () {
        it("Should disallow non-owner to change huma treasury", async function () {
            await expect(
                configContract.connect(randomUser).setHumaTreasury(treasury.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should disallow non-owner to change huma treasury", async function () {
            await expect(
                configContract.connect(origOwner).setHumaTreasury(ethers.constants.AddressZero)
            ).to.be.revertedWith("TREASURY_ADDRESS_ZERO");
        });

        it("Should not change treasury if try to set it to the current treasury", async function () {
            await expect(
                configContract.connect(origOwner).setHumaTreasury(treasury.address)
            ).not.emit(configContract, "HumaTreasuryChanged");
        });

        it("Should allow treasury to be changed", async function () {
            expect(await configContract.connect(origOwner).setHumaTreasury(newTreasury.address))
                .to.emit(configContract, "HumaTreasuryChanged")
                .withArgs(newTreasury.address);
            expect(await configContract.connect(origOwner).humaTreasury()).to.equal(
                newTreasury.address
            );
        });
    });

    describe("Add and Remove Pausers", function () {
        it("Should disallow non-owner to add pausers", async function () {
            await expect(
                configContract.connect(randomUser).addPauser(pauser.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should reject 0 address pauser", async function () {
            await expect(
                configContract.connect(origOwner).addPauser(ethers.constants.AddressZero)
            ).to.be.revertedWith("PAUSER_ADDRESS_ZERO");
        });

        it("Should allow pauser to be added", async function () {
            expect(await configContract.connect(origOwner).addPauser(pauser.address))
                .to.emit(configContract, "PauserAdded")
                .withArgs(pauser.address, origOwner.address);

            expect(await configContract.connect(origOwner).isPauser(pauser.address)).to.equal(
                true
            );
        });

        it("Should reject add-pauser request if it is already a pauser", async function () {
            await expect(
                configContract.connect(origOwner).addPauser(pauser.address)
            ).to.be.revertedWith("ALREADY_A_PAUSER");
        });

        it("Should disallow non-owner to remove a pauser", async function () {
            await expect(
                configContract.connect(randomUser).removePauser(pauser.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");

            await expect(
                configContract.connect(pauser).removePauser(pauser.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should disallow removal of pauser using zero address", async function () {
            await expect(
                configContract.connect(origOwner).removePauser(ethers.constants.AddressZero)
            ).to.be.revertedWith("PAUSER_ADDRESS_ZERO");
        });

        it("Should reject attemp to removal a pauser who is not a pauser", async function () {
            await expect(
                configContract.connect(origOwner).removePauser(treasury.address)
            ).to.be.revertedWith("NOT_A_PAUSER");
        });

        it("Should remove a pauser successfully", async function () {
            await expect(configContract.connect(origOwner).removePauser(pauser.address))
                .to.emit(configContract, "PauserRemoved")
                .withArgs(pauser.address, origOwner.address);

            expect(await configContract.connect(origOwner).isPauser(pauser.address)).to.equal(
                false
            );
        });

        it("Should allow removed pauser to be added back", async function () {
            expect(await configContract.connect(origOwner).addPauser(pauser.address))
                .to.emit(configContract, "PauserAdded")
                .withArgs(pauser.address, origOwner.address);

            expect(await configContract.connect(origOwner).isPauser(pauser.address)).to.equal(
                true
            );
        });
    });

    describe("Pause and Unpause Protocol", function () {
        it("Should disallow non-pauser to pause the protocol", async function () {
            await expect(configContract.connect(randomUser).pauseProtocol()).to.be.revertedWith(
                "PAUSERS_REQUIRED"
            );
            await expect(configContract.connect(treasury).pauseProtocol()).to.be.revertedWith(
                "PAUSERS_REQUIRED"
            );
        });

        it("Should be able to pause the protocol", async function () {
            await expect(configContract.connect(pauser).pauseProtocol())
                .to.emit(configContract, "ProtocolPaused")
                .withArgs(pauser.address);
            expect(await configContract.isProtocolPaused()).to.equal(true);
        });

        it("Should allow owner to pause", async function () {
            await expect(configContract.connect(origOwner).pauseProtocol())
                .to.emit(configContract, "ProtocolPaused")
                .withArgs(origOwner.address);
            expect(await configContract.isProtocolPaused()).to.equal(true);
        });

        it("Should disallow non-owner to unpause", async function () {
            await expect(configContract.connect(pauser).unpauseProtocol()).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );
        });

        it("Should allow owner to unpause", async function () {
            expect(await configContract.connect(origOwner).unpauseProtocol())
                .to.emit(configContract, "ProtocolUnpaused")
                .withArgs(origOwner.address);

            expect(await configContract.isProtocolPaused()).to.equal(false);
        });
    });

    describe("Add and Remove Pool Admins", function () {
        it("Should disallow non-owner to add pool admins", async function () {
            await expect(
                configContract.connect(randomUser).addPoolAdmin(poolAdmin.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should reject 0 address pool admin", async function () {
            await expect(
                configContract.connect(origOwner).addPoolAdmin(ethers.constants.AddressZero)
            ).to.be.revertedWith("POOL_ADMIN_ADDRESS_ZERO");
        });

        it("Should allow pool admin to be added", async function () {
            expect(await configContract.connect(origOwner).addPoolAdmin(poolAdmin.address))
                .to.emit(configContract, "PoolAdminAdded")
                .withArgs(poolAdmin.address, origOwner.address);

            expect(
                await configContract.connect(origOwner).isPoolAdmin(poolAdmin.address)
            ).to.equal(true);
        });

        it("Should reject add-pool-admin request if it is already a pool admin", async function () {
            await expect(
                configContract.connect(origOwner).addPoolAdmin(poolAdmin.address)
            ).to.be.revertedWith("ALREADY_A_POOL_ADMIN");
        });

        it("Should disallow non-owner to remove a pool admin", async function () {
            await expect(
                configContract.connect(randomUser).removePoolAdmin(poolAdmin.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");

            await expect(
                configContract.connect(poolAdmin).removePoolAdmin(poolAdmin.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should disallow removal of pool admin using zero address", async function () {
            await expect(
                configContract.connect(origOwner).removePoolAdmin(ethers.constants.AddressZero)
            ).to.be.revertedWith("POOL_ADMIN_ADDRESS_ZERO");
        });

        it("Should reject attempt to remove a pool admin who is not a pool admin", async function () {
            await expect(
                configContract.connect(origOwner).removePoolAdmin(treasury.address)
            ).to.be.revertedWith("NOT_A_POOL_ADMIN");
        });

        it("Should remove a pool admin successfully", async function () {
            await expect(configContract.connect(origOwner).removePoolAdmin(poolAdmin.address))
                .to.emit(configContract, "PoolAdminRemoved")
                .withArgs(poolAdmin.address, origOwner.address);

            expect(
                await configContract.connect(origOwner).isPoolAdmin(poolAdmin.address)
            ).to.equal(false);
        });

        it("Should allow removed pool admin to be added back", async function () {
            expect(await configContract.connect(origOwner).addPoolAdmin(poolAdmin.address))
                .to.emit(configContract, "PoolAdminAdded")
                .withArgs(poolAdmin.address, origOwner.address);

            expect(
                await configContract.connect(origOwner).isPoolAdmin(poolAdmin.address)
            ).to.equal(true);
        });
    });

    // Test suites for changing protocol grace period
    describe("Change Protocol Grace Period", function () {
        it("Should disallow non-owner to change protocol grace period", async function () {
            await expect(
                configContract.connect(randomUser).setProtocolDefaultGracePeriod(10 * 24 * 3600)
            ).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(
                configContract.connect(pauser).setProtocolDefaultGracePeriod(10 * 24 * 3600)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should disallow default grace period to be shorten than one day", async function () {
            await expect(
                configContract.connect(origOwner).setProtocolDefaultGracePeriod(12 * 3600)
            ).to.be.revertedWith("GRACE_PERIOD_TOO_SHORT");
            await expect(
                configContract.connect(origOwner).setProtocolDefaultGracePeriod(0)
            ).to.be.revertedWith("GRACE_PERIOD_TOO_SHORT");
        });

        it("Should be able to reset default grace period", async function () {
            await expect(
                configContract.connect(origOwner).setProtocolDefaultGracePeriod(10 * 24 * 3600)
            )
                .to.emit(configContract, "ProtocolDefaultGracePeriodChanged")
                .withArgs(10 * 24 * 3600);
            expect(await configContract.protocolDefaultGracePeriod()).to.equal(10 * 24 * 3600);
        });
    });

    // Test suites for changing treasury fee
    describe("Change Treasury Fee", function () {
        it("Should disallow non-owner to change treasury fee", async function () {
            await expect(
                configContract.connect(randomUser).setTreasuryFee(200)
            ).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(configContract.connect(treasury).setTreasuryFee(200)).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );
        });

        it("Should disallow treasury fee to be higher than 5000 bps, i.e. 50%", async function () {
            await expect(
                configContract.connect(origOwner).setTreasuryFee(6000)
            ).to.be.revertedWith("TREASURY_FEE_TOO_HIGH");
        });

        it("Should be able to change treasury fee", async function () {
            await expect(configContract.connect(origOwner).setTreasuryFee(2000))
                .to.emit(configContract, "TreasuryFeeChanged")
                .withArgs(1000, 2000);
            expect(await configContract.protocolFee()).to.equal(2000);
        });
    });

    // Test suites for valid liquidity assets
    // TODO Figure out how to pass legit address and re-enable this test.
    // describe("Change Liquidity Assets", function () {
    //   it("Should disallow non-proto-admin to change liquidity asset", async function () {
    //     await expect(configContract.connect(origOwner).setLiquidityAsset(0x1, false)).to.be.revertedWith('PROTO_ADMIN_REQUIRED');
    //     await expect(configContract.connect(treasury).setLiquidityAsset(0x1, false)).to.be.revertedWith('PROTO_ADMIN_REQUIRED');
    //   });

    //   it("Should be able to add valid liquidity assets", async function () {
    //     await expect(configContract.connect(newAdmin).setLiquidityAsset(0x1, true)).to.emit(configContract, 'TreasuryFeeChanged').withArgs(0x1, true);
    //     expect(await configContract.isAssetValid('0x1')).to.equal(true);
    //   });
    // });

    // it("Should be able to remove valid liquidity assets", async function () {
    //   await expect(configContract.connect(newAdmin).setLiquidityAsset(0x1, false)).to.emit(configContract, 'TreasuryFeeChanged').withArgs(0x1, false);
    //   expect(await configContract.isAssetValid('0x1')).to.equal(false);
    // });
});
