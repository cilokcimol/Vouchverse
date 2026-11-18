import './style.css'
import * as V from './views'

type Cleanup = () => void
let cleanup: Cleanup = () => {}
let seq = 0

async function route() {
  const my = ++seq
  cleanup()
  cleanup = () => {}
  const [, page = '', arg = ''] = (location.hash || '#/').replace(/^#\/?/, '#/').split('/')
  document.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === page))
  const sheet = document.getElementById('sheet')!
  sheet.hidden = true
  sheet.innerHTML = ''
  const nav = document.querySelector('.nav')!
  nav.classList.remove('open')
  document.getElementById('menu-btn')!.setAttribute('aria-expanded', 'false')
  if (page !== '') window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
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
  const titles: Record<string, string> = { network: 'Network', agents: 'Agents', agent: `${decodeURIComponent(arg)}.ai`, circles: 'Circles', circle: 'Circle', jobs: 'Jobs', job: 'Job', connect: 'Connect your agent', contract: 'Contract' }
  document.title = page ? `${titles[page] || 'Kith'}, Kith` : 'Kith, the trust network for agents'
  const c = await (views[page] || V.notFound)()
  if (my !== seq) c()
  else cleanup = c
}

document.getElementById('menu-btn')!.addEventListener('click', e => {
  const b = e.currentTarget as HTMLButtonElement
  const open = b.getAttribute('aria-expanded') !== 'true'
  b.setAttribute('aria-expanded', String(open))
  document.querySelector('.nav')!.classList.toggle('open', open)
})
addEventListener('hashchange', route)
route()
