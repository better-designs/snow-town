// Snow town: an original open-world delivery game. Tyre tracks are pressed into a storage texture
// by a compute pass (tsl-stylized-environments), snow falls as sprites, and lights glow through bloom.
import * as THREE from 'three/webgpu'
import {
  Fn, Loop, uniform, uniformArray, instanceIndex, vec2, vec3, vec4, float, min, max, mix, smoothstep, step,
  hash, time, uv, texture, positionWorld, normalWorld, transformNormalToView, color, pass, fract, floor,
} from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

const SIZE = 64
const STREETS = [-30, -15, 0, 15, 30]
const ROAD = 6

function randomStreetPoint() {
  const line = STREETS[1 + Math.floor(Math.random() * 3)]
  const along = (Math.random() - 0.5) * 54
  return Math.random() < 0.5 ? new THREE.Vector3(line, 0, along) : new THREE.Vector3(along, 0, line)
}

// The car is the Car Concept sample model (Khronos Group, from a public-domain model by Unity Fan, CC BY 4.0),
// compressed with meshopt. Its logo parts are hidden: the licence does not cover them.
const WHEELS = [
  { name: 'WheelFrontL', x: 0.98, z: 1.48, front: true },
  { name: 'WheelFrontR', x: -0.98, z: 1.48, front: true },
  { name: 'WheelRearL', x: 0.98, z: -1.31, front: false },
  { name: 'WheelRearR', x: -0.98, z: -1.31, front: false },
]

async function loadCar() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const gltf = await loader.loadAsync('/models/car.glb')
  const model = gltf.scene
  for (const name of ['License Plate', 'InteriorSteeringEmblem']) {
    const part = model.getObjectByName(name)
    if (part) part.visible = false
  }
  // Transmission glass renders the scene a second time: too costly on a phone, so tinted glass stands in.
  const glass = new THREE.MeshPhysicalNodeMaterial({ color: '#0e1621', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.55, clearcoat: 1 })
  model.traverse((o) => {
    if (o.isMesh && o.material && o.material.transmission > 0) o.material = glass
  })
  const wheels = WHEELS.map((w) => ({ ...w, node: model.getObjectByName(w.name) }))
  for (const w of wheels) w.node.rotation.set(0, 0, 0, 'ZYX') // the showcase pose turns the front wheels; drive starts straight

  const car = new THREE.Group()
  car.add(model)
  const blob = new THREE.MeshBasicNodeMaterial({ color: '#0b0f16', transparent: true, depthWrite: false })
  blob.opacityNode = float(1).sub(smoothstep(0.15, 0.5, uv().sub(0.5).length())).mul(0.55)
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 5.4), blob)
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.015
  car.add(shadow)
  const beam = new THREE.SpotLight('#fff1d0', 70, 36, 0.55, 0.6, 1.2)
  beam.position.set(0, 0.8, 2.1)
  beam.target.position.set(0, 0, 10)
  car.add(beam, beam.target)
  return { car, wheels }
}

function buildTown(scene) {
  const solids = []
  const wall = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 })
  const facade = normalWorld.y.abs().lessThan(0.5)
  const along = positionWorld.x.add(positionWorld.z)
  const col = fract(along.div(2.2))
  const row = fract(positionWorld.y.div(2.8))
  const pane = step(0.3, col).mul(step(col, 0.7)).mul(step(0.35, row)).mul(step(row, 0.75))
  const lit = step(0.5, hash(floor(along.div(2.2)).add(floor(positionWorld.y.div(2.8)).mul(57)).add(1000)))
  const aboveStreet = step(1.2, positionWorld.y)
  wall.colorNode = mix(color('#a8927e'), color('#f2f5f9'), step(0.5, normalWorld.y))
  wall.emissiveNode = color('#ffc978').mul(pane.mul(lit).mul(aboveStreet).mul(facade.select(float(2.4), float(0))))

  const blocks = [-22.5, -7.5, 7.5, 22.5]
  for (const bx of blocks) {
    for (const bz of blocks) {
      if (bx === 7.5 && bz === -7.5) continue // a park block: trees, no buildings
      const lots = Math.random() < 0.5 ? 1 : 2
      for (let i = 0; i < lots; i++) {
        const w = 3 + Math.random() * 2.6
        const d = lots === 1 ? 4 + Math.random() * 3.5 : 2.6 + Math.random() * 1.2
        const h = 4 + Math.random() * 12
        const x = bx + (Math.random() - 0.5) * (8 - w)
        const z = lots === 1 ? bz : bz + (i === 0 ? -2.2 : 2.2)
        const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall)
        box.position.set(x, h / 2, z)
        scene.add(box)
        solids.push({ x, z, hx: w / 2, hz: d / 2 })
      }
    }
  }

  const trunk = new THREE.MeshStandardNodeMaterial({ color: '#4a3528', roughness: 0.9 })
  const needles = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 })
  needles.colorNode = mix(color('#2e5143'), color('#eef3f7'), smoothstep(0.2, 0.6, normalWorld.y))
  for (let i = 0; i < 9; i++) {
    const x = 7.5 + ((i % 3) - 1) * 2.6 + (Math.random() - 0.5)
    const z = -7.5 + (Math.floor(i / 3) - 1) * 2.6 + (Math.random() - 0.5)
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.2), trunk)
    stem.position.set(x, 0.6, z)
    const crown = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 10), needles)
    crown.position.set(x, 2.3, z)
    scene.add(stem, crown)
    solids.push({ x, z, hx: 0.3, hz: 0.3 })
  }

  const pole = new THREE.MeshStandardNodeMaterial({ color: '#2b2f36', roughness: 0.6 })
  const bulb = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('#ffd79a').multiplyScalar(6) })
  for (const x of STREETS.slice(1, 4)) {
    for (const z of STREETS.slice(1, 4)) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2), pole)
      post.position.set(x + 3.6, 2.1, z + 3.6)
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), bulb)
      lamp.position.set(x + 3.6, 4.3, z + 3.6)
      scene.add(post, lamp)
    }
  }
  return solids
}

function fallingSnow(count, center) {
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false })
  material.positionNode = Fn(() => {
    const spread = float(40)
    const base = vec2(hash(instanceIndex), hash(instanceIndex.add(1))).mul(spread)
    const rel = base.sub(center.xz).mod(spread).sub(spread.div(2))
    const fall = hash(instanceIndex.add(2)).mul(0.08).add(0.06)
    const y = hash(instanceIndex.add(3)).sub(time.mul(fall)).fract().mul(12)
    const sway = time.mul(0.8).add(hash(instanceIndex.add(4)).mul(6.28)).sin().mul(0.3)
    return vec3(center.x.add(rel.x).add(sway), y, center.z.add(rel.y))
  })()
  material.scaleNode = hash(instanceIndex.add(5)).mul(0.05).add(0.04)
  material.colorNode = vec3(0.9, 0.94, 1)
  material.opacityNode = float(1).sub(smoothstep(0.15, 0.5, uv().sub(0.5).length())).mul(0.85)
  const flakes = new THREE.Sprite(material)
  flakes.count = count
  flakes.frustumCulled = false
  return flakes
}

export async function setup({ renderer, scene, camera, controls, isWebGPU, phone, params, setRow }) {
  // Test switch: ?demo=drive&autodrive=1 drives a slow loop, for devices where nobody can hold the buttons.
  const autodrive = params.get('autodrive') === '1'
  setRow('Try', phone ? 'Hold Gas and steer with Left and Right. Brake while turning to slide.' : 'Arrow keys or WASD to drive. Space is the handbrake: hold it in a turn to drift.')
  controls.enabled = false
  scene.background = new THREE.Color('#1c2536')
  // A dim studio reflection, so the car paint and glass have something to reflect at dusk.
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.35
  scene.fog = new THREE.FogExp2('#1c2536', 0.03)
  scene.add(new THREE.HemisphereLight(0xa9bde0, 0x4a5262, 2.2))
  const moon = new THREE.DirectionalLight(0xb4c6ff, 1.2)
  moon.position.set(-20, 30, 10)
  scene.add(moon)
  camera.near = 0.3
  camera.far = 200
  camera.updateProjectionMatrix()

  const solids = buildTown(scene)
  const { car, wheels: carWheels } = await loadCar()
  scene.add(car)
  setRow('Car model', 'Car Concept, Khronos Group sample assets, after a public-domain model by Unity Fan. CC BY 4.0')
  const snowCenter = uniform(new THREE.Vector3())
  scene.add(fallingSnow(phone ? 1800 : 5000, snowCenter))

  // Snow ground. On WebGPU a compute pass presses the tyre paths into a height texture every frame.
  const RES = phone ? 384 : 512
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshStandardNodeMaterial({ roughness: 0.9 }))
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)
  // A wider snowfield under the town, so the edge of the playable ground never shows.
  const field = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardNodeMaterial({ color: '#e6ecf5', roughness: 0.9 }))
  field.rotation.x = -Math.PI / 2
  field.position.y = -0.02
  scene.add(field)
  const roadMask = Fn(() => {
    const near = (v) => smoothstep(ROAD / 2, ROAD / 2 - 0.6, v.add(SIZE / 2).add(7.5).mod(15).sub(7.5).abs())
    return max(near(positionWorld.x), near(positionWorld.z))
  })()
  const fresh = color('#eef3fa')
  const road = color('#cfd8e4')
  const packed = color('#9aa7b8')
  const wheels = uniformArray(Array.from({ length: 4 }, () => new THREE.Vector4()), 'vec4')
  // Snow height lives in two render targets. Each frame one pass presses the tyre paths into B while reading A,
  // and a second pass copies B back into A. Unlike a storage texture, this runs on Safari's WebGL 2 path too.
  const targetOptions = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
  const snowA = new THREE.RenderTarget(RES, RES, targetOptions)
  const snowB = new THREE.RenderTarget(RES, RES, targetOptions)
  const refill = uniform(0)
  const fillMaterial = new THREE.NodeMaterial()
  fillMaterial.fragmentNode = vec4(1)
  const pressMaterial = new THREE.NodeMaterial()
  pressMaterial.fragmentNode = Fn(() => {
    const st = uv()
    const world = st.sub(0.5).mul(SIZE)
    const h = texture(snowA.texture, st).r.add(refill).min(1).toVar()
    Loop(4, ({ i }) => {
      const w = wheels.element(i)
      const a = w.zw
      const ab = w.xy.sub(a)
      const ap = world.sub(a)
      const k = ap.dot(ab).div(max(ab.dot(ab), 1e-5)).clamp(0, 1)
      const d = ap.sub(ab.mul(k)).length()
      h.assign(min(h, smoothstep(0.1, 0.2, d).mul(0.85).add(0.15)))
    })
    return vec4(h, h, h, 1)
  })()
  const copyMaterial = new THREE.NodeMaterial()
  copyMaterial.fragmentNode = texture(snowB.texture, uv())
  const fillQuad = new THREE.QuadMesh(fillMaterial)
  const pressQuad = new THREE.QuadMesh(pressMaterial)
  const copyQuad = new THREE.QuadMesh(copyMaterial)
  for (const target of [snowA, snowB]) {
    renderer.setRenderTarget(target)
    fillQuad.render(renderer)
  }
  renderer.setRenderTarget(null)
  const tracks = {
    run(dt) {
      refill.value = dt * 0.06
      renderer.setRenderTarget(snowB)
      pressQuad.render(renderer)
      renderer.setRenderTarget(snowA)
      copyQuad.render(renderer)
      renderer.setRenderTarget(null)
    },
  }

  const st = positionWorld.xz.div(SIZE).add(0.5)
  const e = 1 / RES
  const sample = (o) => texture(snowA.texture, st.add(o)).r
  const press = sample(vec2(0, 0))
  ground.material.colorNode = mix(packed, mix(fresh, road, roadMask), smoothstep(0.15, 1, press))
  const dx = sample(vec2(e, 0)).sub(sample(vec2(-e, 0)))
  const dz = sample(vec2(0, e)).sub(sample(vec2(0, -e)))
  const n = vec3(dx.mul(-6), float(1), dz.mul(-6)).normalize()
  ground.material.normalNode = transformNormalToView(vec3(n.x, n.z.negate(), n.y))

  // Delivery markers and the arrow that points to the current one.
  const markerMaterial = (hex) => {
    const m = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(hex).multiplyScalar(2.5), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
    m.opacityNode = uv().y.oneMinus().pow(1.5).mul(time.mul(3).sin().mul(0.15).add(0.75))
    return m
  }
  const markerGeometry = new THREE.CylinderGeometry(2.2, 2.2, 3, 32, 1, true).translate(0, 1.5, 0)
  const pickup = new THREE.Mesh(markerGeometry, markerMaterial('#ff9d3c'))
  const dropoff = new THREE.Mesh(markerGeometry, markerMaterial('#4cd98b'))
  scene.add(pickup, dropoff)
  const arrowMaterial = new THREE.MeshBasicNodeMaterial({ color: '#ff9d3c' })
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1, 12).rotateX(Math.PI / 2), arrowMaterial)
  scene.add(arrow)

  const pipeline = new THREE.RenderPipeline(renderer)
  const scenePass = pass(scene, camera)
  pipeline.outputNode = scenePass.add(bloom(scenePass, 0.7, 0.35, 0.85))

  // HUD and touch controls, built from the Firefly kit.
  const hud = document.createElement('div')
  hud.className = 'ds game-hud'
  hud.innerHTML = `
    <section class="ds-card game-card" aria-live="polite">
      <h1 class="ds-section-title" id="game-task">Pick up the parcel</h1>
      <p class="ds-supporting" id="game-detail">Follow the arrow to the orange light.</p>
      <div class="scene-split"><span>Delivered</span><strong id="game-score">0</strong></div>
    </section>
    <div class="game-pad" aria-label="Driving controls">
      <div class="game-pad-group">
        <button class="ds-btn ds-btn-outline ds-btn-lg" type="button" data-key="left">Left</button>
        <button class="ds-btn ds-btn-outline ds-btn-lg" type="button" data-key="right">Right</button>
      </div>
      <div class="game-pad-group">
        <button class="ds-btn ds-btn-outline ds-btn-lg" type="button" data-key="brake">Brake</button>
        <button class="ds-btn ds-btn-primary ds-btn-lg" type="button" data-key="gas">Gas</button>
      </div>
    </div>`
  document.body.append(hud)
  const task = hud.querySelector('#game-task')
  const detail = hud.querySelector('#game-detail')
  const score = hud.querySelector('#game-score')

  const input = { gas: false, brake: false, left: false, right: false, handbrake: false }
  const keys = { ArrowUp: 'gas', KeyW: 'gas', ArrowDown: 'brake', KeyS: 'brake', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'handbrake' }
  addEventListener('keydown', (e) => { if (keys[e.code]) { input[keys[e.code]] = true; e.preventDefault() } })
  addEventListener('keyup', (e) => { if (keys[e.code]) input[keys[e.code]] = false })
  for (const button of hud.querySelectorAll('[data-key]')) {
    const name = button.dataset.key
    const on = (e) => { e.preventDefault(); input[name] = true; if (name === 'brake') input.handbrake = true }
    const off = () => { input[name] = false; if (name === 'brake') input.handbrake = false }
    button.addEventListener('pointerdown', on)
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) button.addEventListener(ev, off)
  }

  // Arcade car on snow: full grip forward, little grip sideways, so the car slides in turns.
  const state = { x: 0, z: -22.5, heading: 0, vx: 0, vz: 0 }
  const forward = new THREE.Vector2()
  const wheelOffsets = WHEELS.map((w) => [w.x, w.z])
  let roll = 0
  let steerAngle = 0
  const wheelPrev = wheelOffsets.map(() => new THREE.Vector2())
  let firstFrame = true

  const job = { phase: 'pickup', timeLeft: 0, delivered: 0 }
  function newJob() {
    job.phase = 'pickup'
    const from = randomStreetPoint()
    let to = randomStreetPoint()
    while (to.distanceTo(from) < 20) to = randomStreetPoint()
    pickup.position.copy(from)
    dropoff.position.copy(to)
    pickup.visible = true
    dropoff.visible = false
    arrowMaterial.color.set('#ff9d3c')
    task.textContent = 'Pick up the parcel'
    detail.textContent = 'Follow the arrow to the orange light.'
  }
  newJob()
  // Keep the drop-off light visible through the shader warm-up, so it does not stall the first time it appears.
  dropoff.visible = true
  let warmed = false

  const camTarget = new THREE.Vector3()
  return {
    ownsCamera: true,
    update(rawDt) {
      if (!warmed) { warmed = true; dropoff.visible = job.phase === 'deliver' }
      if (autodrive) { input.gas = true; input.left = Math.sin(performance.now() / 1400) > 0.3 }
      const dt = Math.min(rawDt, 1 / 30)
      const fx = Math.sin(state.heading)
      const fz = Math.cos(state.heading)
      let along = state.vx * fx + state.vz * fz
      let side = state.vx * fz - state.vz * fx
      const throttle = (input.gas ? 1 : 0) - (input.brake ? 1 : 0)
      along += throttle * (throttle > 0 ? 13 : along > 0.5 ? 22 : 8) * dt
      along *= Math.exp(-0.35 * dt)
      along = THREE.MathUtils.clamp(along, -8, 20)
      side *= Math.exp(-(input.handbrake ? 0.7 : 3.2) * dt)
      const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0)
      state.heading += steer * 2.1 * dt * THREE.MathUtils.clamp(along / 6, -1, 1)
      const nfx = Math.sin(state.heading)
      const nfz = Math.cos(state.heading)
      state.vx = along * nfx + side * nfz
      state.vz = along * nfz - side * nfx
      state.x += state.vx * dt
      state.z += state.vz * dt

      // Bounce off buildings, trees and the edge of town.
      for (const s of solids) {
        const ox = state.x - s.x
        const oz = state.z - s.z
        const px = s.hx + 1.3 - Math.abs(ox)
        const pz = s.hz + 1.3 - Math.abs(oz)
        if (px > 0 && pz > 0) {
          if (px < pz) { state.x += Math.sign(ox) * px; state.vx *= -0.3 } else { state.z += Math.sign(oz) * pz; state.vz *= -0.3 }
        }
      }
      const edge = SIZE / 2 - 1.5
      if (Math.abs(state.x) > edge) { state.x = Math.sign(state.x) * edge; state.vx *= -0.3 }
      if (Math.abs(state.z) > edge) { state.z = Math.sign(state.z) * edge; state.vz *= -0.3 }

      car.position.set(state.x, 0, state.z)
      car.rotation.y = state.heading
      car.rotation.z = THREE.MathUtils.clamp(-side * 0.012, -0.08, 0.08)

      roll += along * dt / 0.38
      steerAngle += (steer * 0.5 - steerAngle) * Math.min(1, dt * 10)
      for (const w of carWheels) w.node.rotation.set(roll, 0, w.front ? steerAngle : 0, 'ZYX')

      {
        wheelOffsets.forEach(([ox, oz], i) => {
          const wx = state.x + ox * nfz + oz * nfx
          const wz = state.z - ox * nfx + oz * nfz
          if (firstFrame) wheelPrev[i].set(wx, wz)
          wheels.array[i].set(wx, wz, wheelPrev[i].x, wheelPrev[i].y)
          wheelPrev[i].set(wx, wz)
        })
        firstFrame = false
        tracks.run(dt)
      }

      // Jobs.
      const goal = job.phase === 'pickup' ? pickup.position : dropoff.position
      const dist = Math.hypot(goal.x - state.x, goal.z - state.z)
      if (dist < 2.4) {
        if (job.phase === 'pickup') {
          job.phase = 'deliver'
          job.timeLeft = Math.hypot(dropoff.position.x - pickup.position.x, dropoff.position.z - pickup.position.z) / 8 + 10
          pickup.visible = false
          dropoff.visible = true
          arrowMaterial.color.set('#4cd98b')
          task.textContent = 'Deliver the parcel'
        } else {
          job.delivered++
          score.textContent = String(job.delivered)
          newJob()
          detail.textContent = 'Delivered on time. Follow the arrow to the next pickup.'
        }
      }
      if (job.phase === 'deliver') {
        job.timeLeft -= dt
        if (job.timeLeft <= 0) {
          newJob()
          detail.textContent = 'Too late, the customer cancelled. Follow the arrow to a new pickup.'
        } else {
          detail.textContent = `Reach the green light in ${Math.ceil(job.timeLeft)} s.`
        }
      }

      arrow.position.set(state.x, 2.6, state.z)
      arrow.lookAt(goal.x, 2.6, goal.z)

      // Chase camera.
      // A portrait phone sees less to the sides, so the camera sits further back and higher.
      const back = camera.aspect < 1 ? 12.5 : 8.5
      camTarget.set(state.x - nfx * back, back * 0.5, state.z - nfz * back)
      camera.position.lerp(camTarget, 1 - Math.exp(-4 * dt))
      camera.lookAt(state.x + nfx * 3, 1, state.z + nfz * 3)
      snowCenter.value.set(state.x, 0, state.z)
      forward.set(nfx, nfz)
    },
    render() { pipeline.render() },
  }
}
