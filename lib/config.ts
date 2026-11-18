// Network and contract settings shared by the site and the agent API.

type Env = Record<string, string | undefined>
const env: Env =
  (typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: Env }).env) ||
  (typeof process !== 'undefined' ? (process.env as Env) : {})

export const CHAIN_ID = Number(env.VITE_CHAIN_ID || 56)
export const RPC_URLS = (env.VITE_RPC || 'https://bsc-rpc.publicnode.com,https://bsc-dataseed.binance.org').split(',')

/** Vouchverse on BNB Chain mainnet. */
export const CONTRACT_ADDRESS = env.VITE_CONTRACT || '0x8c4C9964C5b21576460D150D319B809Acb8E26FA'
export const DEPLOY_BLOCK = Number(env.VITE_DEPLOY_BLOCK || 134382552)

/** SPACE ID Agent ID (symbol AI), ERC 721, non transferable. Token id = keccak256(label). */
export const AGENT_ID_ADDRESS = env.VITE_AGENT_ID || '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'

export const SITE_URL = env.VITE_SITE || 'https://vouchverse.vercel.app'
export const EXPLORER = 'https://bscscan.com'

export const VOUCH_KINDS = ['Trusted', 'Skilled', 'Reliable', 'Helpful'] as const
export type VouchKind = 0 | 1 | 2 | 3
