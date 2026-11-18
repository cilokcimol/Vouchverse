const { expect } = require('chai')
const { ethers } = require('hardhat')
const { time } = require('@nomicfoundation/hardhat-network-helpers')

const BIO = 'I research tokens and write summaries.'

async function setup() {
  const [alice, bob, carol, dave, eve] = await ethers.getSigners()
  const aid = await ethers.deployContract('MockAgentID')
  const vouchverse = await ethers.deployContract('Vouchverse', [await aid.getAddress()])
  for (const [label, s] of [['alice', alice], ['bob', bob], ['carol', carol], ['dave', dave]]) await aid.mint(label, s.address)
  const join = async (s, label) => vouchverse.connect(s).join(label, BIO, 'research,summaries', 'https://agent.example/' + label)
  return { vouchverse, aid, alice, bob, carol, dave, eve, join }
}

describe('Vouchverse', () => {
  describe('profiles', () => {
    it('binds a profile to the caller’s own Agent ID', async () => {
      const { vouchverse, alice, join } = await setup()
      await expect(join(alice, 'alice')).to.emit(vouchverse, 'Joined')
      const p = await vouchverse.profileOf(alice.address)
      expect(p.label).to.equal('alice')
      expect(p.tokenId).to.equal(BigInt(ethers.keccak256(ethers.toUtf8Bytes('alice'))))
      expect(await vouchverse.memberCount()).to.equal(1n)
      expect(await vouchverse.isMember(alice.address)).to.equal(true)
    })
    it('rejects a name the caller does not own, and wallets without an Agent ID', async () => {
      const { vouchverse, alice, eve, join } = await setup()
      await expect(join(alice, 'bob')).to.be.revertedWithCustomError(vouchverse, 'NotAgentIdOwner')
      await expect(join(eve, 'eve')).to.be.reverted
    })
    it('allows one profile per wallet and per name', async () => {
      const { vouchverse, alice, join } = await setup()
      await join(alice, 'alice')
      await expect(join(alice, 'alice')).to.be.revertedWithCustomError(vouchverse, 'AlreadyMember')
    })
    it('enforces field limits', async () => {
      const { vouchverse, alice } = await setup()
      await expect(vouchverse.connect(alice).join('alice', 'x'.repeat(281), '', '')).to.be.revertedWithCustomError(vouchverse, 'TooLong')
    })
    it('re-checks Agent ID ownership on every action', async () => {
      const { vouchverse, aid, alice, join } = await setup()
      await join(alice, 'alice')
      await aid.burn('alice')
      await expect(vouchverse.connect(alice).pulse('online')).to.be.reverted
    })
    it('updates a profile', async () => {
      const { vouchverse, alice, join } = await setup()
      await join(alice, 'alice')
      await expect(vouchverse.connect(alice).updateProfile('new bio', 'a,b', '')).to.emit(vouchverse, 'ProfileUpdated')
      expect((await vouchverse.profileOf(alice.address)).bio).to.equal('new bio')
    })
  })

  describe('pulse', () => {
    it('records a heartbeat at most once per hour', async () => {
      const { vouchverse, alice, join } = await setup()
      await join(alice, 'alice')
      await expect(vouchverse.connect(alice).pulse('Scanning BSC for new pools')).to.emit(vouchverse, 'Pulsed')
      await expect(vouchverse.connect(alice).pulse('again')).to.be.revertedWithCustomError(vouchverse, 'PulseTooSoon')
      await time.increase(3601)
      await vouchverse.connect(alice).pulse('again')
      const p = await vouchverse.profileOf(alice.address)
      expect(p.pulses).to.equal(2n)
      expect(p.status).to.equal('again')
    })
  })

  describe('vouch lists', () => {
    it('keeps the outgoing list consistent through removals', async () => {
      const { vouchverse, alice, bob, carol, dave, join } = await setup()
      for (const [s, l] of [[alice, 'alice'], [bob, 'bob'], [carol, 'carol'], [dave, 'dave']]) await join(s, l)
      for (const s of [bob, carol, dave]) await vouchverse.connect(alice).vouch(s.address, 2, 'ok')
      await vouchverse.connect(alice).unvouch(bob.address)
      const [to, vs] = await vouchverse.outgoingOf(alice.address)
      expect([...to].sort()).to.deep.equal([carol.address, dave.address].sort())
      expect(vs.every(v => v.kind === 2n)).to.equal(true)
      await vouchverse.connect(alice).vouch(bob.address, 0, 'again')
      expect((await vouchverse.outgoingOf(alice.address))[0].length).to.equal(3)
      await vouchverse.connect(alice).unvouch(dave.address)
      await vouchverse.connect(alice).unvouch(carol.address)
      await vouchverse.connect(alice).unvouch(bob.address)
      expect((await vouchverse.outgoingOf(alice.address))[0].length).to.equal(0)
    })
  })

  describe('vouches', () => {
    it('counts vouches both ways and allows revoking', async () => {
      const { vouchverse, alice, bob, join } = await setup()
      await join(alice, 'alice')
      await join(bob, 'bob')
      await expect(vouchverse.connect(alice).vouch(bob.address, 1, 'Great summaries')).to.emit(vouchverse, 'Vouched')
      expect((await vouchverse.profileOf(bob.address)).vouchesIn).to.equal(1n)
      expect((await vouchverse.profileOf(alice.address)).vouchesOut).to.equal(1n)
      await expect(vouchverse.connect(alice).vouch(bob.address, 1, 'twice')).to.be.revertedWithCustomError(vouchverse, 'AlreadyVouched')
      const v = await vouchverse.vouchOf(alice.address, bob.address)
      expect(v.kind).to.equal(1n)
      expect(v.note).to.equal('Great summaries')
      let [to] = await vouchverse.outgoingOf(alice.address)
      expect(to).to.deep.equal([bob.address])
      await vouchverse.connect(alice).unvouch(bob.address)
      expect((await vouchverse.profileOf(bob.address)).vouchesIn).to.equal(0n)
      ;[to] = await vouchverse.outgoingOf(alice.address)
      expect(to.length).to.equal(0)
      await expect(vouchverse.connect(alice).unvouch(bob.address)).to.be.revertedWithCustomError(vouchverse, 'NotVouched')
    })
    it('blocks self vouches, unknown agents and bad kinds', async () => {
      const { vouchverse, alice, bob, eve, join } = await setup()
      await join(alice, 'alice')
      await join(bob, 'bob')
      await expect(vouchverse.connect(alice).vouch(alice.address, 0, '')).to.be.revertedWithCustomError(vouchverse, 'SelfAction')
      await expect(vouchverse.connect(alice).vouch(eve.address, 0, '')).to.be.revertedWithCustomError(vouchverse, 'NotMember')
      await expect(vouchverse.connect(alice).vouch(bob.address, 4, '')).to.be.revertedWithCustomError(vouchverse, 'NotAllowed')
      await expect(vouchverse.connect(eve).vouch(bob.address, 0, '')).to.be.revertedWithCustomError(vouchverse, 'NotMember')
    })
    it('caps vouches per day', async () => {
      const { vouchverse, aid, alice, join } = await setup()
      await join(alice, 'alice')
      const signers = await ethers.getSigners()
      for (let i = 5; i < 16; i++) {
        await aid.mint('agent' + i, signers[i].address)
        await join(signers[i], 'agent' + i)
      }
      for (let i = 5; i < 15; i++) await vouchverse.connect(alice).vouch(signers[i].address, 0, '')
      expect(await vouchverse.vouchesLeftToday(alice.address)).to.equal(0n)
      await expect(vouchverse.connect(alice).vouch(signers[15].address, 0, '')).to.be.revertedWithCustomError(vouchverse, 'DailyVouchLimit')
      await time.increase(86400)
      await vouchverse.connect(alice).vouch(signers[15].address, 0, '')
    })
  })

  describe('tips', () => {
    it('sends BNB straight to the agent and records it', async () => {
      const { vouchverse, alice, bob, join } = await setup()
      await join(alice, 'alice')
      await join(bob, 'bob')
      const v = ethers.parseEther('0.01')
      await expect(vouchverse.connect(alice).tip(bob.address, 'thanks', { value: v })).to.changeEtherBalances([alice, bob, vouchverse], [-v, v, 0])
      expect((await vouchverse.profileOf(bob.address)).tipsIn).to.equal(v)
    })
    it('refuses empty tips, self tips and unknown agents', async () => {
      const { vouchverse, alice, bob, eve, join } = await setup()
      await join(alice, 'alice')
      await join(bob, 'bob')
      await expect(vouchverse.connect(alice).tip(bob.address, '')).to.be.revertedWithCustomError(vouchverse, 'NoValue')
      await expect(vouchverse.connect(alice).tip(alice.address, '', { value: 1 })).to.be.revertedWithCustomError(vouchverse, 'SelfAction')
      await expect(vouchverse.connect(alice).tip(eve.address, '', { value: 1 })).to.be.revertedWithCustomError(vouchverse, 'NotMember')
    })
  })

  describe('circles', () => {
    it('opens circles by reputation and lets members post', async () => {
      const { vouchverse, alice, bob, carol, join } = await setup()
      for (const [s, l] of [[alice, 'alice'], [bob, 'bob'], [carol, 'carol']]) await join(s, l)
      await expect(vouchverse.connect(alice).createCircle('Researchers', 'Agents that read the chain', 1)).to.emit(vouchverse, 'CircleCreated')
      await expect(vouchverse.connect(bob).joinCircle(0)).to.be.revertedWithCustomError(vouchverse, 'NotEnoughVouches')
      await vouchverse.connect(alice).vouch(bob.address, 0, '')
      await expect(vouchverse.connect(bob).joinCircle(0)).to.emit(vouchverse, 'CircleJoined')
      await expect(vouchverse.connect(bob).joinCircle(0)).to.be.revertedWithCustomError(vouchverse, 'AlreadyInCircle')
      await expect(vouchverse.connect(bob).post(0, 'Found a new pool')).to.emit(vouchverse, 'Posted')
      expect(await vouchverse.postCount(0)).to.equal(1n)
      const posts = await vouchverse.postsOf(0, 0, 10)
      expect(posts[0].text).to.equal('Found a new pool')
      expect(posts[0].author).to.equal(bob.address)
      expect((await vouchverse.postsOf(0, 5, 10)).length).to.equal(0)
      await expect(vouchverse.connect(carol).post(0, 'hi')).to.be.revertedWithCustomError(vouchverse, 'NotInCircle')
      expect((await vouchverse.circleAt(0)).members).to.equal(2n)
      await vouchverse.connect(bob).leaveCircle(0)
      expect((await vouchverse.circleAt(0)).members).to.equal(1n)
      await expect(vouchverse.connect(bob).joinCircle(9)).to.be.revertedWithCustomError(vouchverse, 'BadCircle')
    })
  })

  describe('jobs', () => {
    async function withJob(minVouches = 0) {
      const s = await setup()
      for (const [x, l] of [[s.alice, 'alice'], [s.bob, 'bob'], [s.carol, 'carol']]) await s.join(x, l)
      const deadline = (await time.latest()) + 86400
      const reward = ethers.parseEther('0.05')
      await s.vouchverse.connect(s.alice).postJob('Summarize a whitepaper', 'Two pages, plain English', minVouches, deadline, { value: reward })
      return { ...s, deadline, reward }
    }
    it('escrows the reward and pays the worker on approval', async () => {
      const { vouchverse, alice, bob, reward } = await withJob()
      expect(await ethers.provider.getBalance(await vouchverse.getAddress())).to.equal(reward)
      await vouchverse.connect(bob).takeJob(0)
      await vouchverse.connect(bob).submitJob(0, 'ipfs://summary')
      await expect(vouchverse.connect(alice).approveJob(0)).to.changeEtherBalances([bob, vouchverse], [reward, -reward])
      const p = await vouchverse.profileOf(bob.address)
      expect(p.jobsDone).to.equal(1n)
      expect(p.earned).to.equal(reward)
      expect((await vouchverse.jobAt(0)).state).to.equal(3n)
    })
    it('lets the worker claim after the review window if the poster is silent', async () => {
      const { vouchverse, bob, reward } = await withJob()
      await vouchverse.connect(bob).takeJob(0)
      await vouchverse.connect(bob).submitJob(0, 'done')
      await expect(vouchverse.connect(bob).claimJob(0)).to.be.revertedWithCustomError(vouchverse, 'TooEarly')
      await time.increase(3 * 86400 + 1)
      await expect(vouchverse.connect(bob).claimJob(0)).to.changeEtherBalances([bob], [reward])
    })
    it('requires reputation to take a job', async () => {
      const { vouchverse, alice, bob } = await withJob(1)
      await expect(vouchverse.connect(bob).takeJob(0)).to.be.revertedWithCustomError(vouchverse, 'NotEnoughVouches')
      await vouchverse.connect(alice).vouch(bob.address, 1, '')
      await vouchverse.connect(bob).takeJob(0)
    })
    it('blocks posters from taking their own job and others from approving', async () => {
      const { vouchverse, alice, bob, carol } = await withJob()
      await expect(vouchverse.connect(alice).takeJob(0)).to.be.revertedWithCustomError(vouchverse, 'SelfAction')
      await vouchverse.connect(bob).takeJob(0)
      await expect(vouchverse.connect(carol).submitJob(0, 'x')).to.be.revertedWithCustomError(vouchverse, 'WrongState')
      await vouchverse.connect(bob).submitJob(0, 'x')
      await expect(vouchverse.connect(carol).approveJob(0)).to.be.revertedWithCustomError(vouchverse, 'NotAllowed')
    })
    it('cancels an open job with a refund', async () => {
      const { vouchverse, alice, reward } = await withJob()
      await expect(vouchverse.connect(alice).cancelJob(0)).to.changeEtherBalances([alice, vouchverse], [reward, -reward])
      await expect(vouchverse.connect(alice).cancelJob(0)).to.be.revertedWithCustomError(vouchverse, 'WrongState')
    })
    it('refunds the poster when the worker misses the deadline', async () => {
      const { vouchverse, alice, bob, reward } = await withJob()
      await vouchverse.connect(bob).takeJob(0)
      await expect(vouchverse.connect(alice).reclaimJob(0)).to.be.revertedWithCustomError(vouchverse, 'TooEarly')
      await time.increase(86401)
      await expect(vouchverse.connect(bob).submitJob(0, 'late')).to.be.revertedWithCustomError(vouchverse, 'TooLate')
      await expect(vouchverse.connect(alice).reclaimJob(0)).to.changeEtherBalances([alice], [reward])
    })
    it('validates deadlines and rewards', async () => {
      const { vouchverse, alice, join } = await setup()
      await join(alice, 'alice')
      const now = await time.latest()
      await expect(vouchverse.connect(alice).postJob('t', '', 0, now + 100, { value: 1 })).to.be.revertedWithCustomError(vouchverse, 'BadDeadline')
      await expect(vouchverse.connect(alice).postJob('t', '', 0, now + 61 * 86400, { value: 1 })).to.be.revertedWithCustomError(vouchverse, 'BadDeadline')
      await expect(vouchverse.connect(alice).postJob('t', '', 0, now + 7200)).to.be.revertedWithCustomError(vouchverse, 'NoValue')
    })
    it('keeps only escrowed rewards, never tips', async () => {
      const { vouchverse, alice, bob, reward } = await withJob()
      await vouchverse.connect(alice).tip(bob.address, 'thanks', { value: 12345 })
      expect(await ethers.provider.getBalance(await vouchverse.getAddress())).to.equal(reward)
    })
  })
})
