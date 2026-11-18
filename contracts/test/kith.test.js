const { expect } = require('chai')
const { ethers } = require('hardhat')
const { time } = require('@nomicfoundation/hardhat-network-helpers')

const BIO = 'I research tokens and write summaries.'

async function setup() {
  const [alice, bob, carol, dave, eve] = await ethers.getSigners()
  const aid = await ethers.deployContract('MockAgentID')
  const kith = await ethers.deployContract('Kith', [await aid.getAddress()])
  for (const [label, s] of [['alice', alice], ['bob', bob], ['carol', carol], ['dave', dave]]) await aid.mint(label, s.address)
  const join = async (s, label) => kith.connect(s).join(label, BIO, 'research,summaries', 'https://agent.example/' + label)
  return { kith, aid, alice, bob, carol, dave, eve, join }
}

describe('Kith', () => {
  describe('profiles', () => {
    it('binds a profile to the caller’s own Agent ID', async () => {
      const { kith, alice, join } = await setup()
      await expect(join(alice, 'alice')).to.emit(kith, 'Joined')
      const p = await kith.profileOf(alice.address)
      expect(p.label).to.equal('alice')
      expect(p.tokenId).to.equal(BigInt(ethers.keccak256(ethers.toUtf8Bytes('alice'))))
      expect(await kith.memberCount()).to.equal(1n)
      expect(await kith.isMember(alice.address)).to.equal(true)
    })
    it('rejects a name the caller does not own, and wallets without an Agent ID', async () => {
      const { kith, alice, eve, join } = await setup()
      await expect(join(alice, 'bob')).to.be.revertedWithCustomError(kith, 'NotAgentIdOwner')
      await expect(join(eve, 'eve')).to.be.reverted
    })
    it('allows one profile per wallet and per name', async () => {
      const { kith, alice, join } = await setup()
      await join(alice, 'alice')
      await expect(join(alice, 'alice')).to.be.revertedWithCustomError(kith, 'AlreadyMember')
    })
    it('enforces field limits', async () => {
      const { kith, alice } = await setup()
      await expect(kith.connect(alice).join('alice', 'x'.repeat(281), '', '')).to.be.revertedWithCustomError(kith, 'TooLong')
    })
    it('re-checks Agent ID ownership on every action', async () => {
      const { kith, aid, alice, join } = await setup()
      await join(alice, 'alice')
      await aid.burn('alice')
      await expect(kith.connect(alice).pulse('online')).to.be.reverted
    })
    it('updates a profile', async () => {
      const { kith, alice, join } = await setup()
      await join(alice, 'alice')
      await expect(kith.connect(alice).updateProfile('new bio', 'a,b', '')).to.emit(kith, 'ProfileUpdated')
      expect((await kith.profileOf(alice.address)).bio).to.equal('new bio')
    })
  })

  describe('pulse', () => {
    it('records a heartbeat at most once per hour', async () => {
      const { kith, alice, join } = await setup()
      await join(alice, 'alice')
      await expect(kith.connect(alice).pulse('Scanning BSC for new pools')).to.emit(kith, 'Pulsed')
      await expect(kith.connect(alice).pulse('again')).to.be.revertedWithCustomError(kith, 'PulseTooSoon')
      await time.increase(3601)
      await kith.connect(alice).pulse('again')
      const p = await kith.profileOf(alice.address)
      expect(p.pulses).to.equal(2n)
      expect(p.status).to.equal('again')
    })
  })

  describe('vouch lists', () => {
    it('keeps the outgoing list consistent through removals', async () => {
      const { kith, alice, bob, carol, dave, join } = await setup()
      for (const [s, l] of [[alice, 'alice'], [bob, 'bob'], [carol, 'carol'], [dave, 'dave']]) await join(s, l)
      for (const s of [bob, carol, dave]) await kith.connect(alice).vouch(s.address, 2, 'ok')
      await kith.connect(alice).unvouch(bob.address)
      const [to, vs] = await kith.outgoingOf(alice.address)
      expect([...to].sort()).to.deep.equal([carol.address, dave.address].sort())
      expect(vs.every(v => v.kind === 2n)).to.equal(true)
      await kith.connect(alice).vouch(bob.address, 0, 'again')
      expect((await kith.outgoingOf(alice.address))[0].length).to.equal(3)
      await kith.connect(alice).unvouch(dave.address)
      await kith.connect(alice).unvouch(carol.address)
      await kith.connect(alice).unvouch(bob.address)
      expect((await kith.outgoingOf(alice.address))[0].length).to.equal(0)
    })
  })

  describe('vouches', () => {
    it('counts vouches both ways and allows revoking', async () => {
      const { kith, alice, bob, join } = await setup()
      await join(alice, 'alice')
      await join(bob, 'bob')
      await expect(kith.connect(alice).vouch(bob.address, 1, 'Great summaries')).to.emit(kith, 'Vouched')
      expect((await kith.profileOf(bob.address)).vouchesIn).to.equal(1n)
      expect((await kith.profileOf(alice.address)).vouchesOut).to.equal(1n)
      await expect(kith.connect(alice).vouch(bob.address, 1, 'twice')).to.be.revertedWithCustomError(kith, 'AlreadyVouched')
      const v = await kith.vouchOf(alice.address, bob.address)
      expect(v.kind).to.equal(1n)
      expect(v.note).to.equal('Great summaries')
      let [to] = await kith.outgoingOf(alice.address)
      expect(to).to.deep.equal([bob.address])
      await kith.connect(alice).unvouch(bob.address)
      expect((await kith.profileOf(bob.address)).vouchesIn).to.equal(0n)
      ;[to] = await kith.outgoingOf(alice.address)
      expect(to.length).to.equal(0)
      await expect(kith.connect(alice).unvouch(bob.address)).to.be.revertedWithCustomError(kith, 'NotVouched')
    })
    it('blocks self vouches, unknown agents and bad kinds', async () => {
      const { kith, alice, bob, eve, join } = await setup()
      await join(alice, 'alice')
      await join(bob, 'bob')
      await expect(kith.connect(alice).vouch(alice.address, 0, '')).to.be.revertedWithCustomError(kith, 'SelfAction')
      await expect(kith.connect(alice).vouch(eve.address, 0, '')).to.be.revertedWithCustomError(kith, 'NotMember')
      await expect(kith.connect(alice).vouch(bob.address, 4, '')).to.be.revertedWithCustomError(kith, 'NotAllowed')
      await expect(kith.connect(eve).vouch(bob.address, 0, '')).to.be.revertedWithCustomError(kith, 'NotMember')
    })
    it('caps vouches per day', async () => {
      const { kith, aid, alice, join } = await setup()
      await join(alice, 'alice')
      const signers = await ethers.getSigners()
      for (let i = 5; i < 16; i++) {
        await aid.mint('agent' + i, signers[i].address)
        await join(signers[i], 'agent' + i)
      }
      for (let i = 5; i < 15; i++) await kith.connect(alice).vouch(signers[i].address, 0, '')
      expect(await kith.vouchesLeftToday(alice.address)).to.equal(0n)
      await expect(kith.connect(alice).vouch(signers[15].address, 0, '')).to.be.revertedWithCustomError(kith, 'DailyVouchLimit')
      await time.increase(86400)
      await kith.connect(alice).vouch(signers[15].address, 0, '')
    })
  })

  describe('tips', () => {
    it('sends BNB straight to the agent and records it', async () => {
      const { kith, alice, bob, join } = await setup()
      await join(alice, 'alice')
      await join(bob, 'bob')
      const v = ethers.parseEther('0.01')
      await expect(kith.connect(alice).tip(bob.address, 'thanks', { value: v })).to.changeEtherBalances([alice, bob, kith], [-v, v, 0])
      expect((await kith.profileOf(bob.address)).tipsIn).to.equal(v)
    })
    it('refuses empty tips, self tips and unknown agents', async () => {
      const { kith, alice, bob, eve, join } = await setup()
      await join(alice, 'alice')
      await join(bob, 'bob')
      await expect(kith.connect(alice).tip(bob.address, '')).to.be.revertedWithCustomError(kith, 'NoValue')
      await expect(kith.connect(alice).tip(alice.address, '', { value: 1 })).to.be.revertedWithCustomError(kith, 'SelfAction')
      await expect(kith.connect(alice).tip(eve.address, '', { value: 1 })).to.be.revertedWithCustomError(kith, 'NotMember')
    })
  })

  describe('circles', () => {
    it('opens circles by reputation and lets members post', async () => {
      const { kith, alice, bob, carol, join } = await setup()
      for (const [s, l] of [[alice, 'alice'], [bob, 'bob'], [carol, 'carol']]) await join(s, l)
      await expect(kith.connect(alice).createCircle('Researchers', 'Agents that read the chain', 1)).to.emit(kith, 'CircleCreated')
      await expect(kith.connect(bob).joinCircle(0)).to.be.revertedWithCustomError(kith, 'NotEnoughVouches')
      await kith.connect(alice).vouch(bob.address, 0, '')
      await expect(kith.connect(bob).joinCircle(0)).to.emit(kith, 'CircleJoined')
      await expect(kith.connect(bob).joinCircle(0)).to.be.revertedWithCustomError(kith, 'AlreadyInCircle')
      await expect(kith.connect(bob).post(0, 'Found a new pool')).to.emit(kith, 'Posted')
      expect(await kith.postCount(0)).to.equal(1n)
      const posts = await kith.postsOf(0, 0, 10)
      expect(posts[0].text).to.equal('Found a new pool')
      expect(posts[0].author).to.equal(bob.address)
      expect((await kith.postsOf(0, 5, 10)).length).to.equal(0)
      await expect(kith.connect(carol).post(0, 'hi')).to.be.revertedWithCustomError(kith, 'NotInCircle')
      expect((await kith.circleAt(0)).members).to.equal(2n)
      await kith.connect(bob).leaveCircle(0)
      expect((await kith.circleAt(0)).members).to.equal(1n)
      await expect(kith.connect(bob).joinCircle(9)).to.be.revertedWithCustomError(kith, 'BadCircle')
    })
  })

  describe('jobs', () => {
    async function withJob(minVouches = 0) {
      const s = await setup()
      for (const [x, l] of [[s.alice, 'alice'], [s.bob, 'bob'], [s.carol, 'carol']]) await s.join(x, l)
      const deadline = (await time.latest()) + 86400
      const reward = ethers.parseEther('0.05')
      await s.kith.connect(s.alice).postJob('Summarize a whitepaper', 'Two pages, plain English', minVouches, deadline, { value: reward })
      return { ...s, deadline, reward }
    }
    it('escrows the reward and pays the worker on approval', async () => {
      const { kith, alice, bob, reward } = await withJob()
      expect(await ethers.provider.getBalance(await kith.getAddress())).to.equal(reward)
      await kith.connect(bob).takeJob(0)
      await kith.connect(bob).submitJob(0, 'ipfs://summary')
      await expect(kith.connect(alice).approveJob(0)).to.changeEtherBalances([bob, kith], [reward, -reward])
      const p = await kith.profileOf(bob.address)
      expect(p.jobsDone).to.equal(1n)
      expect(p.earned).to.equal(reward)
      expect((await kith.jobAt(0)).state).to.equal(3n)
    })
    it('lets the worker claim after the review window if the poster is silent', async () => {
      const { kith, bob, reward } = await withJob()
      await kith.connect(bob).takeJob(0)
      await kith.connect(bob).submitJob(0, 'done')
      await expect(kith.connect(bob).claimJob(0)).to.be.revertedWithCustomError(kith, 'TooEarly')
      await time.increase(3 * 86400 + 1)
      await expect(kith.connect(bob).claimJob(0)).to.changeEtherBalances([bob], [reward])
    })
    it('requires reputation to take a job', async () => {
      const { kith, alice, bob } = await withJob(1)
      await expect(kith.connect(bob).takeJob(0)).to.be.revertedWithCustomError(kith, 'NotEnoughVouches')
      await kith.connect(alice).vouch(bob.address, 1, '')
      await kith.connect(bob).takeJob(0)
    })
    it('blocks posters from taking their own job and others from approving', async () => {
      const { kith, alice, bob, carol } = await withJob()
      await expect(kith.connect(alice).takeJob(0)).to.be.revertedWithCustomError(kith, 'SelfAction')
      await kith.connect(bob).takeJob(0)
      await expect(kith.connect(carol).submitJob(0, 'x')).to.be.revertedWithCustomError(kith, 'WrongState')
      await kith.connect(bob).submitJob(0, 'x')
      await expect(kith.connect(carol).approveJob(0)).to.be.revertedWithCustomError(kith, 'NotAllowed')
    })
    it('cancels an open job with a refund', async () => {
      const { kith, alice, reward } = await withJob()
      await expect(kith.connect(alice).cancelJob(0)).to.changeEtherBalances([alice, kith], [reward, -reward])
      await expect(kith.connect(alice).cancelJob(0)).to.be.revertedWithCustomError(kith, 'WrongState')
    })
    it('refunds the poster when the worker misses the deadline', async () => {
      const { kith, alice, bob, reward } = await withJob()
      await kith.connect(bob).takeJob(0)
      await expect(kith.connect(alice).reclaimJob(0)).to.be.revertedWithCustomError(kith, 'TooEarly')
      await time.increase(86401)
      await expect(kith.connect(bob).submitJob(0, 'late')).to.be.revertedWithCustomError(kith, 'TooLate')
      await expect(kith.connect(alice).reclaimJob(0)).to.changeEtherBalances([alice], [reward])
    })
    it('validates deadlines and rewards', async () => {
      const { kith, alice, join } = await setup()
      await join(alice, 'alice')
      const now = await time.latest()
      await expect(kith.connect(alice).postJob('t', '', 0, now + 100, { value: 1 })).to.be.revertedWithCustomError(kith, 'BadDeadline')
      await expect(kith.connect(alice).postJob('t', '', 0, now + 61 * 86400, { value: 1 })).to.be.revertedWithCustomError(kith, 'BadDeadline')
      await expect(kith.connect(alice).postJob('t', '', 0, now + 7200)).to.be.revertedWithCustomError(kith, 'NoValue')
    })
    it('keeps only escrowed rewards, never tips', async () => {
      const { kith, alice, bob, reward } = await withJob()
      await kith.connect(alice).tip(bob.address, 'thanks', { value: 12345 })
      expect(await ethers.provider.getBalance(await kith.getAddress())).to.equal(reward)
    })
  })
})
