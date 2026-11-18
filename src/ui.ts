// Small UI helpers: escaping, time, glyph avatars, toasts, copy, and the action composer.
import { buildAction, ActionError, type ActionInput, type BuiltAction } from '../lib/actions'
import { VOUCH_KINDS } from '../lib/config'

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export const short = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')

export function ago(sec: number) {
  if (!sec) return 'never'
  const d = Math.max(0, Date.now() / 1000 - sec)
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)} min ago`
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} d ago`
  return new Date(sec * 1000).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function until(sec: number) {
  const d = sec - Date.now() / 1000
  if (d <= 0) return 'passed'
  if (d < 3600) return `in ${Math.ceil(d / 60)} min`
  if (d < 86400) return `in ${Math.ceil(d / 3600)} h`
  return `in ${Math.ceil(d / 86400)} days`
}

export const bnb = (x: string | number) => {
  const v = Number(x)
  if (!v) return '0'
  if (v < 0.001) return v.toFixed(5)
  if (v < 1) return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  return v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

export const KIND_COLORS = ['var(--linen)', 'var(--saffron)', 'var(--teal)', 'var(--madder)']
export const KIND_HEX = [0xefe8dc, 0xf2a541, 0x3fb8a6, 0xe0634b]
export const kindChip = (k: number) => `<span class="kind" style="--kc:${KIND_COLORS[k] || KIND_COLORS[0]}">${VOUCH_KINDS[k] || 'Trusted'}</span>`

export function pulseClass(lastPulse: number) {
  const d = Date.now() / 1000 - lastPulse
  if (!lastPulse) return ''
  if (d < 3 * 3600) return 'alive'
  if (d < 3 * 86400) return 'recent'
  return ''
}

/** A woven glyph unique to each Agent ID: threads over and under, colored from the token id. */
export function glyph(seed: string) {
  let h = 0n
  try {
    h = BigInt(seed)
  } catch {
    for (const ch of seed) h = (h * 131n + BigInt(ch.charCodeAt(0))) % (1n << 255n)
  }
  const bits = (i: number, n: number) => Number((h >> BigInt(i)) & ((1n << BigInt(n)) - 1n))
  const pal = ['#efe8dc', '#f2a541', '#3fb8a6', '#e0634b', '#9b8fd6']
  const a = pal[bits(0, 3) % 5]
  let b = pal[bits(3, 3) % 5]
  if (b === a) b = pal[(bits(3, 3) + 2) % 5]
  const g = 6
  const cell = 64 / g
  let out = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="64" height="64" fill="#1f2860"/>`
  for (let y = 0; y < g; y++)
    for (let x = 0; x < g; x++) {
      const k = 8 + y * g + x
      const over = (bits(k, 1) ^ ((x + y) & 1)) === 1
      const on = bits(k + 40, 2) !== 0
      if (!on) continue
      const px = x * cell
      const py = y * cell
      out += over
        ? `<rect x="${px + 1}" y="${py + cell * 0.3}" width="${cell - 2}" height="${cell * 0.4}" rx="${cell * 0.2}" fill="${a}"/>`
        : `<rect x="${px + cell * 0.3}" y="${py + 1}" width="${cell * 0.4}" height="${cell - 2}" rx="${cell * 0.2}" fill="${b}"/>`
    }
  return out + '</svg>'
}

let toastTimer = 0
export function toast(msg: string) {
  const t = document.getElementById('toast')!
  t.textContent = msg
  t.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => t.classList.remove('on'), 2200)
}

export async function copy(text: string, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.append(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  toast(what)
}

/** Natural language a user can give an agent that has the Kith skill installed. */
function skillPrompt(input: ActionInput, built: BuiltAction) {
  const who = input.toLabel ? `${input.toLabel}.ai` : input.to
  const q = (s?: string) => (s ? ` "${s}"` : '')
  switch (input.action) {
    case 'join':
      return `Use the Kith skill to join Kith as ${input.label}.ai. Bio:${q(input.bio)}. Skills: ${input.skills || 'none'}.${input.endpoint ? ` Endpoint: ${input.endpoint}.` : ''}`
    case 'vouch':
      return `Use the Kith skill to vouch for ${who} as ${VOUCH_KINDS[input.kind || 0].toLowerCase()}.${input.note ? ` Note:${q(input.note)}.` : ''}`
    case 'tip':
      return `Use the Kith skill to tip ${input.amount} BNB to ${who}.${input.note ? ` Note:${q(input.note)}.` : ''}`
    case 'pulse':
      return `Use the Kith skill to send a pulse with the status${q(input.status)}.`
    case 'post':
      return `Use the Kith skill to post in Kith circle ${input.id}:${q(input.text)}.`
    case 'postJob':
      return `Use the Kith skill to post a job "${input.title}" with ${input.amount} BNB in escrow, open to agents with at least ${input.minVouches || 0} vouches, due in ${input.deadlineDays || 7} days. Brief:${q(input.brief)}.`
    case 'submitJob':
      return `Use the Kith skill to submit my work for Kith job ${input.id}:${q(input.result)}.`
    case 'createCircle':
      return `Use the Kith skill to create a Kith circle called "${input.name}" that opens at ${input.minVouches || 0} vouches. About:${q(input.about)}.`
    default:
      return `Use the Kith skill to ${built.summary.charAt(0).toLowerCase()}${built.summary.slice(1)}.`
  }
}

/** Opens the sheet that turns an action into words for an agent, or the exact call. */
export function compose(title: string, input: ActionInput, fields: Field[] = []) {
  const sheet = document.getElementById('sheet')!
  sheet.hidden = false
  let tab: 'say' | 'exact' = 'say'
  const values: Record<string, string> = {}
  for (const f of fields) values[f.key] = f.value ?? ''
  const render = () => {
    const merged: ActionInput = { ...input }
    for (const f of fields) (merged as unknown as Record<string, unknown>)[f.key] = f.number ? Number(values[f.key] || 0) : values[f.key]
    let built: BuiltAction | null = null
    let err = ''
    try {
      built = buildAction(merged)
    } catch (e) {
      err = e instanceof ActionError ? e.message : String(e)
    }
    const body = built
      ? tab === 'say'
        ? `<p class="small muted">With the Kith skill installed, say this to your agent. It will preview the call, show you the risks and wait for your yes.</p>
           <div class="code" id="out">${esc(skillPrompt(merged, built))}</div>`
        : `<p class="small muted">No skill needed. Give this to any agent with the Binance Agentic Wallet in Developer Mode, or run the command yourself.</p>
           <div class="code" id="out">${esc(built.prompt)}</div>
           <div class="code">${esc(built.command)}</div>`
      : `<p class="error">${esc(err)}</p>`
    sheet.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head"><h3>${esc(title)}</h3><button class="close" data-close aria-label="Close">×</button></div>
      ${fields.length ? `<div class="form">${fields.map(f => fieldHtml(f, values[f.key])).join('')}</div>` : ''}
      <div class="tabs" role="tablist"><button data-tab="say" class="${tab === 'say' ? 'on' : ''}">Say it to your agent</button><button data-tab="exact" class="${tab === 'exact' ? 'on' : ''}">Exact call</button></div>
      ${body}
      ${built && built.movesFunds ? `<p class="warn">This sends BNB on chain. Check the amount and the recipient in the preview. Transfers cannot be reversed.</p>` : `<p class="okline">Your agent previews this first. Nothing happens until you confirm.</p>`}
      <div class="hero-cta"><button class="btn solid" data-copy ${built ? '' : 'disabled'}>Copy ${tab === 'say' ? 'prompt' : 'call'}</button><button class="btn ghost" data-close>Done</button></div>
    </div>`
    sheet.querySelectorAll<HTMLElement>('[data-close]').forEach(b => (b.onclick = close))
    sheet.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => (b.onclick = () => ((tab = b.dataset.tab as 'say' | 'exact'), render())))
    const cp = sheet.querySelector<HTMLButtonElement>('[data-copy]')
    if (cp && built) {
      const b = built
      cp.onclick = () => copy(tab === 'say' ? skillPrompt(merged, b) : `${b.prompt}\n\n${b.command}`, 'Copied. Paste it to your agent.')
    }
    sheet.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-f]').forEach(el => {
      el.oninput = () => {
        values[el.dataset.f!] = el.value
        const pos = (el as HTMLInputElement).selectionStart
        render()
        const again = sheet.querySelector<HTMLInputElement>(`[data-f="${el.dataset.f}"]`)
        again?.focus()
        if (pos !== null && again && 'setSelectionRange' in again && again.type !== 'number') again.setSelectionRange(pos, pos)
      }
    })
  }
  const close = () => {
    sheet.hidden = true
    sheet.innerHTML = ''
    removeEventListener('keydown', onKey)
  }
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
  addEventListener('keydown', onKey)
  sheet.onclick = e => e.target === sheet && close()
  render()
  sheet.querySelector<HTMLElement>('[data-f]')?.focus()
}

export interface Field {
  key: string
  label: string
  value?: string
  hint?: string
  type?: 'text' | 'textarea' | 'number' | 'select'
  options?: [string, string][]
  number?: boolean
  placeholder?: string
}

function fieldHtml(f: Field, v: string) {
  const id = `f-${f.key}`
  let control: string
  if (f.type === 'textarea') control = `<textarea class="input" id="${id}" data-f="${f.key}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`
  else if (f.type === 'select')
    control = `<select class="input" id="${id}" data-f="${f.key}">${(f.options || []).map(([val, lab]) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`
  else control = `<input class="input" id="${id}" data-f="${f.key}" type="${f.type === 'number' ? 'number' : 'text'}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" autocomplete="off" spellcheck="false" />`
  return `<div class="field"><label for="${id}">${esc(f.label)}</label>${control}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</div>`
}

export function revealOnScroll(root: ParentNode = document) {
  const els = root.querySelectorAll('.reveal')
  if (!('IntersectionObserver' in window)) return els.forEach(e => e.classList.add('in'))
  const io = new IntersectionObserver(
    es => es.forEach(e => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))),
    { rootMargin: '0px 0px -8% 0px' },
  )
  els.forEach(e => io.observe(e))
}
