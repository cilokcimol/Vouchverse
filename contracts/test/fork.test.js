// Runs only with FORK=1: joins Kith with a real Agent ID on a BNB Chain mainnet fork.
const { expect } = require('chai')
const { ethers, network } = require('hardhat')

const AGENT_ID = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const HOLDER = '0xd795804D4D91e07C094bE6203ccbcEAbE3C4AC41'
const LABEL = 'mryansofyan'

;(process.env.FORK ? describe : describe.skip)('Kith on a BNB Chain fork', () => {
  it('accepts the real owner of a name.ai and rejects anyone else', async () => {
    const kith = await ethers.deployContract('Kith', [AGENT_ID])
    await network.provider.request({ method: 'hardhat_impersonateAccount', params: [HOLDER] })
    await network.provider.send('hardhat_setBalance', [HOLDER, '0x56BC75E2D63100000'])
    const holder = await ethers.getSigner(HOLDER)
    const [stranger] = await ethers.getSigners()
    await expect(kith.connect(stranger).join(LABEL, '', '', '')).to.be.revertedWithCustomError(kith, 'NotAgentIdOwner')
    await expect(kith.connect(holder).join(LABEL, 'Fork test', 'testing', '')).to.emit(kith, 'Joined')
    const p = await kith.profileOf(HOLDER)
    expect(p.label).to.equal(LABEL)
    await kith.connect(holder).pulse('alive on a fork')
    expect((await kith.profileOf(HOLDER)).pulses).to.equal(1n)
  })
})
