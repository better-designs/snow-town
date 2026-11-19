// Snow town: a miniature snowy town on a diorama platform.
// Hold the pointer or a finger on the snow and the car, or the ball, heads toward it and presses tracks into the snow.
// Arrow keys or WASD work too, and the on-screen arrows on touch screens: Down brakes, then reverses.
import * as THREE from 'three/webgpu'
import { float, smoothstep, uv, time, hash, instanceIndex, vec3, Fn, mix, positionLocal } from 'three/tsl'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { createSnowfield, createPlatform } from '../lib/snowfield.js'
import { buildTown } from '../lib/town.js'
import { createHoldTarget, createDioramaCamera } from '../lib/hold.js'

const SIZE = 16
const DEPTH = 0.09
const CAR_LENGTH = 1.0
const MODEL_LENGTH = 4.36
const BALL_RADIUS = 0.28

// Car Concept sample model (Khronos Group, after a public-domain model by Unity Fan, CC BY 4.0).
const WHEELS = [
  { name: 'WheelFrontL', x: 0.98, z: 1.48, front: true },
  { name: 'WheelFrontR', x: -0.98, z: 1.48, front: true },
  { name: 'WheelRearL', x: 0.98, z: -1.31, front: false },
  { name: 'WheelRearR', x: -0.98, z: -1.31, front: false },
]

async function loadCar() {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/models/car.glb')
  const model = gltf.scene
  for (const name of ['License Plate', 'InteriorSteeringEmblem']) {
    const part = model.getObjectByName(name)
    if (part) part.visible = false
  }
  const glass = new THREE.MeshPhysicalNodeMaterial({ color: '#0e1621', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.55, clearcoat: 1 })
  model.traverse((o) => {
    if (!o.isMesh) return
    if (o.material?.transmission > 0) o.material = glass
    o.castShadow = true
  })
  const wheels = WHEELS.map((w) => ({ ...w, node: model.getObjectByName(w.name) }))
  const car = new THREE.Group()
  const scale = CAR_LENGTH / MODEL_LENGTH
  model.scale.setScalar(scale)
  car.add(model)
  return { car, wheels, scale }
}

// What the car paint and the snow reflect: a blue sky over a pale horizon, bright snow below it, and a warm glow at the sun.
function skyEnvironment(renderer, sunDirection) {
  const sky = new THREE.Scene()
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide })
  const dir = positionLocal.normalize()
  const air = mix(vec3(0.78, 0.88, 1), vec3(0.2, 0.42, 0.95), smoothstep(0, 0.85, dir.y))
  const ground = vec3(0.86, 0.9, 0.98)
  const glow = dir.dot(vec3(sunDirection.x, sunDirection.y, sunDirection.z)).max(0).pow(48).mul(5)
  material.colorNode = mix(ground, air, smoothstep(-0.12, 0.02, dir.y)).add(vec3(1, 0.86, 0.66).mul(glow))
  sky.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), material))
  const pmrem = new THREE.PMREMGenerator(renderer)
  const map = pmrem.fromScene(sky, 0.02).texture
  material.dispose()
  return map
}

function fallingSnow(count) {
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false })
  material.positionNode = Fn(() => {
    const y = hash(instanceIndex.add(3)).sub(time.mul(hash(instanceIndex.add(2)).mul(0.05).add(0.06))).fract().mul(6)
    const sway = time.mul(0.7).add(hash(instanceIndex.add(4)).mul(6.28)).sin().mul(0.15)
    return vec3(hash(instanceIndex).sub(0.5).mul(SIZE + 4).add(sway), y, hash(instanceIndex.add(1)).sub(0.5).mul(SIZE + 4))
  })()
  material.scaleNode = hash(instanceIndex.add(5)).mul(0.025).add(0.02)
  material.colorNode = vec3(1)
  material.opacityNode = float(1).sub(smoothstep(0.15, 0.5, uv().sub(0.5).length())).mul(0.9)
  const flakes = new THREE.Sprite(material)
  flakes.count = count
  flakes.frustumCulled = false
  return flakes
}

// Fixed cameras for ?shot=. Each one looks from `from` to `at`.
const SHOTS = {
  tracks: { seconds: 14, from: [1.0, 0.42, 5.0], at: [0.0, 0, 4.1] },
  sun: { seconds: 14, from: [0.5, 2.6, 8.2], at: [0.2, 0, 2.6] },
  shade: { seconds: 14, from: [-2.5, 1.0, 6.6], at: [-3.5, 0, 4.5] },
}
const autoTarget = (t) => new THREE.Vector3(Math.sin(t * 0.5) * 4, 0, Math.sin(t) * 2.6 + 1.5)

const CARET = {
  up: 'm8 20l8-10l8 10z',
  down: 'm24 12l-8 10l-8-10z',
  left: 'm20 24l-10-8l10-8z',
  right: 'm12 8l10 8l-10 8z',
}
const icon = (d) => `<svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`

function buildOverlay(onSwap, keys) {
  const overlay = document.createElement('div')
  overlay.className = 'ds town-overlay'
  overlay.innerHTML = `
    <div class="ds-card town-switch" role="group" aria-label="What drives through the snow">
      <button class="ds-chip" type="button" data-ride="car" aria-pressed="true" aria-keyshortcuts="C">Car <kbd class="ds-kbd" aria-hidden="true">C</kbd></button>
      <button class="ds-chip" type="button" data-ride="ball" aria-pressed="false" aria-keyshortcuts="B">Ball <kbd class="ds-kbd" aria-hidden="true">B</kbd></button>
    </div>
    <p class="town-credit">Car model: <a href="https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept" target="_blank" rel="noopener">Car Concept</a>, Khronos Group, after a public-domain model by Unity Fan. <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a></p>
    <div class="town-pad" role="group" aria-label="Arrows">
      <button class="ds-btn ds-btn-outline town-pad-up" type="button" data-key="up" aria-label="Forward">${icon(CARET.up)}</button>
      <button class="ds-btn ds-btn-outline town-pad-left" type="button" data-key="left" aria-label="Left">${icon(CARET.left)}</button>
      <button class="ds-btn ds-btn-outline town-pad-down" type="button" data-key="down" aria-label="Back">${icon(CARET.down)}</button>
      <button class="ds-btn ds-btn-outline town-pad-right" type="button" data-key="right" aria-label="Right">${icon(CARET.right)}</button>
    </div>`
  document.body.append(overlay)
  const choose = (ride) => {
    for (const c of overlay.querySelectorAll('[data-ride]')) c.setAttribute('aria-pressed', String(c.dataset.ride === ride))
    onSwap(ride)
  }
  overlay.querySelector('.town-switch').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-ride]')
    if (chip) choose(chip.dataset.ride)
  })
  // C picks the car and B the ball, unless someone is typing in a field.
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea, [contenteditable]')) return
    if (e.code === 'KeyC') choose('car')
    if (e.code === 'KeyB') choose('ball')
  })
  for (const button of overlay.querySelectorAll('[data-key]')) {
    const name = button.dataset.key
    button.addEventListener('pointerdown', (e) => { e.preventDefault(); keys[name] = true })
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) button.addEventListener(ev, () => { keys[name] = false })
  }
}

// Arrow keys and WASD, held state only.
function listenForArrows(keys) {
  const map = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' }
  addEventListener('keydown', (e) => { if (map[e.code]) { keys[map[e.code]] = true; e.preventDefault() } })
  addEventListener('keyup', (e) => { if (map[e.code]) keys[map[e.code]] = false })
  addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false })
}

export async function setup({ renderer, scene, camera, controls, phone, params, setRow }) {
  setRow('Try', 'Hold the pointer or a finger on the snow: the car, or the ball, heads toward it and leaves tracks.')
  controls.enabled = false
  scene.background = new THREE.Color('#c6dbf4')
  scene.fog = new THREE.Fog('#c6dbf4', 18, 45)
  // Shade on snow is lit by the sky alone, so it is blue; the sun is warm, and together they make white.
  const sun = new THREE.DirectionalLight(0xffe6c4, 4.2)
  sun.position.set(-9, 11, 6)
  const sunDirection = sun.position.clone().normalize()
  scene.environment = skyEnvironment(renderer, sunDirection)
  scene.environmentIntensity = 0.35
  scene.add(new THREE.HemisphereLight(0x86b4ff, 0xf4f7ff, 1.0))
  sun.castShadow = true
  sun.shadow.mapSize.setScalar(phone ? 1024 : 2048)
  sun.shadow.radius = 3
  sun.shadow.bias = -0.0005
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 40 })
  scene.add(sun)

  const field = createSnowfield({
    renderer, size: SIZE, depth: DEPTH, res: phone ? 768 : 1024, meshRes: phone ? 320 : 448,
    spheres: 1, segments: 4, boxes: 1, tyre: 0.065, refillRate: 0.03, blurRate: 0.2, sunDirection,
  })
  scene.add(field.mesh, createPlatform(SIZE, DEPTH))
  const { group: town, solids } = buildTown({ size: SIZE })
  scene.add(town)
  scene.add(fallingSnow(phone ? 1400 : 3200))

  const { car, wheels, scale } = await loadCar()
  scene.add(car)
  setRow('Car model', 'Car Concept, Khronos Group sample assets, after a public-domain model by Unity Fan. CC BY 4.0')
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 48, 24), new THREE.MeshStandardNodeMaterial({ color: '#e2553f', roughness: 0.4 }))
  ball.castShadow = true
  ball.visible = false
  scene.add(ball)

  const view = createDioramaCamera(camera, SIZE, { followWide: 1, wideScale: 0.34, followNarrow: 1, narrowScale: 0.4 })
  const hold = createHoldTarget(camera, renderer.domElement, DEPTH, { onPinch: (ratio) => view.zoomBy(ratio) })
  // Mouse wheel and trackpad pinch zoom the camera in or out along the same angle.
  renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault()
    view.zoomBy(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0008)))
  }, { passive: false })
  const autodrive = params.get('autodrive') === '1'
  // Test switch: ?autodrive=keys presses the arrows on a timer, for devices where nobody can press them.
  const autokeys = params.get('autodrive') === 'keys'
  const debug = params.get('debug') === '1'
  // Test switch: ?shot=tracks, sun or shade drives a fixed route, then holds one camera, so two builds can be compared.
  const shot = SHOTS[params.get('shot')]
  const state = { x: 0, z: 5.4, heading: Math.PI, vx: 0, vz: 0 }
  const prev = WHEELS.map(() => new THREE.Vector2(NaN, NaN))
  const spin = new THREE.Quaternion()
  const axis = new THREE.Vector3()
  let ride = params.get('ride') === 'ball' ? 'ball' : 'car'
  let roll = 0
  let steerAngle = 0

  function swap(next) {
    ride = next
    car.visible = ride === 'car'
    ball.visible = ride === 'ball'
    field.park()
    for (const p of prev) p.set(NaN, NaN)
  }
  const keys = { up: false, down: false, left: false, right: false }
  buildOverlay(swap, keys)
  // Recording switch: ?clean=1 hides the on-screen controls for a clean video.
  if (params.get('clean') === '1' || shot) document.querySelector('.town-overlay').hidden = true
  listenForArrows(keys)
  if (ride === 'ball') {
    swap('ball')
    document.querySelector('[data-ride="ball"]').setAttribute('aria-pressed', 'true')
    document.querySelector('[data-ride="car"]').setAttribute('aria-pressed', 'false')
  }
  view.update(state, 0)

  function collide(radius) {
    for (const s of solids) {
      const ox = state.x - s.x
      const oz = state.z - s.z
      const px = s.hx + radius - Math.abs(ox)
      const pz = s.hz + radius - Math.abs(oz)
      if (px > 0 && pz > 0) {
        if (px < pz) { state.x += Math.sign(ox) * px; state.vx *= -0.2 } else { state.z += Math.sign(oz) * pz; state.vz *= -0.2 }
      }
    }
    const edge = SIZE / 2 - 0.3 - radius
    if (Math.abs(state.x) > edge) { state.x = Math.sign(state.x) * edge; state.vx *= -0.2 }
    if (Math.abs(state.z) > edge) { state.z = Math.sign(state.z) * edge; state.vz *= -0.2 }
  }

  function driveCar(dt, target) {
    let throttle = 0
    let steer = 0
    let braking = false
    const fx0 = Math.sin(state.heading)
    const fz0 = Math.cos(state.heading)
    const rolling = state.vx * fx0 + state.vz * fz0
    const arrows = keys.up || keys.down || keys.left || keys.right
    if (arrows) {
      steer = (keys.left ? 1 : 0) - (keys.right ? 1 : 0)
      if (keys.up) throttle = 1
      else if (keys.down) {
        if (rolling > 0.15) braking = true
        else throttle = -1
      }
    } else if (target) {
      const dx = target.x - state.x
      const dz = target.z - state.z
      const want = Math.atan2(dx, dz)
      const diff = Math.atan2(Math.sin(want - state.heading), Math.cos(want - state.heading))
      steer = THREE.MathUtils.clamp(diff * 2.2, -1, 1)
      throttle = Math.hypot(dx, dz) > CAR_LENGTH * 0.8 ? 1 : 0
    }
    const fx = Math.sin(state.heading)
    const fz = Math.cos(state.heading)
    let along = state.vx * fx + state.vz * fz
    let side = state.vx * fz - state.vz * fx
    along += throttle * (throttle > 0 ? 4.5 : 3) * dt
    if (braking) along = Math.max(0, along - 7 * dt)
    along *= Math.exp(-(target || throttle !== 0 ? 0.6 : 2.2) * dt)
    along = THREE.MathUtils.clamp(along, -1.6, 3.4)
    if (debug) setRow('Zoom', view.zoom.toFixed(2))
    if (debug) setRow('Speed', `${along.toFixed(2)} (${keys.up ? 'up ' : ''}${keys.down ? 'down ' : ''}${keys.left ? 'left' : ''})`)
    side *= Math.exp(-4 * dt)
    state.heading += steer * 2.8 * dt * THREE.MathUtils.clamp(along / 1.2, -1, 1)
    const nfx = Math.sin(state.heading)
    const nfz = Math.cos(state.heading)
    state.vx = along * nfx + side * nfz
    state.vz = along * nfz - side * nfx
    state.x += state.vx * dt
    state.z += state.vz * dt
    collide(0.4)

    car.position.set(state.x, 0, state.z)
    car.rotation.y = state.heading
    roll += along * dt / (0.38 * scale)
    steerAngle += (steer * 0.5 - steerAngle) * Math.min(1, dt * 10)
    for (const w of wheels) w.node.rotation.set(roll, 0, w.front ? steerAngle : 0, 'ZYX')
    // The body caps the snow under it just below the underside; the wheels dig the deeper ruts.
    field.boxes[0].place.set(state.x, state.z, nfx, nfz)
    // The model's underside sits 9 cm up and its floor mats 10 cm, which is about 0.020 at this scale: cap below that.
    field.boxes[0].shape.set(0.25, 0.53, 0.015, 0)
    // Each wheel presses a groove from where it was last frame to where it is now.
    WHEELS.forEach((w, i) => {
      const wx = state.x + (w.x * nfz + w.z * nfx) * scale
      const wz = state.z + (-w.x * nfx + w.z * nfz) * scale
      if (Number.isNaN(prev[i].x)) prev[i].set(wx, wz)
      field.segments[i].set(prev[i].x, prev[i].y, wx, wz)
      prev[i].set(wx, wz)
    })
  }

  function rollBall(dt, target) {
    const pushX = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
    const pushZ = (keys.down ? 1 : 0) - (keys.up ? 1 : 0)
    if (pushX || pushZ) {
      state.vx += pushX * 7 * dt
      state.vz += pushZ * 7 * dt
      target = null
    } else if (target) {
      state.vx += (target.x - state.x) * 5 * dt
      state.vz += (target.z - state.z) * 5 * dt
    }
    const damp = Math.exp(-(target ? 2.2 : pushX || pushZ ? 0.8 : 1.4) * dt)
    state.vx *= damp
    state.vz *= damp
    const speed = Math.hypot(state.vx, state.vz)
    if (speed > 3) { state.vx *= 3 / speed; state.vz *= 3 / speed }
    state.x += state.vx * dt
    state.z += state.vz * dt
    collide(BALL_RADIUS)
    ball.position.set(state.x, BALL_RADIUS, state.z)
    if (speed > 1e-4) {
      axis.set(state.vz, 0, -state.vx).normalize()
      spin.setFromAxisAngle(axis, (speed * dt) / BALL_RADIUS)
      ball.quaternion.premultiply(spin)
    }
    field.spheres[0].set(state.x, state.z, BALL_RADIUS, BALL_RADIUS)
  }

  if (shot) {
    for (let i = 0; i < shot.seconds * 60; i++) {
      if (ride === 'car') driveCar(1 / 60, autoTarget(i / 60))
      else rollBall(1 / 60, autoTarget(i / 60))
      field.update(1 / 60)
    }
    field.park()
    camera.position.fromArray(shot.from)
    camera.lookAt(new THREE.Vector3().fromArray(shot.at))
  }

  return {
    ownsCamera: true,
    swap,
    update(rawDt, elapsed) {
      // A shot holds still: the snow passes still run, with no refill and no blur, so the frame cost stays honest.
      if (shot) { field.update(0); return }
      const dt = Math.min(rawDt, 1 / 30)
      let target = hold.holding ? hold.aim() : null
      if (autokeys) {
        const t = elapsed % 8
        keys.up = t < 3
        keys.down = t >= 3 && t < 6.5
        keys.left = t >= 4 && t < 6.5
      }
      if (autodrive) target = autoTarget(elapsed)
      if (ride === 'car') driveCar(dt, target)
      else rollBall(dt, target)
      field.update(dt)
      view.update(state, dt)
    },
  }
}
