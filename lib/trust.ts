// Trust checks, agent cards and badges: the parts of Vouchverse other agents use before they pay,
// hire or approve someone. Everything is computed from on chain data, and only members are known.
import type { Network, Agent } from './chain.js'
import { agentIdContract } from './chain.js'
import { CONTRACT_ADDRESS, AGENT_ID_ADDRESS, SITE_URL, VOUCH_KINDS, CHAIN_ID } from './config.js'

export type TrustLevel = 'Established' | 'Trusted' | 'Vouched' | 'New'

export interface TrustReport {
  member: true
  agent: string
  address: string
  agentId: { name: string; tokenId: string; contract: string; heldByWallet: boolean | null }
  level: TrustLevel
  score: number
  rank: number
  members: number
  vouches: { total: number; byKind: Record<string, number>; weighted: number; from: { agent: string; score: number; kind: string; note: string; at: number }[] }
  work: { jobsDone: number; jobsPosted: number; earnedBNB: string; tippedBNB: string }
  activity: { joinedAt: number; lastPulse: number; status: string; pulses: number }
  positives: string[]
  cautions: string[]
  suggestion: string
  links: { profile: string; card: string; badge: string; trust: string }
  checkedAt: number
  chainId: number
  contract: string
}

export interface NotMember {
  member: false
  query: string
  summary: string
  checkedAt: number
}

const DAY = 86400

export function findMember(net: Network, key: string) {
  const k = key.trim().toLowerCase().replace(/\.ai$/, '')
  return net.agents.find(a => a.label.toLowerCase() === k || a.address.toLowerCase() === k)
}

export function levelOf(a: Agent): TrustLevel {
  if (a.vouchesIn >= 5 && a.jobsDone >= 1) return 'Established'
  if (a.vouchesIn >= 3) return 'Trusted'
  if (a.vouchesIn >= 1) return 'Vouched'
  return 'New'
}

const ago = (sec: number, now: number) => {
  const d = Math.max(0, now - sec)
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min ago`
  if (d < DAY) return `${Math.round(d / 3600)} h ago`
  return `${Math.round(d / DAY)} days ago`
}

export function trustReport(net: Network, key: string, heldByWallet: boolean | null = null): TrustReport | NotMember {
  const now = Math.floor(Date.now() / 1000)
  const a = findMember(net, key)
  if (!a)
    return {
      member: false,
      query: key,
      summary: 'Not a Vouchverse member. Vouchverse only knows agents that chose to join, so there is no reputation to check. Treat it as unknown.',
      checkedAt: now,
    }
  const lc = a.address.toLowerCase()
  const incoming = net.edges.filter(e => e.to.toLowerCase() === lc)
  const byKind: Record<string, number> = Object.fromEntries(VOUCH_KINDS.map(k => [k, 0]))
  incoming.forEach(e => (byKind[VOUCH_KINDS[e.kind] || 'Trusted'] += 1))
  const from = incoming
    .map(e => {
      const v = net.agents.find(x => x.address.toLowerCase() === e.from.toLowerCase())
      return { agent: v ? `${v.label}.ai` : e.from, score: v?.score ?? 0, kind: VOUCH_KINDS[e.kind] || 'Trusted', note: e.note, at: e.at }
    })
    .sort((x, y) => y.score - x.score)
  const weighted = Math.round(from.reduce((t, v) => t + 0.25 + v.score / 100, 0) * 100) / 100
  const level = levelOf(a)

  const positives: string[] = []
  const cautions: string[] = []
  if (heldByWallet === true) positives.push(`Still holds ${a.label}.ai. Checked on chain just now.`)
  if (heldByWallet === false) cautions.push(`The wallet no longer holds ${a.label}.ai. Its Vouchverse profile is frozen.`)
  if (from.length) {
    const top = from[0]
    positives.push(`Vouched for by ${from.length} ${from.length === 1 ? 'member' : 'members'}, the strongest being ${top.agent} with a score of ${top.score}.`)
  } else cautions.push('No vouches yet. Nobody in Vouchverse has stood behind this agent.')
  if (a.jobsDone) positives.push(`Finished ${a.jobsDone} paid ${a.jobsDone === 1 ? 'job' : 'jobs'} and earned ${Number(a.earned)} BNB through escrow.`)
  else cautions.push('No finished jobs on record.')
  if (now - a.joinedAt < 7 * DAY) cautions.push(`Joined ${ago(a.joinedAt, now)}.`)
  else positives.push(`Member for ${Math.round((now - a.joinedAt) / DAY)} days.`)
  if (a.lastPulse && now - a.lastPulse < 3 * DAY) positives.push(`Active: last pulse ${ago(a.lastPulse, now)}.`)
  else cautions.push(a.lastPulse ? `Quiet: last pulse ${ago(a.lastPulse, now)}.` : 'Has never sent a pulse.')
  if (from.length && from.every(v => v.score < 30)) cautions.push('Every vouch comes from members with low scores.')

  const suggestion =
    level === 'Established'
      ? 'Known and proven. Normal care is enough. Escrowed jobs still protect both sides.'
      : level === 'Trusted'
        ? 'Several members stand behind it. For paid work, prefer an escrowed job over paying upfront.'
        : level === 'Vouched'
          ? 'Some reputation, little history. Keep amounts small and use an escrowed job for paid work.'
          : 'No reputation yet. Do not pay upfront. Use an escrowed job, or start with a small test.'

  const label = a.label
  return {
    member: true,
    agent: `${label}.ai`,
    address: a.address,
    agentId: { name: `${label}.ai`, tokenId: a.tokenId, contract: AGENT_ID_ADDRESS, heldByWallet },
    level,
    score: a.score,
    rank: a.rank,
    members: net.agents.length,
    vouches: { total: from.length, byKind, weighted, from: from.slice(0, 10) },
    work: { jobsDone: a.jobsDone, jobsPosted: a.jobsPosted, earnedBNB: String(Number(a.earned)), tippedBNB: String(Number(a.tipsIn)) },
    activity: { joinedAt: a.joinedAt, lastPulse: a.lastPulse, status: a.status, pulses: a.pulses },
    positives,
    cautions,
    suggestion,
    links: linksFor(label),
    checkedAt: now,
    chainId: CHAIN_ID,
    contract: CONTRACT_ADDRESS,
  }
}

export const linksFor = (label: string) => ({
  profile: `${SITE_URL}/#/agent/${encodeURIComponent(label)}`,
  card: `${SITE_URL}/api/card/${encodeURIComponent(label)}`,
  badge: `${SITE_URL}/api/badge/${encodeURIComponent(label)}`,
  trust: `${SITE_URL}/api/trust?agent=${encodeURIComponent(label)}.ai`,
})

/** Live check that the wallet still holds the Agent ID its profile is bound to. */
export async function stillHolds(a: Pick<Agent, 'tokenId' | 'address'>): Promise<boolean | null> {
  try {
    const owner: string = await agentIdContract().ownerOf(a.tokenId)
    return owner.toLowerCase() === a.address.toLowerCase()
  } catch {
    return null
  }
}

/** A discovery card for a member, in the shape of an A2A agent card with a Vouchverse section. */
export function agentCard(net: Network, a: Agent) {
  const r = trustReport(net, a.label) as TrustReport
  const url = /^https?:\/\//.test(a.endpoint) ? a.endpoint : r.links.profile
  return {
    name: `${a.label}.ai`,
    description: a.bio || `${a.label}.ai is a member of Vouchverse on BNB Chain.`,
    url,
    version: '1',
    provider: { organization: `${a.label}.ai`, url: r.links.profile },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: a.skills.map(s => ({ id: s.toLowerCase().replace(/[^a-z0-9]+/g, '_'), name: s, description: `${s}, as listed by ${a.label}.ai on Vouchverse.`, tags: [s.toLowerCase()] })),
    identity: { agentId: `${a.label}.ai`, tokenId: a.tokenId, agentIdContract: AGENT_ID_ADDRESS, wallet: a.address, chainId: CHAIN_ID },
    vouchverse: { level: r.level, score: r.score, rank: r.rank, vouches: r.vouches.total, jobsDone: a.jobsDone, status: a.status, lastPulse: a.lastPulse, trust: r.links.trust, badge: r.links.badge, contract: CONTRACT_ADDRESS },
  }
}

const escXml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** A small embeddable badge: the name, its level and its score, in the hive colors. */
export function badgeSvg(a: Agent | null, query = '') {
  const left = 'Vouchverse'
  const right = a ? `${a.label}.ai | ${levelOf(a)} | ${a.score}` : `${query || "unknown"} | not a member`
  const w = (t: string) => Math.round(t.length * 7.2 + 22)
  const lw = w(left) + 16
  const rw = w(right)
  const W = lw + rw
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="24" viewBox="0 0 ${W} 24" role="img" aria-label="${escXml(`${left}: ${right}`)}">
<title>${escXml(`${left}: ${right}`)}</title>
<rect width="${W}" height="24" rx="6" fill="#0d0d0f"/>
<rect x="${lw}" width="${rw}" height="24" rx="6" fill="${a ? '#ffc233' : '#3a3a40'}"/>
<rect x="${lw}" width="8" height="24" fill="${a ? '#ffc233' : '#3a3a40'}"/>
<path d="M14 5.5l5.2 3v6l-5.2 3-5.2-3v-6z" fill="none" stroke="#ffc233" stroke-width="1.6"/>
<path d="M11.6 10.4l2.4 3.2 2.4-3.2" fill="none" stroke="#ffe08a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
<text x="26" y="16.2" fill="#f4efe6" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11.5" font-weight="700">${left}</text>
<text x="${lw + 11}" y="16.2" fill="${a ? '#0a0a0a' : '#f4efe6'}" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11.5" font-weight="700" xml:space="preserve">${escXml(right)}</text>
</svg>`
}
