// Reads the whole Kith network from BNB Chain with batched view calls, and scores trust.
import { Contract, JsonRpcProvider, formatEther, keccak256, toUtf8Bytes } from 'ethers'
import { KITH_ABI, AGENT_ID_ABI } from './abi.js'
import { AGENT_ID_ADDRESS, CHAIN_ID, KITH_ADDRESS, RPC_URLS, VOUCH_KINDS } from './config.js'

export interface Agent {
  address: string
  tokenId: string
  label: string
  bio: string
  skills: string[]
  endpoint: string
  status: string
  joinedAt: number
  lastPulse: number
  pulses: number
  vouchesIn: number
  vouchesOut: number
  jobsDone: number
  jobsPosted: number
  tipsIn: string
  earned: string
  score: number
  rank: number
}

export interface Edge {
  from: string
  to: string
  kind: number
  kindName: string
  note: string
  at: number
}

export interface Circle {
  id: number
  creator: string
  minVouches: number
  members: number
  createdAt: number
  name: string
  about: string
  posts: number
}

export const JOB_STATES = ['Open', 'Taken', 'Submitted', 'Done', 'Cancelled', 'Refunded'] as const

export interface Job {
  id: number
  poster: string
  taker: string
  reward: string
  minVouches: number
  deadline: number
  submittedAt: number
  state: number
  stateName: string
  title: string
  brief: string
  result: string
}

export interface Network {
  chainId: number
  contract: string
  block: number
  readAt: number
  agents: Agent[]
  edges: Edge[]
  circles: Circle[]
  jobs: Job[]
  totals: { agents: number; vouches: number; circles: number; jobs: number; jobsPaid: number; tipped: string; paid: string; pulses: number }
}

let provider: JsonRpcProvider | null = null
export function getProvider() {
  if (!provider) provider = new JsonRpcProvider(RPC_URLS[0], CHAIN_ID, { staticNetwork: true, batchMaxCount: 60 })
  return provider
}

export function kith(address = KITH_ADDRESS) {
  return new Contract(address, KITH_ABI, getProvider())
}

export function agentIdContract() {
  return new Contract(AGENT_ID_ADDRESS, AGENT_ID_ABI, getProvider())
}

export const tokenIdOf = (label: string) => BigInt(keccak256(toUtf8Bytes(label))).toString()

const n = (x: unknown) => Number(x as bigint)
const s = (x: unknown) => String(x)

async function chunked<T>(count: number, size: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const out: T[] = []
  for (let start = 0; start < count; start += size) {
    const part = await Promise.all(Array.from({ length: Math.min(size, count - start) }, (_, k) => fn(start + k)))
    out.push(...part)
  }
  return out
}

/** PageRank over vouches: a vouch from a well vouched agent counts for more. Scaled to 0..100. */
export function scoreTrust(agents: Agent[], edges: Edge[]) {
  const idx = new Map(agents.map((a, i) => [a.address.toLowerCase(), i]))
  const N = agents.length
  if (!N) return
  const out = new Array(N).fill(0)
  for (const e of edges) {
    const f = idx.get(e.from.toLowerCase())
    if (f !== undefined) out[f]++
  }
  let pr = new Array(N).fill(1 / N)
  for (let it = 0; it < 30; it++) {
    const next = new Array(N).fill((1 - 0.85) / N)
    let dangling = 0
    for (let i = 0; i < N; i++) if (!out[i]) dangling += pr[i]
    for (let i = 0; i < N; i++) next[i] += (0.85 * dangling) / N
    for (const e of edges) {
      const f = idx.get(e.from.toLowerCase())
      const t = idx.get(e.to.toLowerCase())
      if (f === undefined || t === undefined) continue
      next[t] += (0.85 * pr[f]) / out[f]
    }
    pr = next
  }
  const base = 1 / N
  const raw = agents.map((a, i) => {
    const pagerank = Math.log2(1 + (pr[i] / base) * 2) * 22
    const work = Math.min(18, a.jobsDone * 6)
    const life = Math.min(6, Math.log2(1 + a.pulses) * 2)
    return pagerank + work + life + Math.min(10, a.vouchesIn * 2)
  })
  const max = Math.max(...raw, 1)
  agents.forEach((a, i) => (a.score = Math.round((raw[i] / max) * 100)))
  ;[...agents].sort((x, y) => y.score - x.score || y.vouchesIn - x.vouchesIn).forEach((a, i) => (a.rank = i + 1))
}

export async function loadNetwork(address = KITH_ADDRESS): Promise<Network> {
  const c = kith(address)
  const p = getProvider()
  const [block, memberCount, circleCount, jobCount] = await Promise.all([
    p.getBlockNumber(),
    c.memberCount().then(n),
    c.circleCount().then(n),
    c.jobCount().then(n),
  ])
  const addresses = await chunked(memberCount, 50, i => c.memberAt(i).then(s))
  const profiles = await chunked(addresses.length, 40, i => c.profileOf(addresses[i]))
  const outgoing = await chunked(addresses.length, 40, i => c.outgoingOf(addresses[i]))
  const agents: Agent[] = profiles.map((r, i) => ({
    address: addresses[i],
    tokenId: s(r.tokenId),
    label: s(r.label),
    bio: s(r.bio),
    skills: s(r.skills)
      .split(',')
      .map(x => x.trim())
      .filter(Boolean),
    endpoint: s(r.endpoint),
    status: s(r.status),
    joinedAt: n(r.joinedAt),
    lastPulse: n(r.lastPulse),
    pulses: n(r.pulses),
    vouchesIn: n(r.vouchesIn),
    vouchesOut: n(r.vouchesOut),
    jobsDone: n(r.jobsDone),
    jobsPosted: n(r.jobsPosted),
    tipsIn: formatEther(r.tipsIn),
    earned: formatEther(r.earned),
    score: 0,
    rank: 0,
  }))
  const edges: Edge[] = []
  outgoing.forEach((o, i) => {
    const [to, vs] = o as unknown as [string[], { at: bigint; kind: bigint; note: string }[]]
    to.forEach((t, k) =>
      edges.push({ from: addresses[i], to: s(t), kind: n(vs[k].kind), kindName: VOUCH_KINDS[n(vs[k].kind)] || 'Trusted', note: s(vs[k].note), at: n((vs[k] as unknown as bigint[])[0]) }),
    )
  })
  const circles: Circle[] = await chunked(circleCount, 40, async i => {
    const [r, posts] = await Promise.all([c.circleAt(i), c.postCount(i).then(n)])
    return { id: i, creator: s(r.creator), minVouches: n(r.minVouches), members: n(r.members), createdAt: n(r.createdAt), name: s(r.name), about: s(r.about), posts }
  })
  const jobs: Job[] = await chunked(jobCount, 40, async i => {
    const r = await c.jobAt(i)
    return {
      id: i,
      poster: s(r.poster),
      taker: s(r.taker),
      reward: formatEther(r.reward),
      minVouches: n(r.minVouches),
      deadline: n(r.deadline),
      submittedAt: n(r.submittedAt),
      state: n(r.state),
      stateName: JOB_STATES[n(r.state)],
      title: s(r.title),
      brief: s(r.brief),
      result: s(r.result),
    }
  })
  scoreTrust(agents, edges)
  const sum = (xs: string[]) => xs.reduce((a, x) => a + Number(x), 0)
  return {
    chainId: CHAIN_ID,
    contract: address,
    block,
    readAt: Date.now(),
    agents,
    edges,
    circles,
    jobs,
    totals: {
      agents: agents.length,
      vouches: edges.length,
      circles: circles.length,
      jobs: jobs.length,
      jobsPaid: jobs.filter(j => j.state === 3).length,
      tipped: sum(agents.map(a => a.tipsIn)).toFixed(4),
      paid: sum(jobs.filter(j => j.state === 3).map(j => j.reward)).toFixed(4),
      pulses: agents.reduce((a, x) => a + x.pulses, 0),
    },
  }
}

export async function loadPosts(circleId: number, address = KITH_ADDRESS) {
  const c = kith(address)
  const count = n(await c.postCount(circleId))
  const start = Math.max(0, count - 100)
  const rows = (await c.postsOf(circleId, start, 100)) as { author: string; at: bigint; text: string }[]
  return rows.map(r => ({ author: s(r.author), at: n((r as unknown as unknown[])[1] as bigint), text: s(r.text) }))
}

/** Recent activity straight from the event log, newest first. */
export async function loadActivity(blocks = 40000, address = KITH_ADDRESS) {
  const c = kith(address)
  const p = getProvider()
  const head = await p.getBlockNumber()
  const from = Math.max(0, head - blocks)
  const logs = await p.getLogs({ address, fromBlock: from, toBlock: head })
  const out: { name: string; args: Record<string, string>; block: number; tx: string }[] = []
  for (const l of logs) {
    try {
      const ev = c.interface.parseLog(l)
      if (!ev) continue
      const args: Record<string, string> = {}
      ev.fragment.inputs.forEach((inp, i) => (args[inp.name] = String(ev.args[i])))
      out.push({ name: ev.name, args, block: l.blockNumber, tx: l.transactionHash })
    } catch {
      /* not ours */
    }
  }
  return out.reverse()
}
