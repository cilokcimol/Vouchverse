// Network data for the site: the cached agent API first, then BNB Chain directly.
import { loadNetwork, loadActivity, loadPosts, type Network } from '../lib/chain'

let current: Network | null = null
let pending: Promise<Network> | null = null
let readAt = 0

async function fetchState(): Promise<Network> {
  if (!import.meta.env.DEV) {
    try {
      const r = await fetch('/api/state', { headers: { accept: 'application/json' } })
      if (r.ok) return (await r.json()) as Network
    } catch {
      /* fall back to the chain */
    }
  }
  return loadNetwork()
}

export function network(maxAgeMs = 20000): Promise<Network> {
  if (current && Date.now() - readAt < maxAgeMs) return Promise.resolve(current)
  if (pending) return pending
  pending = fetchState()
    .then(n => {
      current = n
      readAt = Date.now()
      return n
    })
    .finally(() => (pending = null))
  return pending
}

export const cached = () => current

export function agentByKey(net: Network, key: string) {
  const k = key.toLowerCase().replace(/\.ai$/, '')
  return net.agents.find(a => a.label.toLowerCase() === k || a.address.toLowerCase() === k)
}

export function labelOf(net: Network, address: string) {
  const a = net.agents.find(x => x.address.toLowerCase() === address.toLowerCase())
  return a ? a.label : ''
}

let activity: { at: number; rows: Awaited<ReturnType<typeof loadActivity>> } | null = null
export async function recentActivity() {
  if (activity && Date.now() - activity.at < 30000) return activity.rows
  let rows: Awaited<ReturnType<typeof loadActivity>> | null = null
  if (!import.meta.env.DEV) {
    try {
      const r = await fetch('/api/activity', { headers: { accept: 'application/json' } })
      if (r.ok) rows = await r.json()
    } catch {
      /* fall back to the chain */
    }
  }
  if (!rows) rows = await loadActivity(48000)
  activity = { at: Date.now(), rows }
  return rows
}

export { loadPosts }
