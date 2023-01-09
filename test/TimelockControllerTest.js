const {ethers} = require("hardhat");
const {expect} = require("chai");
const {deployContracts, deployAndSetupPool, evmSnapshot, evmRevert} = require("./BaseTest");

describe("TimelockController Test", function () {
    const salt = ethers.utils.formatBytes32String("salt");

    let poolContract;
    let poolConfigContract;
    let hdtContract;
    let humaConfigContract;
    let testTokenContract;
    let feeManagerContract;
    let defaultDeployer;
    let proxyOwner;
    let protocolOwner;
    let poolOwner;
    let evaluationAgent;
    let treasury;
    let lender;
    let timelockContract;
    let eaNFTContract;
    let eaServiceAccount;
    let pdsServiceAccount;
    let poolOperator;
    let poolOwnerTreasury;

    async function advanceClock(seconds) {
        await ethers.provider.send("evm_increaseTime", [seconds]);
        await ethers.provider.send("evm_mine");
    }

    function genOperation(target, value, data, predecessor, salt) {
        const id = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ["address", "uint256", "bytes", "uint256", "bytes32"],
                [target, value, data, predecessor, salt]
            )
        );
        return {id, target, value, data, predecessor, salt};
    }

    function genOperationBatch(targets, values, payloads, predecessor, salt) {
        const id = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ["address[]", "uint256[]", "bytes[]", "uint256", "bytes32"],
                [targets, values, payloads, predecessor, salt]
            )
        );
        return {id, targets, values, payloads, predecessor, salt};
    }

    before(async function () {
        [
            defaultDeployer,
            proxyOwner,
            lender,
            borrower,
            treasury,
            evaluationAgent,
            poolOwner,
            protocolOwner,
            eaServiceAccount,
            pdsServiceAccount,
            poolOperator,
            poolOwnerTreasury,
        ] = await ethers.getSigners();

        [humaConfigContract, feeManagerContract, testTokenContract, eaNFTContract] =
            await deployContracts(
                poolOwner,
                treasury,
                lender,
                protocolOwner,
                eaServiceAccount,
                pdsServiceAccount
            );

        [hdtContract, poolConfigContract, poolContract] = await deployAndSetupPool(
            poolOwner,
            proxyOwner,
            evaluationAgent,
            lender,
            humaConfigContract,
            feeManagerContract,
            testTokenContract,
            0,
            eaNFTContract,
            true, // ReceivableFacotringPool
            poolOperator,
            poolOwnerTreasury
        );

        const TimelockController = await ethers.getContractFactory("TimelockController");
        timelockContract = await TimelockController.deploy(
            0,
            [protocolOwner.address],
            [protocolOwner.address]
        );
        await timelockContract.deployed();

        // set timelock as HDT's owner
        await hdtContract.transferOwnership(timelockContract.address);

        // deployer renounces admin role
        const adminRole = await timelockContract.TIMELOCK_ADMIN_ROLE();
        await timelockContract.renounceRole(adminRole, defaultDeployer.address);
    });

    beforeEach(async function () {
        sId = await evmSnapshot();
    });

    afterEach(async function () {
        if (sId) {
            const res = await evmRevert(sId);
        }
    });

    it("Deployer doesn't have admin role", async function () {
        const adminRole = await timelockContract.TIMELOCK_ADMIN_ROLE();
        expect(await timelockContract.hasRole(adminRole, defaultDeployer.address)).equals(false);
    });

    it("Timelock has admin role", async function () {
        const adminRole = await timelockContract.TIMELOCK_ADMIN_ROLE();
        expect(await timelockContract.hasRole(adminRole, timelockContract.address)).equals(true);
    });

    it("Protocol owner has correct roles", async function () {
        let role = await timelockContract.PROPOSER_ROLE();
        expect(await timelockContract.hasRole(role, protocolOwner.address)).equals(true);
        role = await timelockContract.EXECUTOR_ROLE();
        expect(await timelockContract.hasRole(role, protocolOwner.address)).equals(true);
        role = await timelockContract.CANCELLER_ROLE();
        expect(await timelockContract.hasRole(role, protocolOwner.address)).equals(true);
    });

    it("Should not allow schedule without correct role", async function () {
        const data = hdtContract.interface.encodeFunctionData("setPool", [poolOwner.address]);
        const operation = genOperation(
            hdtContract.address,
            0,
            data,
            ethers.constants.HashZero,
            salt
        );
        await expect(
            timelockContract.schedule(
                operation.target,
                operation.value,
                operation.data,
                operation.predecessor,
                operation.salt,
                0
            )
        ).to.be.reverted;
    });

    it("Should schedule successfully", async function () {
        const data = hdtContract.interface.encodeFunctionData("setPool", [poolOwner.address]);
        const operation = genOperation(
            hdtContract.address,
            0,
            data,
            ethers.constants.HashZero,
            salt
        );
        const delay = 100;
        await timelockContract
            .connect(protocolOwner)
            .schedule(
                operation.target,
                operation.value,
                operation.data,
                operation.predecessor,
                operation.salt,
                delay
            );
        expect(await timelockContract.isOperationPending(operation.id)).equals(true);
    });

    it("Should cancel successfully", async function () {
        const data = hdtContract.interface.encodeFunctionData("setPool", [poolOwner.address]);
        const operation = genOperation(
            hdtContract.address,
            0,
            data,
            ethers.constants.HashZero,
            salt
        );
        const delay = 100;
        await timelockContract
            .connect(protocolOwner)
            .schedule(
                operation.target,
                operation.value,
                operation.data,
                operation.predecessor,
                operation.salt,
                delay
            );
        expect(await timelockContract.isOperationPending(operation.id)).equals(true);

        // revert with wrong role
        await expect(timelockContract.cancel(operation.id)).to.be.reverted;

        await timelockContract.connect(protocolOwner).cancel(operation.id);
        expect(await timelockContract.isOperation(operation.id)).equals(false);
    });

    it("Should exec successfully", async function () {
        const data = hdtContract.interface.encodeFunctionData("setPool", [poolOwner.address]);
        const operation = genOperation(
            hdtContract.address,
            0,
            data,
            ethers.constants.HashZero,
            salt
        );
        const delay = 100;
        await timelockContract
            .connect(protocolOwner)
            .schedule(
                operation.target,
                operation.value,
                operation.data,
                operation.predecessor,
                operation.salt,
                delay
            );
        expect(await timelockContract.isOperationPending(operation.id)).equals(true);

        // revert with wrong role
        await expect(
            timelockContract.execute(
                operation.target,
                operation.value,
                operation.data,
                operation.predecessor,
                operation.salt
            )
        ).to.be.reverted;

        // can't execute pending operation
        await expect(
            timelockContract
                .connect(protocolOwner)
                .execute(
                    operation.target,
                    operation.value,
                    operation.data,
                    operation.predecessor,
                    operation.salt
                )
        ).to.be.reverted;

        await advanceClock(delay);

        expect(await timelockContract.isOperationReady(operation.id)).equals(true);
        // can't cancel ready operation
        await expect(timelockContract.cancel(operation.id)).to.be.reverted;

        expect(await hdtContract.pool()).equals(poolContract.address);

        await timelockContract
            .connect(protocolOwner)
            .execute(
                operation.target,
                operation.value,
                operation.data,
                operation.predecessor,
                operation.salt
            );

        expect(await timelockContract.isOperationDone(operation.id)).equals(true);
        // can't cancel done operation
        await expect(timelockContract.cancel(operation.id)).to.be.reverted;

        expect(await hdtContract.pool()).equals(poolOwner.address);
    });
});
