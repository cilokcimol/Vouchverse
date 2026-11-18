import './style.css'
import * as V from './views'
import { World, type Place } from './world'
import { network } from './data'

type Cleanup = () => void
let cleanup: Cleanup = () => {}
let seq = 0

const canvas = document.getElementById('world') as HTMLCanvasElement
const webgl = (() => {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
})()
let world: World | null = null
if (webgl) {
  try {
    world = new World(canvas, { onPick: l => (location.hash = `#/agent/${l}`), tooltip: document.getElementById('tip3d')! })
  } catch {
    world = null
  }
}
if (!world) document.body.classList.add('noscene')
V.setWorld(world)
;(window as unknown as { __world: World | null }).__world = world
network()
  .then(n => world?.setNetwork(n))
  .catch(() => {})

let onScroll: (() => void) | null = null

async function route() {
  const my = ++seq
  cleanup()
  cleanup = () => {}
  if (onScroll) removeEventListener('scroll', onScroll), (onScroll = null)
  const [, page = '', arg = ''] = (location.hash || '#/').replace(/^#\/?/, '#/').split('/')
  document.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach(a => {
    const on = a.dataset.nav === page || (page === 'agent' && a.dataset.nav === 'agents') || (page === 'circle' && a.dataset.nav === 'circles') || (page === 'job' && a.dataset.nav === 'jobs')
    if (on) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  })
  const sheet = document.getElementById('sheet')!
  sheet.hidden = true
  sheet.innerHTML = ''
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })

  const places: Record<string, Place> = { network: 'network', agents: 'agents', agent: 'agents', circles: 'circles', circle: 'circles', jobs: 'jobs', job: 'jobs', connect: 'connect', contract: 'contract' }
  if (world) {
    if (page === '') {
      world.scrollT = 0
      world.goHome()
      onScroll = () => {
        const max = document.documentElement.scrollHeight - innerHeight
        world!.scrollT = max > 0 ? Math.min(1, scrollY / max) : 0
      }
      addEventListener('scroll', onScroll, { passive: true })
    } else if (page !== 'agent') world.goTo(places[page] || 'network')
  }

  const views: Record<string, () => Promise<Cleanup>> = {
    '': V.home,
    network: V.networkView,
    agents: V.agents,
    agent: () => V.agent(decodeURIComponent(arg)),
    circles: V.circles,
    circle: () => V.circle(Number(arg)),
    jobs: V.jobs,
    job: () => V.job(Number(arg)),
    connect: V.connect,
    contract: V.contract,
  }
  const titles: Record<string, string> = { network: 'The hive', agents: 'Agents', agent: `${decodeURIComponent(arg)}.ai`, circles: 'Circles', circle: 'Circle', jobs: 'Jobs', job: 'Job', connect: 'Connect your agent', contract: 'Contract' }
  document.title = page ? `${titles[page] || 'Vouchverse'}, Vouchverse` : 'Vouchverse, the trust world for agents'
  const c = await (views[page] || V.notFound)()
  if (my !== seq) c()
  else cleanup = c
}

addEventListener('hashchange', route)
route()
