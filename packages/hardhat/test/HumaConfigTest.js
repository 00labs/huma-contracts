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
        [origOwner, origAdmin, treasury, newOwner, newAdmin] =
            await ethers.getSigners();

        const HumaConfig = await ethers.getContractFactory("HumaConfig");
        configContract = await HumaConfig.deploy(
            origOwner.address,
            origAdmin.address
        );
    });

    describe("Initial Value", function () {
        it("Should have the right initial governor", async function () {
            expect(await configContract.getGovernor()).to.equal(
                origOwner.address
            );
        });

        it("Should have the right initial proto admin", async function () {
            expect(await configContract.getProtoAdmin()).to.equal(
                origAdmin.address
            );
        });

        it("Should have the right default treasury fee", async function () {
            expect(await configContract.getTreasuryFee()).to.equal(50);
        });

        it("Should have the right protocol default grace period", async function () {
            expect(
                await configContract.getProtocolDefaultGracePeriod()
            ).to.equal(5 * 3600 * 24);
        });

        it("Should have the right initial Huma Treasury", async function () {
            expect(await configContract.getHumaTreasury()).to.equal(
                origOwner.address
            );
        });
    });

    describe("Update Governor", function () {
        it("Should disallow non-governor to nominate new governor", async function () {
            await expect(
                configContract
                    .connect(newOwner)
                    .nominateNewGovernor(newOwner.address)
            ).to.be.revertedWith("HumaConfig:GOVERNOR_REQUIRED");
        });

        it("Should require nominee to be different from the governor", async function () {
            await expect(
                configContract
                    .connect(origOwner)
                    .nominateNewGovernor(origOwner.address)
            ).to.be.revertedWith("HumaConfig:NOMINEE_CANNOT_BE_GOVERNOR");
        });

        it("Should be able to nominate new governor", async function () {
            await configContract
                .connect(origOwner)
                .nominateNewGovernor(newOwner.address);
            expect(await configContract.getGovernor()).to.equal(
                origOwner.address
            );
            expect(await configContract.getGovernor()).to.not.equal(
                newOwner.address
            );
        });

        it("Should disallow anyone other than the nominee to accept governor role", async function () {
            await expect(
                configContract.connect(origOwner).acceptGovernor()
            ).to.be.revertedWith("HumaConfig:GOVERNOR_NOMINEE_NEEDED");
            await expect(
                configContract.connect(origAdmin).acceptGovernor()
            ).to.be.revertedWith("HumaConfig:GOVERNOR_NOMINEE_NEEDED");
            await expect(
                configContract.connect(treasury).acceptGovernor()
            ).to.be.revertedWith("HumaConfig:GOVERNOR_NOMINEE_NEEDED");
        });

        it("Should allow the nominee to accept governor role", async function () {
            await configContract.connect(newOwner).acceptGovernor();
            expect(await configContract.getGovernor()).to.equal(
                newOwner.address
            );
            expect(await configContract.getGovernor()).to.not.equal(
                origOwner.address
            );
        });
    });

    /// From on, governor === newOwner. Intentionally not to reset governor to be the original
    /// governor in case setGovernor() was a false success.
    describe("Update Huma Treasury Address", function () {
        it("Should disallow non-governor to change huma treasury", async function () {
            await expect(
                configContract
                    .connect(origOwner)
                    .setHumaTreasury(treasury.address)
            ).to.be.revertedWith("HumaConfig:GOVERNOR_REQUIRED");
            await expect(
                configContract
                    .connect(origAdmin)
                    .setHumaTreasury(treasury.address)
            ).to.be.revertedWith("HumaConfig:GOVERNOR_REQUIRED");
        });

        // The default treasury was the old governor, origOwner.
        it("Should require treasury address to be new and non-zero", async function () {
            // todo Figure out how to represent address(0) and uncomment the next line.
            //await expect(configContract.connect(newOwner).setHumaTreasury(constants.AddressZero)).to.be.revertedWith('HumaConfig:TREASURY_ADDRESS_ZERO');
            await expect(
                configContract
                    .connect(newOwner)
                    .setHumaTreasury(origOwner.address)
            ).to.be.revertedWith("HumaConfig:TREASURY_ADDRESS_UNCHANGED");
        });

        it("Should allow treasury address to be updated by governor", async function () {
            await expect(
                configContract
                    .connect(newOwner)
                    .setHumaTreasury(treasury.address)
            )
                .to.emit(configContract, "HumaTreasuryChanged")
                .withArgs(treasury.address);
            expect(await configContract.getHumaTreasury()).to.equal(
                treasury.address
            );
            expect(await configContract.getHumaTreasury()).to.not.equal(
                origOwner.address
            );
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

    /// By now, newOwner and newAdmin are the governor and protoAdmin.
    // Test suite for pause and unpause the entire protocol
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
