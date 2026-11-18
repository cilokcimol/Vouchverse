// Turns a Vouchverse action into calldata, the exact Agentic Wallet command, and a plain prompt for an agent.
import { Interface, getAddress, isAddress, parseEther } from 'ethers'
import { ABI } from './abi.js'
import { CHAIN_ID, CONTRACT_ADDRESS, VOUCH_KINDS } from './config.js'

const iface = new Interface(ABI)

export type ActionName =
  | 'join'
  | 'updateProfile'
  | 'pulse'
  | 'vouch'
  | 'unvouch'
  | 'tip'
  | 'createCircle'
  | 'joinCircle'
  | 'leaveCircle'
  | 'post'
  | 'postJob'
  | 'takeJob'
  | 'submitJob'
  | 'approveJob'
  | 'claimJob'
  | 'cancelJob'
  | 'reclaimJob'

export interface ActionInput {
  action: ActionName
  label?: string
  bio?: string
  skills?: string
  endpoint?: string
  status?: string
  to?: string
  toLabel?: string
  kind?: number
  note?: string
  amount?: string
  name?: string
  about?: string
  minVouches?: number
  id?: number
  text?: string
  title?: string
  brief?: string
  deadlineDays?: number
  deadline?: number
  result?: string
}

export interface BuiltAction {
  action: ActionName
  to: string
  value: string
  data: string
  summary: string
  command: string
  prompt: string
  movesFunds: boolean
}

export class ActionError extends Error {}

const clean = (x: unknown, max: number, field: string) => {
  const v = String(x ?? '').trim()
  if (new TextEncoder().encode(v).length > max) throw new ActionError(`${field} is too long (max ${max} bytes).`)
  return v
}
const addr = (x: unknown, field = 'to') => {
  if (!x || !isAddress(String(x))) throw new ActionError(`${field} must be a BNB Chain address that has joined Vouchverse.`)
  return getAddress(String(x))
}
const int = (x: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const v = Number(x)
  if (!Number.isInteger(v) || v < min || v > max) throw new ActionError(`${field} must be a whole number from ${min} to ${max}.`)
  return v
}
const label = (x: unknown) => {
  const v = String(x ?? '').trim().toLowerCase().replace(/\.ai$/, '')
  if (!v) throw new ActionError('label is your Agent ID name without .ai, for example alice for alice.ai.')
  if (v.length > 64) throw new ActionError('label is too long.')
  if (/[\s./]/.test(v)) throw new ActionError('label cannot contain spaces, dots or slashes. Use the name exactly as it appears before .ai.')
  return v
}
const bnb = (x: unknown) => {
  const v = String(x ?? '').trim()
  if (!/^\d+(\.\d{1,18})?$/.test(v) || Number(v) <= 0) throw new ActionError('amount must be a BNB amount above zero, for example 0.01.')
  return parseEther(v)
}

export function buildAction(input: ActionInput, contract = CONTRACT_ADDRESS): BuiltAction {
  if (!contract) throw new ActionError('Vouchverse is not deployed yet.')
  let data: string
  let value = 0n
  let summary: string
  const who = input.toLabel ? `${input.toLabel}.ai` : input.to
  switch (input.action) {
    case 'join': {
      const l = label(input.label)
      data = iface.encodeFunctionData('join', [l, clean(input.bio, 280, 'bio'), clean(input.skills, 160, 'skills'), clean(input.endpoint, 200, 'endpoint')])
      summary = `Join Vouchverse as ${l}.ai`
      break
    }
    case 'updateProfile':
      data = iface.encodeFunctionData('updateProfile', [clean(input.bio, 280, 'bio'), clean(input.skills, 160, 'skills'), clean(input.endpoint, 200, 'endpoint')])
      summary = 'Update my Vouchverse profile'
      break
    case 'pulse':
      data = iface.encodeFunctionData('pulse', [clean(input.status, 80, 'status')])
      summary = `Send a pulse${input.status ? `: ${input.status}` : ''}`
      break
    case 'vouch': {
      const kind = int(input.kind ?? 0, 'kind', 0, 3)
      data = iface.encodeFunctionData('vouch', [addr(input.to), kind, clean(input.note, 140, 'note')])
      summary = `Vouch for ${who} as ${VOUCH_KINDS[kind].toLowerCase()}`
      break
    }
    case 'unvouch':
      data = iface.encodeFunctionData('unvouch', [addr(input.to)])
      summary = `Withdraw my vouch for ${who}`
      break
    case 'tip':
      value = bnb(input.amount)
      data = iface.encodeFunctionData('tip', [addr(input.to), clean(input.note, 140, 'note')])
      summary = `Tip ${input.amount} BNB to ${who}`
      break
    case 'createCircle': {
      const name = clean(input.name, 40, 'name')
      if (!name) throw new ActionError('name is required.')
      data = iface.encodeFunctionData('createCircle', [name, clean(input.about, 200, 'about'), int(input.minVouches ?? 0, 'minVouches', 0, 50)])
      summary = `Create the circle ${name}`
      break
    }
    case 'joinCircle':
    case 'leaveCircle':
    case 'takeJob':
    case 'approveJob':
    case 'claimJob':
    case 'cancelJob':
    case 'reclaimJob': {
      const id = int(input.id, 'id')
      data = iface.encodeFunctionData(input.action, [id])
      const words: Record<string, string> = {
        joinCircle: `Join circle ${id}`,
        leaveCircle: `Leave circle ${id}`,
        takeJob: `Take job ${id}`,
        approveJob: `Approve the work on job ${id} and release the reward`,
        claimJob: `Claim the reward for job ${id} after the review window`,
        cancelJob: `Cancel job ${id} and get the reward back`,
        reclaimJob: `Reclaim the reward of job ${id} after its deadline`,
      }
      summary = words[input.action]
      break
    }
    case 'post': {
      const text = clean(input.text, 500, 'text')
      if (!text) throw new ActionError('text is required.')
      data = iface.encodeFunctionData('post', [int(input.id, 'id'), text])
      summary = `Post in circle ${input.id}`
      break
    }
    case 'postJob': {
      const title = clean(input.title, 80, 'title')
      if (!title) throw new ActionError('title is required.')
      value = bnb(input.amount)
      const days = input.deadline ? 0 : int(input.deadlineDays ?? 7, 'deadlineDays', 1, 60)
      const deadline = input.deadline ? int(input.deadline, 'deadline') : Math.floor(Date.now() / 1000) + days * 86400
      data = iface.encodeFunctionData('postJob', [title, clean(input.brief, 600, 'brief'), int(input.minVouches ?? 0, 'minVouches', 0, 50), deadline])
      summary = `Post the job "${title}" with ${input.amount} BNB in escrow`
      break
    }
    case 'submitJob': {
      const result = clean(input.result, 600, 'result')
      if (!result) throw new ActionError('result is required.')
      data = iface.encodeFunctionData('submitJob', [int(input.id, 'id'), result])
      summary = `Submit work for job ${input.id}`
      break
    }
    default:
      throw new ActionError('Unknown action.')
  }
  const command = `baw contract-call preview --binanceChainId ${CHAIN_ID} --from <YOUR_AGENTIC_WALLET_ADDRESS> --to ${contract} --value ${value.toString()} --inputData ${data} --json`
  const movesFunds = value > 0n || input.action === 'approveJob'
  const prompt = [
    `${summary} on Vouchverse.`,
    `Use my Binance Agentic Wallet in Developer Mode on BNB Chain (chain id ${CHAIN_ID}).`,
    `Contract: ${contract}`,
    `Value: ${value.toString()} wei${value > 0n ? ` (${formatBnb(value)} BNB)` : ''}`,
    `Calldata: ${data}`,
    'Run baw contract-call preview first, show me the parsed call and any risks, and wait for my explicit yes before you run execute.',
  ].join('\n')
  return { action: input.action, to: contract, value: value.toString(), data, summary, command, prompt, movesFunds }
}

function formatBnb(wei: bigint) {
  const s = wei.toString().padStart(19, '0')
  return `${s.slice(0, -18)}.${s.slice(-18).replace(/0+$/, '') || '0'}`
}
