/* eslint-disable no-underscore-dangle */
const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

use(solidity);

describe("Huma Config", function () {
    let configContract;
    let origOwner;
    let origAdmin;
    let treasury;

    before(async function () {
        [
            origOwner,
            pauser,
            poolAdmin,
            treasury,
            newOwner,
            newTreasury,
            randomUser,
        ] = await ethers.getSigners();

        const HumaConfig = await ethers.getContractFactory("HumaConfig");
        configContract = await HumaConfig.deploy(treasury.address);
    });

    describe("Initial Value", function () {
        it("Should have the right initial owner", async function () {
            expect(await configContract.owner()).to.equal(origOwner.address);
        });

        it("Should have the right initial treasury", async function () {
            expect(await configContract.getHumaTreasury()).to.equal(
                treasury.address
            );
        });

        it("Should have the right treasury fee", async function () {
            expect(await configContract.getTreasuryFee()).to.equal(50);
        });

        it("Should have the right protocol default grace period", async function () {
            expect(
                await configContract.getProtocolDefaultGracePeriod()
            ).to.equal(5 * 3600 * 24);
        });
    });

    describe("Update owner", function () {
        it("Should disallow non-owner to change ownership", async function () {
            await expect(
                configContract
                    .connect(newOwner)
                    .transferOwnership(newOwner.address)
            ).to.be.revertedWith("HumaConfig:NOT_OWNER");
        });

        it("Should reject 0 address to be the new owner", async function () {
            await expect(
                configContract.connect(origOwner).transferOwnership(address(0))
            ).to.be.revertedWith("Ownable: new owner is the zero address");
        });

        it("Should be able to transfer ownership to new owner", async function () {
            await configContract
                .connect(origOwner)
                .transferOwnership(newOwner.address);
            expect(await configContract.owner()).to.equal(newOwner.address);

            // change back to orgOwner to continue the testing flow.
            await configContract
                .connect(newOwner)
                .transferOwnership(origOwner.address);
            expect(await configContract.owner()).to.equal(origOwner.address);
        });
    });

    describe("Update Huma Treasury Address", function () {
        it("Should disallow non-owner to change huma treasury", async function () {
            await expect(
                configContract
                    .connect(randomUser)
                    .setHumaTreasury(treasury.address)
            ).to.be.revertedWith("HumaConfig:NOT_OWNER");
        });

        it("Should disallow non-owner to change huma treasury", async function () {
            await expect(
                configContract.connect(origOwner).setHumaTreasury(address(0))
            ).to.be.revertedWith("HumaConfig:TREASURY_ADDRESS_ZERO");
        });

        it("Should reject treasury change to the current treasury", async function () {
            await expect(
                configContract
                    .connect(origAdmin)
                    .setHumaTreasury(treasury.address)
            ).to.be.revertedWith("HumaConfig:TREASURY_ADDRESS_UNCHANGED");
        });

        it("Should allow treasury to be changed", async function () {
            await configContract
                .connect(origAdmin)
                .setHumaTreasury(newTreasury.address);

            await expect(
                configContract
                    .connect(origAdmin)
                    .getHumaTreasury(newTreasury.address)
            ).to.equal(newTreasury.address);
        });
    });

    describe("Update Protocol Admin", function () {
        it("Should disallow non-governor to change protocol admin", async function () {
            await expect(
                configContract.connect(newAdmin).setProtoAdmin(newAdmin.address)
            ).to.be.revertedWith("HumaConfig:GOVERNOR_REQUIRED");
            await expect(
                configContract
                    .connect(origAdmin)
                    .setProtoAdmin(newAdmin.address)
            ).to.be.revertedWith("HumaConfig:GOVERNOR_REQUIRED");
        });

        it("Should require protocol admin address to be new and non-zero", async function () {
            // todo Figure out how to represent address(0) and uncomment the next line.
            //await expect(configContract.connect(newOwner).setProtoAdmin(constants.AddressZero)).to.be.revertedWith('HumaConfig:ADMIN_ADDRESS_ZERO');
            await expect(
                configContract
                    .connect(newOwner)
                    .setProtoAdmin(origAdmin.address)
            ).to.be.revertedWith("HumaConfig:PROTOADMIN_ADDRESS_UNCHANGED");
        });

        it("Should allow protol admin address to be updated by governor", async function () {
            await expect(
                configContract.connect(newOwner).setProtoAdmin(newAdmin.address)
            )
                .to.emit(configContract, "ProtoAdminSet")
                .withArgs(newAdmin.address);
            expect(await configContract.getProtoAdmin()).to.equal(
                newAdmin.address
            );
            expect(await configContract.getProtoAdmin()).to.not.equal(
                origAdmin.address
            );
        });
    });

    describe("Pause Protocol", function () {
        it("Should disallow non-proto-admin to pause the protocol", async function () {
            await expect(
                configContract.connect(origAdmin).setProtocolPaused(true)
            ).to.be.revertedWith("HumaConfig:PROTO_ADMIN_REQUIRED");
            await expect(
                configContract
                    .connect(treasury)
                    .setProtocolPaused(newAdmin.address)
            ).to.be.revertedWith("HumaConfig:PROTO_ADMIN_REQUIRED");
        });

        it("Should be able to pause the protol", async function () {
            await expect(
                configContract.connect(newAdmin).setProtocolPaused(true)
            )
                .to.emit(configContract, "ProtocolPausedChanged")
                .withArgs(true);
            expect(await configContract.isProtocolPaused()).to.equal(true);
        });

        it("Should be able to unpause the protol", async function () {
            await expect(
                configContract.connect(newAdmin).setProtocolPaused(false)
            )
                .to.emit(configContract, "ProtocolPausedChanged")
                .withArgs(false);
            expect(await configContract.isProtocolPaused()).to.equal(false);
        });
    });

    // Test suites for changing default grace period
    describe("Change Default Grace Period", function () {
        it("Should disallow non-proto-admin to change default grace period", async function () {
            await expect(
                configContract
                    .connect(origAdmin)
                    .setProtocolDefaultGracePeriod(10 * 24 * 3600)
            ).to.be.revertedWith("HumaConfig:PROTO_ADMIN_REQUIRED");
            await expect(
                configContract
                    .connect(treasury)
                    .setProtocolDefaultGracePeriod(10 * 24 * 3600)
            ).to.be.revertedWith("HumaConfig:PROTO_ADMIN_REQUIRED");
        });

        it("Should disallow default grace period to be shorten than one day", async function () {
            await expect(
                configContract
                    .connect(newAdmin)
                    .setProtocolDefaultGracePeriod(12 * 3600)
            ).to.be.revertedWith("HumaConfig:GRACE_PERIOD_TOO_SHORT");
            await expect(
                configContract
                    .connect(newAdmin)
                    .setProtocolDefaultGracePeriod(0)
            ).to.be.revertedWith("HumaConfig:GRACE_PERIOD_TOO_SHORT");
        });

        it("Should be able to reset default grace period to be longer than 1 day", async function () {
            await expect(
                configContract
                    .connect(newAdmin)
                    .setProtocolDefaultGracePeriod(10 * 24 * 3600)
            )
                .to.emit(configContract, "ProtocolDefaultGracePeriodChanged")
                .withArgs(10 * 24 * 3600);
            expect(
                await configContract.getProtocolDefaultGracePeriod()
            ).to.equal(10 * 24 * 3600);
        });
    });

    // Test suites for changing treasury fee
    describe("Change Treasury Fee", function () {
        it("Should disallow non-proto-admin to change treasury fee", async function () {
            await expect(
                configContract.connect(origAdmin).setTreasuryFee(200)
            ).to.be.revertedWith("HumaConfig:PROTO_ADMIN_REQUIRED");
            await expect(
                configContract.connect(treasury).setTreasuryFee(200)
            ).to.be.revertedWith("HumaConfig:PROTO_ADMIN_REQUIRED");
        });

        it("Should disallow treasury fee to be higher than 5000 bps, i.e. 50%", async function () {
            await expect(
                configContract.connect(newAdmin).setTreasuryFee(6000)
            ).to.be.revertedWith("HumaConfig:TREASURY_FEE_TOO_HIGH");
        });

        it("Should be able to change treasury fee to be less than or equal to 5000 bps", async function () {
            await expect(configContract.connect(newAdmin).setTreasuryFee(2000))
                .to.emit(configContract, "TreasuryFeeChanged")
                .withArgs(2000);
            expect(await configContract.getTreasuryFee()).to.equal(2000);
        });
    });

    // Test suites for valid liquidity assets
    // TODO Figure out how to pass legit address and re-enable this test.
    // describe("Change Liquidity Assets", function () {
    //   it("Should disallow non-proto-admin to change liquidity asset", async function () {
    //     await expect(configContract.connect(origAdmin).setLiquidityAsset(0x1, false)).to.be.revertedWith('HumaConfig:PROTO_ADMIN_REQUIRED');
    //     await expect(configContract.connect(treasury).setLiquidityAsset(0x1, false)).to.be.revertedWith('HumaConfig:PROTO_ADMIN_REQUIRED');
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
