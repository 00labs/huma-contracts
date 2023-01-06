const {ethers} = require("hardhat");
const {expect} = require("chai");

describe("EvaluationAgentNFT Test", function () {
    let deployer;
    let eaUser;
    let eaUser2;
    let nftContract;
    let eaNFTTokenId;
    let eaNFTTokenId2;
    let uri =
        "data:application/json;base64,eyJkZXNjcmlwdGlvbiI6ICJSZXByZXNlbnRzIHRoZSBFdmFsdWF0aW9uIEFnZW50IHRoYXQgYWltcyB0byBwcm92aWRlIGEgc2VydmljZSBmb3IgdGhlIEh1bWEgcG9vbCB0byBhcHByb3ZlZCBvciBkZWNsaW5lIHRoZSBjcmVkaXQgbGluZSBhcHBsaWNhdGlvbiIsICJuYW1lIjogIkh1bWEgRXZhbHVhdGlvbiBBZ2VudDogT25jaGFpbiBpbmNvbWUiLCAiaW1hZ2UiOiAiaHR0cHM6Ly9pcGZzLmlvL2lwZnMvUW1mMjNqa0d0eFh3aTR1NE1pTW1uS0xBOThya0dYbkYxOW5XZkxEMVM3R1hKdCIsICJhdHRyaWJ1dGVzIjogW3sidHJhaXRfdHlwZSI6ICJBVUMiLCAidmFsdWUiOiAwLjl9LCB7InRyYWl0X3R5cGUiOiAic3R5bGUiLCAidmFsdWUiOiAiYXV0b21hdGljIn0sIHsidHJhaXRfdHlwZSI6ICJuYW1lIiwgInZhbHVlIjogIk9uY2hhaW4gaW5jb21lIEVBIn0sIHsidHJhaXRfdHlwZSI6ICJzdGF0dXMiLCAidmFsdWUiOiAiYXBwcm92ZWQifV19";

    before(async function () {
        [deployer, eaUser, eaUser2] = await ethers.getSigners();

        const EvaluationAgentNFT = await ethers.getContractFactory("EvaluationAgentNFT");
        nftContract = await EvaluationAgentNFT.connect(deployer).deploy();
        await nftContract.deployed();

        let tx = await nftContract.mintNFT(eaUser.address);
        let receipt = await tx.wait();
        for (const evt of receipt.events) {
            if (evt.event === "NFTGenerated") {
                eaNFTTokenId = evt.args.tokenId;
            }
        }

        tx = await nftContract.mintNFT(eaUser.address);
        receipt = await tx.wait();
        for (const evt of receipt.events) {
            if (evt.event === "NFTGenerated") {
                eaNFTTokenId2 = evt.args.tokenId;
            }
        }
    });

    it("Should do nothing for all the transfer requests", async function () {
        await nftContract.transferFrom(eaUser.address, eaUser2.address, eaNFTTokenId);
        expect(await nftContract.ownerOf(eaNFTTokenId)).to.equal(eaUser.address);

        await nftContract
            .connect(eaUser)
            .functions["safeTransferFrom(address,address,uint256)"](
                eaUser.address,
                eaUser2.address,
                eaNFTTokenId
            );
        expect(await nftContract.ownerOf(eaNFTTokenId)).to.equal(eaUser.address);
        await nftContract
            .connect(eaUser)
            .functions["safeTransferFrom(address,address,uint256,bytes)"](
                eaUser.address,
                eaUser2.address,
                eaNFTTokenId,
                new Uint8Array(256)
            );
        expect(await nftContract.ownerOf(eaNFTTokenId)).to.equal(eaUser.address);
    });

    describe("setURI", async function () {
        it("Shall reject non-owner to change URI", async function () {
            await expect(
                nftContract.connect(eaUser2).setTokenURI(eaNFTTokenId, uri)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
        it("Shall reject non-owner to change URI", async function () {
            await expect(
                nftContract.connect(eaUser).setTokenURI(eaNFTTokenId, uri)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
        it("Shall reject non-owner to change URI", async function () {
            expect(await nftContract.connect(deployer).setTokenURI(eaNFTTokenId, uri))
                .to.emit(nftContract, "SetURI")
                .withArgs(eaNFTTokenId, uri);
        });
    });
    describe("burn", async function () {
        it("Shall reject non-owner to burn it", async function () {
            await expect(
                nftContract.connect(deployer).burn(eaNFTTokenId)
            ).to.be.revertedWithCustomError(nftContract, "notNFTOwner");
        });
        it("Shall allow NFT owner to burn an NFT", async function () {
            expect(await nftContract.balanceOf(eaUser.address)).to.equal(2);
            expect(await nftContract.connect(eaUser).burn(eaNFTTokenId))
                .to.emit(nftContract, "Transfer")
                .withArgs(eaUser.address, ethers.constants.AddressZero, eaNFTTokenId);
            expect(await nftContract.balanceOf(eaUser.address)).to.equal(1);
        });
    });
});
