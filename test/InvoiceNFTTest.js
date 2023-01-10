const {ethers} = require("hardhat");
const {expect} = require("chai");
const {evmSnapshot, evmRevert} = require("./BaseTest");

describe("InvoiceNFT Test", function () {
    let deployer, user1, user2, user3;

    let testToken, nft;

    let sId;

    before(async function () {
        [deployer, user1, user2, user3] = await ethers.getSigners();

        const TestToken = await ethers.getContractFactory("TestToken");
        testToken = await TestToken.deploy();
        await testToken.deployed();

        const InvoiceNFT = await ethers.getContractFactory("InvoiceNFT");
        nft = await InvoiceNFT.deploy(testToken.address);
        await nft.deployed();
    });

    beforeEach(async function () {
        sId = await evmSnapshot();
    });

    afterEach(async function () {
        if (sId) {
            const res = await evmRevert(sId);
        }
    });

    async function verifyNFTs(user, nftIds) {
        const ids = await nft.getNFTIds(user.address);
        expect(ids.toString()).equals(nftIds.toString());
    }

    async function verifyNFTIndexes(indexes) {
        const res = [];
        for (let i = 1; i <= 5; i++) {
            res[i - 1] = await nft.getTokenIdIndex(i);
        }
        expect(res.toString()).equals(indexes.toString());
    }

    it("list NFTs", async function () {
        await nft.mintNFT(user1.address, "test1");
        await nft.mintNFT(user1.address, "test2");
        await nft.mintNFT(user1.address, "test3");
        await verifyNFTs(user1, [1, 2, 3]);

        await nft.mintNFT(user2.address, "test4");
        await nft.mintNFT(user2.address, "test5");
        await verifyNFTs(user2, [4, 5]);

        await nft.connect(user1).transferFrom(user1.address, user2.address, 1);
        await verifyNFTs(user1, [3, 2]);
        await verifyNFTs(user2, [4, 5, 1]);
        await verifyNFTIndexes([3, 2, 1, 1, 2]);

        await nft
            .connect(user2)
            ["safeTransferFrom(address,address,uint256)"](user2.address, user1.address, 5);
        await verifyNFTs(user1, [3, 2, 5]);
        await verifyNFTs(user2, [4, 1]);
        await verifyNFTIndexes([2, 2, 1, 1, 3]);

        await nft.connect(user1).approve(user3.address, 3);
        await nft.connect(user1).approve(user3.address, 2);
        await nft.connect(user1).approve(user3.address, 5);
        await nft.connect(user2).approve(user3.address, 4);
        await verifyNFTIndexes([2, 2, 1, 1, 3]);

        await nft.connect(user3).transferFrom(user1.address, user3.address, 5);
        await nft.connect(user3).transferFrom(user1.address, user3.address, 2);
        await nft.connect(user3).transferFrom(user1.address, user3.address, 3);
        await nft.connect(user3).transferFrom(user2.address, user3.address, 4);
        await verifyNFTs(user1, []);
        await verifyNFTs(user2, [1]);
        await verifyNFTs(user3, [5, 2, 3, 4]);
        await verifyNFTIndexes([1, 2, 3, 4, 1]);
    });
});
