/* eslint-disable no-underscore-dangle */
const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");

use(solidity);

// Let us limit the depth of describe to be 2.
describe("Huma Reputation Tracking", function () {
    let reputationTrackerFactoryContract;
    let reputationTrackerContract;
    let reputationTrackingTokenContract;
    let poolOwner;
    let tracker;
    let borrower1;
    let borrower2;
    let borrower3;

    before(async function () {
        [poolOwner, tracker, borrower1, borrower2, borrower3] =
            await ethers.getSigners();

        const ReputationTrackerFactory = await ethers.getContractFactory(
            "ReputationTrackerFactory"
        );
        reputationTrackerFactoryContract =
            await ReputationTrackerFactory.deploy();

        const tx =
            await reputationTrackerFactoryContract.deployReputationTracker(
                "Huma Test",
                "Huma-Test"
            );
        const receipt = await tx.wait();
        let trackerAddress;
        // eslint-disable-next-line no-restricted-syntax
        for (const evt of receipt.events) {
            if (evt.event === "ReputationTrackerDeployed") {
                trackerAddress = evt.args[0];
            }
        }

        reputationTrackerContract = await ethers.getContractAt(
            "ReputationTracker",
            trackerAddress,
            poolOwner
        );
    });

    beforeEach(async function () {});

    describe("Reporting Service", async function () {
        it("Should not allow payoff reporting when there is no borrowing", async function () {
            await expect(
                reputationTrackerContract.report(borrower1.address, 1)
            ).to.be.revertedWith("ReputationTracker:NO_OUTSTANDING_BORROWING");
        });

        it("Should not allow default reporting when there is no borrowing", async function () {
            await expect(
                reputationTrackerContract.report(borrower1.address, 2)
            ).to.be.revertedWith("ReputationTracker:NO_OUTSTANDING_BORROWING");
        });

        it("Should allow borrowing reporting", async function () {
            await expect(reputationTrackerContract.report(borrower1.address, 0))
                .to.emit(reputationTrackerContract, "ReputationReported")
                .withArgs(
                    reputationTrackerContract.address,
                    borrower1.address,
                    0
                );
        });

        describe("Reporting Pay Off", async function () {
            beforeEach(async function () {
                await reputationTrackerContract.report(borrower2.address, 0);
            });

            it("Should report payoff correctly.", async function () {
                await expect(
                    reputationTrackerContract.report(borrower2.address, 1)
                )
                    .to.emit(reputationTrackerContract, "ReputationReported")
                    .withArgs(
                        reputationTrackerContract.address,
                        borrower2.address,
                        1
                    );
            });
        });

        describe("Reporting Default", async function () {
            beforeEach(async function () {
                await reputationTrackerContract.report(borrower3.address, 0);
            });

            it("Should report payoff correctly.", async function () {
                await expect(
                    reputationTrackerContract.report(borrower3.address, 2)
                )
                    .to.emit(reputationTrackerContract, "ReputationReported")
                    .withArgs(
                        reputationTrackerContract.address,
                        borrower3.address,
                        2
                    );
            });
        });
    });
});
