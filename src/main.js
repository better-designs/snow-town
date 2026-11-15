import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import './firefly.css'
import './style.css'

const DEMOS = {
  drive: { label: 'Snow town', load: () => import('./scenes/drive.js') },
  coffee: { label: 'Coffee', load: () => import('./scenes/coffee.js') },
  bottle: { label: 'Bottle shop', load: () => import('./scenes/bottle.js') },
  confirmed: { label: 'Order', load: () => import('./scenes/confirmed.js') },
  snowday: { label: 'Snow day', load: () => import('./scenes/snowday.js') },
  materials: { label: 'Materials', load: () => import('./demos/materials.js') },
  post: { label: 'Post', load: () => import('./demos/post.js') },
  particles: { label: 'Sprites', load: () => import('./demos/particles.js') },
  compute: { label: 'Compute', load: () => import('./demos/compute.js') },
  snow: { label: 'Snow', load: () => import('./demos/snow.js') },
}

const params = new URLSearchParams(location.search)
const demoKey = DEMOS[params.get('demo')] ? params.get('demo') : 'coffee'
const forceWebGL = params.get('webgl') === '1'
const phone = matchMedia('(pointer: coarse)').matches

// Navigation keeps the backend choice; the toggle flips it.
const linkTo = (demo, webgl) => `?demo=${demo}${webgl ? '&webgl=1' : ''}`
const nav = document.querySelector('#demos')
for (const [key, { label }] of Object.entries(DEMOS)) {
  const a = document.createElement('a')
  a.href = linkTo(key, forceWebGL)
  a.textContent = label
  if (key === demoKey) a.setAttribute('aria-current', 'page')
  nav.append(a)
}
const toggle = document.querySelector('#backend-toggle')
toggle.href = linkTo(demoKey, !forceWebGL)
toggle.textContent = forceWebGL ? 'Use WebGPU' : 'Force WebGL 2'

// Status panel: the only console a phone gives us.
const statusList = document.querySelector('#status')
const rows = new Map()
function setRow(label, value, tone) {
  let dd = rows.get(label)
  if (!dd) {
    const dt = document.createElement('dt')
    dt.textContent = label
    dd = document.createElement('dd')
    statusList.append(dt, dd)
    rows.set(label, dd)
  }
  dd.textContent = value
  dd.className = tone ?? ''
}
const problems = []
function report(message) {
  if (problems.length >= 4 || problems.includes(message)) return
  problems.push(message)
  setRow('Problems', problems.join(' · '), 'bad')
}
addEventListener('error', (e) => report(e.message))
addEventListener('unhandledrejection', (e) => report(String(e.reason?.message ?? e.reason)))
for (const level of ['warn', 'error']) {
  const original = console[level].bind(console)
  console[level] = (...args) => {
    const text = args.map(String).join(' ')
    if (/THREE|WebGPU|TSL|GPU/i.test(text)) report(text.slice(0, 160))
    original(...args)
  }
}

// On a phone the panel starts closed so it does not cover the scene.
if (phone) document.querySelector('details.status').open = false
setRow('Demo', DEMOS[demoKey].label)
setRow('WebGPU in browser', 'gpu' in navigator ? 'yes' : 'no', 'gpu' in navigator ? 'good' : 'bad')

const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
document.querySelector('#stage').append(renderer.domElement)

await renderer.init()
// Read the backend only after init: before it, the renderer reports WebGPU even on a device that falls back.
const isWebGPU = renderer.backend.isWebGPUBackend === true
setRow('Backend', isWebGPU ? 'WebGPU' : 'WebGL 2 fallback', isWebGPU ? 'good' : 'bad')
setRow('Pixel ratio', `${renderer.getPixelRatio()} (device ${devicePixelRatio})`)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1000)
camera.position.set(5, 3, 7)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.target.set(0, 1, 0)

const timer = new THREE.Timer()
timer.connect(document)

// Scene screens dock one card; the camera's view shifts so the subject sits beside it, never under its text.
const ui = document.querySelector('#ui')
function frame() {
  const card = ui.firstElementChild
  if (!card) { camera.clearViewOffset(); camera.zoom = 1; camera.updateProjectionMatrix(); return }
  const r = card.getBoundingClientRect()
  const top = document.querySelector('.bar').getBoundingClientRect().bottom
  if (innerWidth >= 900) {
    // Card on the right: centre the subject in the space to its left.
    camera.zoom = 1
    camera.setViewOffset(innerWidth, innerHeight, (innerWidth - r.left) / 2, 0, innerWidth, innerHeight)
  } else {
    // Card at the bottom: shrink the view to the gap between the nav and the card, and centre it there.
    const gap = Math.max(1, r.top - top)
    camera.zoom = Math.min(1, Math.max(0.4, gap / innerHeight))
    camera.setViewOffset(innerWidth, innerHeight, 0, innerHeight / 2 - (top + r.top) / 2, innerWidth, innerHeight)
  }
  camera.updateProjectionMatrix()
}
new ResizeObserver(frame).observe(ui)

let demo
try {
  const mod = await DEMOS[demoKey].load()
  demo = await mod.setup({ renderer, scene, camera, controls, isWebGPU, phone, params, setRow, report, ui })
  frame()
  // Compile every material before the first frame, so the page does not stall once it is visible.
  await renderer.compileAsync(scene, camera)
} catch (err) {
  report(err.message)
  throw err
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  frame()
})

let frames = 0
let since = performance.now()
renderer.setAnimationLoop(() => {
  timer.update()
  const dt = timer.getDelta()
  if (!demo?.ownsCamera) controls.update()
  demo?.update?.(dt, timer.getElapsed())
  if (demo?.render) demo.render()
  else renderer.render(scene, camera)

  frames++
  const now = performance.now()
  if (now - since > 500) {
    const fps = Math.round((frames * 1000) / (now - since))
    setRow('Frame rate', `${fps} fps`, fps >= 50 ? 'good' : fps >= 30 ? '' : 'bad')
    frames = 0
    since = now
  }
})
