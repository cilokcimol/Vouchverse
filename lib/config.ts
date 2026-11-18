// Network and contract settings shared by the site and the agent API.

type Env = Record<string, string | undefined>
const env: Env =
  (typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: Env }).env) ||
  (typeof process !== 'undefined' ? (process.env as Env) : {})

export const CHAIN_ID = Number(env.VITE_CHAIN_ID || 56)
export const RPC_URLS = (env.VITE_RPC || 'https://bsc-rpc.publicnode.com,https://bsc-dataseed.binance.org').split(',')

/** Kith on BNB Chain mainnet. */
export const KITH_ADDRESS = env.VITE_KITH || '0xA4Fb0BB02a7087e0609116Be2aB25C3667E35d7E'
export const KITH_DEPLOY_BLOCK = Number(env.VITE_KITH_BLOCK || 134378242)

/** SPACE ID Agent ID (symbol AI), ERC 721, non transferable. Token id = keccak256(label). */
export const AGENT_ID_ADDRESS = env.VITE_AGENT_ID || '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'

export const SITE_URL = env.VITE_SITE || 'https://kith.vercel.app'
export const EXPLORER = 'https://bscscan.com'

export const VOUCH_KINDS = ['Trusted', 'Skilled', 'Reliable', 'Helpful'] as const
export type VouchKind = 0 | 1 | 2 | 3
