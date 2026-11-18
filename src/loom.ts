// The loom: every Kith agent as a knot of light, every vouch as a colored thread between them.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import type { Network } from '../lib/chain'
import { KIND_HEX } from './ui'

interface Opts {
  onPick?: (label: string) => void
  tooltip?: HTMLElement
  orbit?: boolean
  offsetX?: number
}

interface Node {
  key: string
  label: string
  score: number
  vouches: number
  p: THREE.Vector3
  v: THREE.Vector3
  ghost?: boolean
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296
}

/** A small 3D force layout: nodes repel, threads pull, everything drifts toward the center. */
function layout(nodes: Node[], links: [number, number][], iters = 260) {
  const n = nodes.length
  const k = 2.2
  for (let it = 0; it < iters; it++) {
    const cool = 1 - it / iters
    for (let i = 0; i < n; i++) {
      const a = nodes[i]
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j]
        const d = a.p.clone().sub(b.p)
        const l2 = Math.max(0.05, d.lengthSq())
        const f = (k * k) / l2
        d.normalize().multiplyScalar(f * 0.02)
        a.v.add(d)
        b.v.sub(d)
      }
    }
    for (const [i, j] of links) {
      const a = nodes[i]
      const b = nodes[j]
      const d = b.p.clone().sub(a.p)
      const l = d.length()
      d.normalize().multiplyScalar((l - k * 1.4) * 0.03)
      a.v.add(d)
      b.v.sub(d)
    }
    for (const a of nodes) {
      a.v.addScaledVector(a.p, -0.006)
      a.v.multiplyScalar(0.82)
      a.p.addScaledVector(a.v, cool)
    }
  }
}

export function mountLoom(canvas: HTMLCanvasElement, net: Network | null, opts: Opts = {}) {
  const mobile = matchMedia('(pointer: coarse)').matches
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0f1430)
  scene.fog = new THREE.FogExp2(0x0f1430, 0.018)
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400)
  camera.position.set(0, 4, 34)
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.32)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.enablePan = false
  controls.enableZoom = !!opts.orbit
  controls.enableRotate = true
  controls.minDistance = 10
  controls.maxDistance = 70
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.35
  if (!opts.orbit) {
    controls.enableRotate = !mobile
    controls.minPolarAngle = Math.PI * 0.32
    controls.maxPolarAngle = Math.PI * 0.68
  }

  const world = new THREE.Group()
  scene.add(world)

  // drifting fibers in the background
  const dustN = mobile ? 500 : 1400
  const dust = new THREE.BufferGeometry()
  const dp = new Float32Array(dustN * 3)
  const rnd = hash('kith-dust')
  for (let i = 0; i < dustN; i++) dp.set([(rnd() - 0.5) * 120, (rnd() - 0.5) * 70, (rnd() - 0.5) * 120], i * 3)
  dust.setAttribute('position', new THREE.BufferAttribute(dp, 3))
  const dustPts = new THREE.Points(dust, new THREE.PointsMaterial({ color: 0x9b8fd6, size: 0.12, transparent: true, opacity: 0.5, depthWrite: false }))
  scene.add(dustPts)

  let nodeMesh: THREE.InstancedMesh | null = null
  let threads: THREE.LineSegments | null = null
  let nodes: Node[] = []
  const threadMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uFocus: { value: -1 } },
    vertexShader: /* glsl */ `
      attribute float aT; attribute float aSeed; attribute vec3 aColor; attribute float aA; attribute float aB;
      varying float vT; varying float vSeed; varying vec3 vColor; varying float vHit;
      uniform float uFocus;
      void main() {
        vT = aT; vSeed = aSeed; vColor = aColor;
        vHit = (uFocus >= 0.0 && (abs(aA - uFocus) < 0.5 || abs(aB - uFocus) < 0.5)) ? 1.0 : (uFocus >= 0.0 ? -1.0 : 0.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying float vT; varying float vSeed; varying vec3 vColor; varying float vHit;
      void main() {
        float flow = fract(vT - uTime * (0.12 + vSeed * 0.1) + vSeed);
        float bead = smoothstep(0.0, 0.08, flow) * smoothstep(0.22, 0.08, flow);
        float base = 0.22 + bead * 1.8;
        float a = mix(base, base * 2.2, max(vHit, 0.0));
        if (vHit < 0.0) a *= 0.18;
        gl_FragColor = vec4(vColor * a, 1.0);
      }`,
  })
  const nodeMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
  scene.add(new THREE.AmbientLight(0xb8b0ff, 0.7))
  const key = new THREE.PointLight(0xffd39a, 60, 80)
  key.position.set(12, 14, 20)
  scene.add(key)

  function build(n: Network | null) {
    if (nodeMesh) {
      world.remove(nodeMesh)
      nodeMesh.geometry.dispose()
    }
    if (threads) {
      world.remove(threads)
      threads.geometry.dispose()
    }
    const agents = n?.agents || []
    const ghost = agents.length === 0
    nodes = ghost
      ? Array.from({ length: 54 }, (_, i) => ({ key: `g${i}`, label: '', score: 10 + (i % 7) * 8, vouches: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), ghost: true }))
      : agents.map(a => ({ key: a.address.toLowerCase(), label: a.label, score: a.score, vouches: a.vouchesIn, p: new THREE.Vector3(), v: new THREE.Vector3() }))
    const idx = new Map(nodes.map((x, i) => [x.key, i]))
    for (const x of nodes) {
      const r = hash(x.key)
      x.p.set((r() - 0.5) * 18, (r() - 0.5) * 12, (r() - 0.5) * 18)
    }
    let links: [number, number, number][] = []
    if (ghost) {
      const r = hash('ghost')
      for (let i = 0; i < nodes.length; i++) for (let k = 0; k < 2; k++) links.push([i, Math.floor(r() * nodes.length), Math.floor(r() * 4)])
      links = links.filter(([a, b]) => a !== b)
    } else {
      for (const e of n!.edges) {
        const a = idx.get(e.from.toLowerCase())
        const b = idx.get(e.to.toLowerCase())
        if (a !== undefined && b !== undefined) links.push([a, b, e.kind])
      }
    }
    layout(nodes, links.map(([a, b]) => [a, b]))
    // center and fit
    const c = new THREE.Vector3()
    nodes.forEach(x => c.add(x.p))
    c.divideScalar(Math.max(1, nodes.length))
    let rad = 1
    nodes.forEach(x => {
      x.p.sub(c)
      rad = Math.max(rad, x.p.length())
    })
    const fit = 13 / rad
    nodes.forEach(x => x.p.multiplyScalar(Math.min(1.6, fit)))

    const geo = new THREE.IcosahedronGeometry(1, 3)
    nodeMesh = new THREE.InstancedMesh(geo, nodeMat, nodes.length)
    const m4 = new THREE.Matrix4()
    const col = new THREE.Color()
    nodes.forEach((x, i) => {
      const s = ghost ? 0.18 : 0.22 + (x.score / 100) * 0.62
      m4.compose(x.p, new THREE.Quaternion(), new THREE.Vector3(s, s, s))
      nodeMesh!.setMatrixAt(i, m4)
      if (ghost) col.setRGB(0.35, 0.36, 0.6)
      else col.set(x.score > 70 ? 0xf2a541 : x.score > 35 ? 0xefe8dc : 0x9b8fd6)
      nodeMesh!.setColorAt(i, col)
    })
    nodeMesh.instanceColor!.needsUpdate = true
    world.add(nodeMesh)

    const seg = 22
    const pos: number[] = []
    const ts: number[] = []
    const seeds: number[] = []
    const cols: number[] = []
    const as: number[] = []
    const bs: number[] = []
    const kc = KIND_HEX.map(h => new THREE.Color(h))
    links.forEach(([a, b, kind], li) => {
      const A = nodes[a].p
      const B = nodes[b].p
      const mid = A.clone().add(B).multiplyScalar(0.5)
      const bend = mid.clone().normalize().multiplyScalar(A.distanceTo(B) * 0.18 + 0.4)
      const ctrl = mid.add(bend)
      const curve = new THREE.QuadraticBezierCurve3(A, ctrl, B)
      const pts = curve.getPoints(seg)
      const sd = hash(`${a}-${b}-${li}`)()
      const cc = ghost ? new THREE.Color(0x3a4486) : kc[kind] || kc[0]
      for (let i = 0; i < seg; i++) {
        pos.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z)
        ts.push(i / seg, (i + 1) / seg)
        seeds.push(sd, sd)
        cols.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b)
        as.push(a, a)
        bs.push(b, b)
      }
    })
    const tg = new THREE.BufferGeometry()
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    tg.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1))
    tg.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1))
    tg.setAttribute('aColor', new THREE.Float32BufferAttribute(cols, 3))
    tg.setAttribute('aA', new THREE.Float32BufferAttribute(as, 1))
    tg.setAttribute('aB', new THREE.Float32BufferAttribute(bs, 1))
    threads = new THREE.LineSegments(tg, threadMat)
    world.add(threads)
  }
  build(net)

  // picking
  const ray = new THREE.Raycaster()
  const ptr = new THREE.Vector2(-9, -9)
  let hover = -1
  let downAt = 0
  const tip = opts.tooltip
  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect()
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    if (tip) {
      tip.style.left = `${e.clientX - r.left}px`
      tip.style.top = `${e.clientY - r.top}px`
    }
  })
  canvas.addEventListener('pointerleave', () => ptr.set(-9, -9))
  canvas.addEventListener('pointerdown', () => (downAt = performance.now()))
  canvas.addEventListener('click', () => {
    if (performance.now() - downAt > 350) return
    if (hover >= 0 && nodes[hover] && !nodes[hover].ghost && opts.onPick) opts.onPick(nodes[hover].label)
  })

  function resize() {
    const w = canvas.clientWidth || canvas.parentElement!.clientWidth
    const h = canvas.clientHeight || canvas.parentElement!.clientHeight
    renderer.setSize(w, h, false)
    composer.setSize(w, h)
    camera.aspect = w / h
    camera.position.setLength(w < h ? 46 : 34)
    camera.updateProjectionMatrix()
    camera.setViewOffset(w, h, (opts.offsetX || 0) * (w < 760 ? 0 : w), w < h ? -h * 0.14 : 0, w, h)
  }
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)
  resize()

  const clock = new THREE.Clock()
  let raf = 0
  let visible = true
  const io = new IntersectionObserver(es => (visible = es[0].isIntersecting))
  io.observe(canvas)
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced) controls.autoRotate = false
  function frame() {
    raf = requestAnimationFrame(frame)
    if (!visible) return
    const t = clock.getElapsedTime()
    threadMat.uniforms.uTime.value = reduced ? 0 : t
    dustPts.rotation.y = t * 0.01
    world.rotation.y = Math.sin(t * 0.05) * 0.08
    controls.update()
    if (nodeMesh) {
      ray.setFromCamera(ptr, camera)
      const hit = ray.intersectObject(nodeMesh)[0]
      const h = hit?.instanceId ?? -1
      if (h !== hover) {
        hover = h
        threadMat.uniforms.uFocus.value = h >= 0 && !nodes[h]?.ghost ? h : -1
        canvas.style.cursor = h >= 0 && !nodes[h]?.ghost ? 'pointer' : ''
        controls.autoRotate = !reduced && h < 0
        if (tip) {
          if (h >= 0 && !nodes[h].ghost) {
            tip.innerHTML = `<b>${nodes[h].label}.ai</b>Kith score ${nodes[h].score}, ${nodes[h].vouches} vouches`
            tip.classList.add('on')
          } else tip.classList.remove('on')
        }
      }
    }
    composer.render()
  }
  frame()

  return {
    update(n: Network) {
      build(n)
    },
    dispose() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      controls.dispose()
      renderer.dispose()
    },
  }
}
