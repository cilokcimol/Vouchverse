// The Hive: a planet of black hexagon cells lit from a molten gold core.
// Every member agent is a pillar of light in the Comb, every vouch an arc between two pillars,
// and every page of the site is a landmark the planet turns to face you.
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import type { Network, Agent } from '../lib/chain'

export type Place = 'home' | 'network' | 'agents' | 'circles' | 'jobs' | 'connect' | 'contract'

export const KIND_HEX = [0xf4efe6, 0xffc233, 0x4fd1c5, 0xff7a45]

const HONEY = new THREE.Color(0xffc233)
const AMBER = new THREE.Color(0xff9d00)
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const dirOf = (lat: number, lon: number) => {
  const a = THREE.MathUtils.degToRad(lat)
  const b = THREE.MathUtils.degToRad(lon)
  return v3(Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)).normalize()
}

/** Where each page lives on the planet. */
const LANDMARKS: Record<Exclude<Place, 'home' | 'network'>, THREE.Vector3> = {
  agents: dirOf(18, 0),
  circles: dirOf(42, 78),
  jobs: dirOf(-14, 148),
  connect: dirOf(-34, 222),
  contract: dirOf(14, 292),
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

function relief(d: THREE.Vector3) {
  return (
    0.5 +
    0.25 * Math.sin(d.x * 5.1 + d.y * 2.3) * Math.cos(d.z * 4.2 - d.x) +
    0.15 * Math.sin(d.y * 11.0 + d.z * 7.0) +
    0.1 * Math.cos(d.x * 17.0 - d.z * 13.0)
  )
}

interface Pose {
  pos: THREE.Vector3
  look: THREE.Vector3
  shiftX: number
  shiftY: number
}

export interface WorldOptions {
  onPick?: (label: string) => void
  tooltip?: HTMLElement
}

export class World {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200)
  composer: EffectComposer
  bloom: UnrealBloomPass
  planet = new THREE.Group()
  spin = new THREE.Group()
  scrollT = 0
  opts: WorldOptions

  private dirs: THREE.Vector3[] = []
  private base: number[] = []
  private tileR = 0.05
  private tiles!: THREE.InstancedMesh
  private caps!: THREE.InstancedMesh
  private arcs: THREE.LineSegments | null = null
  private arcMat: THREE.ShaderMaterial
  private landmarkGroups: Record<string, THREE.Group> = {}
  private memberAt = new Map<number, Agent>()
  private tileOf = new Map<string, number>()
  private heightOf = new Map<number, number>()
  private alive: number[] = []
  private ringsGroup = new THREE.Group()
  private jobCubes = new THREE.Group()
  private swarm!: THREE.Points
  private swarmSeeds!: Float32Array
  private core!: THREE.Mesh
  private atmo!: THREE.ShaderMaterial
  private mode: Place = 'home'
  private qFrom = new THREE.Quaternion()
  private qTo = new THREE.Quaternion()
  private poseFrom: Pose
  private poseTo: Pose
  private pose: Pose
  private tFly = 1
  private flyDur = 1.6
  private focusTile = -1
  private hoverTile = -1
  private pointer = new THREE.Vector2(-9, -9)
  private parallax = new THREE.Vector2()
  private ray = new THREE.Raycaster()
  private clock = new THREE.Clock()
  private raf = 0
  private visible = true
  private intro = 0
  private small: boolean

  constructor(private canvas: HTMLCanvasElement, opts: WorldOptions = {}) {
    this.opts = opts
    this.small = Math.min(innerWidth, innerHeight) < 700
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.small, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.small ? 1.5 : 1.75))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.scene.background = new THREE.Color(0x050506)
    this.scene.fog = new THREE.FogExp2(0x050506, 0.06)

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.5, 0.78)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.scene.add(new THREE.HemisphereLight(0x2a2620, 0x050505, 0.9))
    const key = new THREE.DirectionalLight(0xfff0d0, 1.3)
    key.position.set(3, 4, 5)
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0xffb020, 2.2)
    rim.position.set(-4, 1.5, -3)
    this.scene.add(rim)

    this.spin.add(this.planet)
    this.scene.add(this.spin)
    this.buildCells()
    this.buildCore()
    this.buildLandmarks()
    this.buildSwarm()
    this.buildSky()

    this.arcMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uFocus: { value: -1 } },
      vertexShader: `
        attribute float aT; attribute float aSeed; attribute vec3 aColor; attribute float aA; attribute float aB;
        uniform float uFocus; varying float vT; varying float vSeed; varying vec3 vColor; varying float vHit;
        void main() {
          vT = aT; vSeed = aSeed; vColor = aColor;
          vHit = uFocus < 0.0 ? 0.9 : ((abs(aA - uFocus) < 0.5 || abs(aB - uFocus) < 0.5) ? 1.4 : 0.12);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime; varying float vT; varying float vSeed; varying vec3 vColor; varying float vHit;
        void main() {
          float p = fract(uTime * (0.18 + vSeed * 0.22) + vSeed * 7.0);
          float bead = smoothstep(0.09, 0.0, abs(vT - p)) * 2.6;
          float a = (0.22 + bead) * vHit * smoothstep(0.0, 0.06, vT) * smoothstep(1.0, 0.94, vT);
          gl_FragColor = vec4(vColor * a, a);
        }`,
    })

    const home = this.homePose(0)
    this.pose = { pos: home.pos.clone().multiplyScalar(2.6), look: home.look.clone(), shiftX: home.shiftX, shiftY: home.shiftY }
    this.poseFrom = this.clonePose(this.pose)
    this.poseTo = home
    this.tFly = 0
    this.flyDur = 2.8
    this.intro = 1

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      this.parallax.set(this.pointer.x, this.pointer.y)
    }
    addEventListener('pointermove', onMove, { passive: true })
    canvas.addEventListener('click', () => {
      if (this.hoverTile >= 0) {
        const a = this.memberAt.get(this.hoverTile)
        if (a) this.opts.onPick?.(a.label)
      }
    })
    new ResizeObserver(() => this.resize()).observe(canvas)
    document.addEventListener('visibilitychange', () => (this.visible = !document.hidden))
    this.resize()
    this.loop()
  }

  // ------------------------------------------------------------------ build

  private buildCells() {
    const N = this.small ? 900 : 1500
    const golden = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < N; i++) {
      const y = 1 - ((i + 0.5) / N) * 2
      const r = Math.sqrt(1 - y * y)
      const phi = i * golden
      this.dirs.push(v3(Math.cos(phi) * r, y, Math.sin(phi) * r))
    }
    this.tileR = Math.sqrt((4 * Math.PI) / N / 2.598) * 0.93
    const geo = new THREE.CylinderGeometry(this.tileR, this.tileR * 0.96, 1, 6, 1)
    geo.translate(0, 0.5, 0)
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.55, flatShading: true })
    this.tiles = new THREE.InstancedMesh(geo, mat, N)
    this.tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    const capGeo = new THREE.CircleGeometry(this.tileR * 0.8, 6)
    capGeo.rotateX(-Math.PI / 2)
    this.caps = new THREE.InstancedMesh(capGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true }), N)
    this.caps.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    const plaza = Object.values(LANDMARKS)
    for (let i = 0; i < N; i++) {
      const d = this.dirs[i]
      let h = 0.035 + relief(d) * 0.05
      for (const p of plaza) if (d.angleTo(p) < 0.16) h = 0.028
      this.base.push(h)
    }
    this.layoutCells()
    this.planet.add(this.tiles, this.caps)
  }

  private layoutCells() {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = v3(0, 1, 0)
    const c = new THREE.Color()
    const now = Date.now() / 1000
    this.heightOf.clear()
    this.alive = []
    for (let i = 0; i < this.dirs.length; i++) {
      const d = this.dirs[i]
      const a = this.memberAt.get(i)
      const h = a ? 0.07 + (a.score / 100) * 0.26 : this.base[i]
      this.heightOf.set(i, h)
      q.setFromUnitVectors(up, d)
      m.compose(d.clone().multiplyScalar(0.985), q, v3(1, h + 0.015, 1))
      this.tiles.setMatrixAt(i, m)
      const shade = 0.035 + relief(d) * 0.035
      if (a) c.setRGB(0.16, 0.11, 0.025)
      else c.setRGB(shade, shade * 0.95, shade * 0.85)
      this.tiles.setColorAt(i, c)
      // caps only on members; others collapse to nothing
      if (a) {
        m.compose(d.clone().multiplyScalar(0.985 + h + 0.0155), q, v3(1, 1, 1))
        const k = 0.45 + (a.score / 100) * 1.5
        c.copy(AMBER).lerp(HONEY, a.score / 100).multiplyScalar(k)
        if (a.lastPulse && now - a.lastPulse < 3 * 3600) this.alive.push(i)
      } else {
        m.compose(d, q, v3(0, 0, 0))
        c.setRGB(0, 0, 0)
      }
      this.caps.setMatrixAt(i, m)
      this.caps.setColorAt(i, c)
    }
    this.tiles.instanceMatrix.needsUpdate = true
    this.caps.instanceMatrix.needsUpdate = true
    this.tiles.instanceColor!.needsUpdate = true
    this.caps.instanceColor!.needsUpdate = true
    this.tiles.computeBoundingSphere()
  }

  private buildCore() {
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.975, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.15, 0.52, 0.03), toneMapped: false }))
    this.planet.add(this.core)
    this.atmo = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0xffa600) }, uPow: { value: 2.4 } },
      vertexShader: `varying vec3 vN; varying vec3 vV;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uPow; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(abs(dot(vN, vV)), uPow); gl_FragColor = vec4(uColor * f * 1.1, f); }`,
    })
    this.spin.add(new THREE.Mesh(new THREE.SphereGeometry(1.2, 64, 48), this.atmo))
  }

  private onSurface(group: THREE.Group, dir: THREE.Vector3, lift = 0.03) {
    group.position.copy(dir).multiplyScalar(1 + lift)
    group.quaternion.setFromUnitVectors(v3(0, 1, 0), dir)
    this.planet.add(group)
  }

  private buildLandmarks() {
    const black = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.3, metalness: 0.85, flatShading: true })
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc233, roughness: 0.25, metalness: 1, emissive: 0xff9d00, emissiveIntensity: 0.35 })
    const glow = (k = 2.2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.72, 0.15).multiplyScalar(k), toneMapped: false })
    const edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(1, 0.7, 0.15).multiplyScalar(1.6), toneMapped: false, transparent: true, opacity: 0.85 })
    const edged = (m: THREE.Mesh) => (m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 20), edgeMat)), m)

    // Circles: halo rings that float over a plaza, one per circle.
    const circles = new THREE.Group()
    circles.add(this.ringsGroup)
    const plinth = edged(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.03, 6), black))
    plinth.position.y = 0.015
    circles.add(plinth)
    this.onSurface(circles, LANDMARKS.circles)
    this.landmarkGroups.circles = circles
    this.setRings(3, [4, 3, 2])

    // Jobs: a stepped hex exchange with orbiting crates, one per open job, and a beam of light.
    const jobs = new THREE.Group()
    for (let k = 0; k < 3; k++) {
      const s = edged(new THREE.Mesh(new THREE.CylinderGeometry(0.11 - k * 0.03, 0.12 - k * 0.03, 0.045, 6), k === 2 ? gold : black))
      s.position.y = 0.0225 + k * 0.045
      jobs.add(s)
    }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.016, 0.8, 12, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.7, 0.1).multiplyScalar(1.4), transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }))
    beam.position.y = 0.55
    jobs.add(beam, this.jobCubes)
    this.jobCubes.position.y = 0.2
    this.onSurface(jobs, LANDMARKS.jobs)
    this.landmarkGroups.jobs = jobs
    this.setJobs(3)

    // Connect: a standing gate with a swirl of light inside.
    const gate = new THREE.Group()
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 10, 6), gold)
    ring.position.y = 0.13
    ring.rotation.z = Math.PI / 6
    gate.add(ring)
    const swirlGeo = new THREE.BufferGeometry()
    const sp: number[] = []
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * 0.095
      sp.push(Math.cos(a) * r, 0.13 + Math.sin(a) * r, (Math.random() - 0.5) * 0.01)
    }
    swirlGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3))
    const swirl = new THREE.Points(swirlGeo, new THREE.PointsMaterial({ color: new THREE.Color(1.4, 1, 0.4), size: 0.008, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }))
    swirl.name = 'swirl'
    gate.add(swirl)
    for (const x of [-0.1, 0.1]) {
      const foot = edged(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.022, 0.05, 6), black))
      foot.position.set(x, 0.025, 0)
      gate.add(foot)
    }
    this.onSurface(gate, LANDMARKS.connect)
    this.landmarkGroups.connect = gate

    // Contract: the vault, a tall black monolith banded in gold with a light on top.
    const vault = new THREE.Group()
    const mono = edged(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 0.32, 6), black))
    mono.position.y = 0.16
    vault.add(mono)
    for (let k = 0; k < 4; k++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.058 - k * 0.0062, 0.0035, 6, 6), glow(1.8))
      band.rotation.x = Math.PI / 2
      band.rotation.z = Math.PI / 6
      band.position.y = 0.04 + k * 0.07
      vault.add(band)
    }
    const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.022, 0), glow(3))
    tip.position.y = 0.36
    tip.name = 'tip'
    vault.add(tip)
    this.onSurface(vault, LANDMARKS.contract)
    this.landmarkGroups.contract = vault
  }

  private setRings(n: number, sizes: number[]) {
    this.ringsGroup.clear()
    const count = Math.max(1, Math.min(6, n))
    for (let k = 0; k < count; k++) {
      const m = Math.min(1, (sizes[k] || 1) / 12)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.06 + k * 0.025, 0.003 + m * 0.004, 8, 64),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.75, 0.2).multiplyScalar(1.2 + m * 1.6), toneMapped: false }),
      )
      ring.position.y = 0.09 + k * 0.045
      ring.rotation.x = Math.PI / 2 + (k % 2 ? 0.25 : -0.25)
      ring.userData.speed = 0.3 + k * 0.12
      this.ringsGroup.add(ring)
    }
  }

  private setJobs(n: number) {
    this.jobCubes.clear()
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.78, 0.25).multiplyScalar(2), toneMapped: false })
    const count = Math.max(1, Math.min(12, n))
    for (let k = 0; k < count; k++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.018), mat)
      c.userData = { a: (k / count) * Math.PI * 2, r: 0.12 + (k % 3) * 0.025, y: (k % 4) * 0.03 }
      this.jobCubes.add(c)
    }
  }

  private buildSwarm() {
    const n = this.small ? 220 : 420
    const pos = new Float32Array(n * 3)
    this.swarmSeeds = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      this.swarmSeeds[i * 4] = Math.random() * Math.PI * 2
      this.swarmSeeds[i * 4 + 1] = Math.random() * Math.PI * 2
      this.swarmSeeds[i * 4 + 2] = 1.12 + Math.random() * 0.5
      this.swarmSeeds[i * 4 + 3] = (0.08 + Math.random() * 0.2) * (Math.random() < 0.5 ? -1 : 1)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.swarm = new THREE.Points(g, new THREE.PointsMaterial({ color: new THREE.Color(1.5, 1.05, 0.35), size: 0.012, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }))
    this.spin.add(this.swarm)
  }

  private buildSky() {
    const n = 2600
    const p: number[] = []
    for (let i = 0; i < n; i++) {
      const d = v3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(14 + Math.random() * 40)
      p.push(d.x, d.y, d.z)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xc9a24a, size: 0.06, sizeAttenuation: true, transparent: true, opacity: 0.55, fog: false })))
    // A soft gold haze behind the planet.
    const cv = document.createElement('canvas')
    cv.width = cv.height = 256
    const x = cv.getContext('2d')!
    const gr = x.createRadialGradient(128, 128, 0, 128, 128, 128)
    gr.addColorStop(0, 'rgba(255,170,30,0.35)')
    gr.addColorStop(0.4, 'rgba(255,140,0,0.08)')
    gr.addColorStop(1, 'rgba(0,0,0,0)')
    x.fillStyle = gr
    x.fillRect(0, 0, 256, 256)
    const haze = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
    haze.scale.setScalar(7)
    haze.position.set(0, 0, -2.5)
    this.scene.add(haze)
  }

  // ------------------------------------------------------------------ data

  setNetwork(net: Network | null) {
    this.memberAt.clear()
    this.tileOf.clear()
    const center = LANDMARKS.agents
    const order = this.dirs.map((d, i) => [i, d.angleTo(center)] as [number, number]).sort((a, b) => a[1] - b[1]).map(x => x[0])
    const agents = net ? [...net.agents].sort((a, b) => a.rank - b.rank) : []
    // Members fill the Comb outward from its center, most trusted first, with a little scatter so it reads as grown.
    let cursor = 0
    agents.forEach(a => {
      const skip = Math.floor(hash(a.tokenId) * 2.2)
      cursor += skip
      const tile = order[Math.min(order.length - 1, cursor++)]
      this.memberAt.set(tile, a)
      this.tileOf.set(a.label, tile)
      this.tileOf.set(a.address.toLowerCase(), tile)
    })
    this.layoutCells()
    if (this.arcs) {
      this.planet.remove(this.arcs)
      this.arcs.geometry.dispose()
      this.arcs = null
    }
    if (net && net.edges.length) {
      const P: number[] = []
      const T: number[] = []
      const S: number[] = []
      const C: number[] = []
      const A: number[] = []
      const B: number[] = []
      const SEG = 28
      const top = (i: number) => this.dirs[i].clone().multiplyScalar(0.985 + (this.heightOf.get(i) || 0.05) + 0.018)
      net.edges.forEach((e, k) => {
        const ia = this.tileOf.get(e.from.toLowerCase())
        const ib = this.tileOf.get(e.to.toLowerCase())
        if (ia === undefined || ib === undefined) return
        const a = top(ia)
        const b = top(ib)
        const mid = a.clone().add(b).multiplyScalar(0.5)
        const lift = 0.06 + a.distanceTo(b) * 0.55
        const ctrl = mid.clone().normalize().multiplyScalar(mid.length() + lift)
        const curve = new THREE.QuadraticBezierCurve3(a, ctrl, b)
        const pts = curve.getPoints(SEG)
        const col = new THREE.Color(KIND_HEX[e.kind] || KIND_HEX[0])
        const seed = hash(e.from + e.to + k)
        for (let s = 0; s < SEG; s++) {
          for (const j of [s, s + 1]) {
            P.push(pts[j].x, pts[j].y, pts[j].z)
            T.push(j / SEG)
            S.push(seed)
            C.push(col.r, col.g, col.b)
            A.push(ia)
            B.push(ib)
          }
        }
      })
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
      g.setAttribute('aT', new THREE.Float32BufferAttribute(T, 1))
      g.setAttribute('aSeed', new THREE.Float32BufferAttribute(S, 1))
      g.setAttribute('aColor', new THREE.Float32BufferAttribute(C, 3))
      g.setAttribute('aA', new THREE.Float32BufferAttribute(A, 1))
      g.setAttribute('aB', new THREE.Float32BufferAttribute(B, 1))
      this.arcs = new THREE.LineSegments(g, this.arcMat)
      this.arcs.frustumCulled = false
      this.planet.add(this.arcs)
    }
    if (net) {
      this.setRings(net.circles.length || 1, net.circles.map(c => c.members))
      const now = Date.now() / 1000
      this.setJobs(net.jobs.filter(j => j.state === 0 && j.deadline > now).length || 1)
    }
  }

  // ------------------------------------------------------------------ camera

  private clonePose(p: Pose): Pose {
    return { pos: p.pos.clone(), look: p.look.clone(), shiftX: p.shiftX, shiftY: p.shiftY }
  }

  private wide() {
    return innerWidth > 900
  }

  private homePose(t: number): Pose {
    const w = this.wide()
    const d = w ? 3.35 - t * 0.55 : 4.3 - t * 0.6
    return { pos: v3(0, 0.35 + t * 0.3, d), look: v3(0, 0.05, 0), shiftX: w ? -0.2 + t * 0.06 : 0, shiftY: w ? 0 : 0.2 }
  }

  private placePose(place: Place): Pose {
    const w = this.wide()
    if (place === 'network') return { pos: v3(0, 0.6, w ? 3.3 : 4.4), look: v3(0, 0, 0), shiftX: w ? -0.12 : 0, shiftY: w ? 0 : 0.18 }
    if (place === 'agents') return { pos: v3(0, 1.4, w ? 2.45 : 3.1), look: v3(0, 0.8, 0), shiftX: w ? -0.2 : 0, shiftY: w ? 0 : 0.26 }
    return { pos: v3(0, 1.3, w ? 2.05 : 2.6), look: v3(0, 0.86, 0), shiftX: w ? -0.21 : 0, shiftY: w ? 0 : 0.28 }
  }

  /** Turn the planet so a direction on it points up toward the camera. */
  private faceQuat(dir: THREE.Vector3) {
    const target = v3(0, 0.82, 0.57).normalize()
    return new THREE.Quaternion().setFromUnitVectors(dir.clone().normalize(), target)
  }

  private flyTo(pose: Pose, q: THREE.Quaternion | null, dur = 1.6) {
    this.poseFrom = this.clonePose(this.pose)
    this.poseTo = pose
    this.qFrom.copy(this.planet.quaternion)
    if (q) this.qTo.copy(q)
    else this.qTo.copy(this.planet.quaternion)
    this.tFly = 0
    this.flyDur = dur
  }

  goHome() {
    this.mode = 'home'
    this.focusTile = -1
    // Keep the spin, so the planet drifts on from where it is.
    this.flyTo(this.homePose(this.scrollT), new THREE.Quaternion(), 1.6)
  }

  goTo(place: Place) {
    if (place === 'home') return this.goHome()
    this.mode = place
    this.focusTile = -1
    if (place === 'network') {
      this.flyTo(this.placePose('network'), new THREE.Quaternion(), 1.6)
      return
    }
    this.unspin()
    this.flyTo(this.placePose(place), this.faceQuat(LANDMARKS[place as keyof typeof LANDMARKS]), 1.7)
  }

  goToAgent(key: string) {
    const tile = this.tileOf.get(key.toLowerCase().replace(/\.ai$/, ''))
    if (tile === undefined) return this.goTo('agents')
    this.mode = 'agents'
    this.unspin()
    this.focusTile = tile
    const pose = this.placePose('contract')
    this.flyTo(pose, this.faceQuat(this.dirs[tile]), 1.7)
  }

  /** Fold the free spin into the planet rotation so a landmark can be faced exactly. */
  private unspin() {
    this.planet.quaternion.premultiply(this.spin.quaternion)
    this.spin.quaternion.identity()
  }

  // ------------------------------------------------------------------ frame

  resize() {
    const w = this.canvas.clientWidth || innerWidth
    const h = this.canvas.clientHeight || innerHeight
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.bloom.resolution.set(w / 2, h / 2)
    this.camera.aspect = w / h
    this.camera.fov = w < h ? 52 : 38
    this.camera.updateProjectionMatrix()
    if (this.mode === 'home') this.poseTo = this.homePose(this.scrollT)
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    if (!this.visible) return
    const dt = Math.min(0.1, this.clock.getDelta())
    const t = this.clock.elapsedTime
    this.arcMat.uniforms.uTime.value = t

    // free spin on the overview modes
    if (this.mode === 'home' || this.mode === 'network') this.spin.rotateY(dt * (this.mode === 'home' ? 0.05 + this.scrollT * 0.25 : 0.07))

    if (this.tFly < 1) {
      this.tFly = Math.min(1, this.tFly + dt / this.flyDur)
      const e = this.tFly < 0.5 ? 4 * this.tFly ** 3 : 1 - (-2 * this.tFly + 2) ** 3 / 2
      this.planet.quaternion.slerpQuaternions(this.qFrom, this.qTo, e)
      const target = this.mode === 'home' ? this.homePose(this.scrollT) : this.poseTo
      this.pose.pos.lerpVectors(this.poseFrom.pos, target.pos, e)
      this.pose.look.lerpVectors(this.poseFrom.look, target.look, e)
      this.pose.shiftX = this.poseFrom.shiftX + (target.shiftX - this.poseFrom.shiftX) * e
      this.pose.shiftY = this.poseFrom.shiftY + (target.shiftY - this.poseFrom.shiftY) * e
    } else if (this.mode === 'home') {
      const target = this.homePose(this.scrollT)
      this.pose.pos.lerp(target.pos, Math.min(1, dt * 4))
      this.pose.look.lerp(target.look, Math.min(1, dt * 4))
      this.pose.shiftX += (target.shiftX - this.pose.shiftX) * Math.min(1, dt * 4)
    }

    const w = this.canvas.clientWidth || innerWidth
    const h = this.canvas.clientHeight || innerHeight
    const px = this.parallax.x * 0.05
    const py = this.parallax.y * 0.03
    this.camera.position.copy(this.pose.pos).add(v3(px + Math.sin(t * 0.21) * 0.012, py + Math.cos(t * 0.17) * 0.01, 0))
    this.camera.lookAt(this.pose.look)
    this.camera.setViewOffset(w, h, this.pose.shiftX * w, this.pose.shiftY * h, w, h)

    // landmarks breathe
    this.ringsGroup.children.forEach(r => (r.rotation.z += dt * (r.userData.speed as number)))
    this.jobCubes.children.forEach(c => {
      const u = c.userData as { a: number; r: number; y: number }
      u.a += dt * 0.6
      c.position.set(Math.cos(u.a) * u.r, u.y + Math.sin(t * 1.3 + u.a) * 0.01, Math.sin(u.a) * u.r)
      c.rotation.set(t, t * 0.7, 0)
    })
    const gate = this.landmarkGroups.connect
    const swirl = gate?.getObjectByName('swirl')
    if (swirl) swirl.rotation.z = -t * 0.8
    const tip = this.landmarkGroups.contract?.getObjectByName('tip')
    if (tip) {
      tip.rotation.y = t * 0.9
      tip.position.y = 0.36 + Math.sin(t * 1.6) * 0.01
    }
    this.atmo.uniforms.uPow.value = 2.4 + Math.sin(t * 0.7) * 0.2

    // pulsing caps for agents alive in the last hours
    if (this.alive.length) {
      const c = new THREE.Color()
      for (const i of this.alive) {
        const a = this.memberAt.get(i)!
        const k = (0.45 + (a.score / 100) * 1.5) * (1 + Math.sin(t * 2.4 + i) * 0.35)
        c.copy(AMBER).lerp(HONEY, a.score / 100).multiplyScalar(k)
        this.caps.setColorAt(i, c)
      }
      this.caps.instanceColor!.needsUpdate = true
    }

    // the swarm: agents in flight around the hive
    const pos = this.swarm.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const a = this.swarmSeeds[i * 4] + t * this.swarmSeeds[i * 4 + 3]
      const b = this.swarmSeeds[i * 4 + 1]
      const r = this.swarmSeeds[i * 4 + 2] + Math.sin(t * 0.9 + i) * 0.015
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      pos.setXYZ(i, x * Math.cos(b), y, x * Math.sin(b))
    }
    pos.needsUpdate = true

    // hover
    this.ray.setFromCamera(this.pointer, this.camera)
    const hit = this.ray.intersectObject(this.tiles, false)[0]
    const tile = hit?.instanceId ?? -1
    const member = tile >= 0 ? this.memberAt.get(tile) : undefined
    this.hoverTile = member ? tile : -1
    this.canvas.style.cursor = member ? 'pointer' : ''
    const focus = this.hoverTile >= 0 ? this.hoverTile : this.focusTile
    this.arcMat.uniforms.uFocus.value = focus
    const tip3d = this.opts.tooltip
    if (tip3d) {
      if (member) {
        const p = this.dirs[tile].clone().multiplyScalar(1 + (this.heightOf.get(tile) || 0) + 0.04)
        this.planet.localToWorld(p)
        p.project(this.camera)
        tip3d.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px)`
        tip3d.innerHTML = `<b>${member.label}.ai</b><span>Score ${member.score}, ${member.vouchesIn} ${member.vouchesIn === 1 ? 'vouch' : 'vouches'}</span>`
        tip3d.classList.add('on')
      } else tip3d.classList.remove('on')
    }

    if (this.intro) this.intro = Math.max(0, this.intro - dt * 0.4)
    this.composer.render()
  }
}
