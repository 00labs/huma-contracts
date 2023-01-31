async function displayCreditRecord(pool, account) {
    let cr = await pool.creditRecordMapping(account.address);
    _displayCreditRecord(account, cr);
    return cr;
}

function _displayCreditRecord(account, cr) {
    console.log(
        `\n${account.address} credit record - dueDate: ${new Date(
            cr.dueDate.toNumber() * 1000
        )}, totalDue: ${cr.totalDue}, feesAndInterestDue: ${
            cr.feesAndInterestDue
        }, feesAndInterestDue: ${cr.feesAndInterestDue}, unbilledPrincipal: ${
            cr.unbilledPrincipal
        }, correction: ${cr.correction}, remainingPeriods: ${
            cr.remainingPeriods
        }, missedPeriods: ${cr.missedPeriods}, state: ${cr.state} \n`
    );
}

async function mintToken(token, mapSlot, address, amount) {
    const beforeAmount = await token.balanceOf(address);
    const newAmount = amount.add(beforeAmount);
    await setToken(token.address, mapSlot, address, newAmount);
}

async function setToken(tokenAddress, mapSlot, address, amount) {
    const mintAmount = ethers.utils.hexZeroPad(amount.toHexString(), 32);
    const slot = ethers.utils.hexStripZeros(
        ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [address, mapSlot])
        )
    );
    await hre.network.provider.send("hardhat_setStorageAt", [tokenAddress, slot, mintAmount]);
}

module.exports = {
    displayCreditRecord,
    mintToken,
};
