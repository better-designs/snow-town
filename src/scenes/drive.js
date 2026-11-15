// Snow town: an original open-world delivery game. Tyre tracks are pressed into a storage texture
// by a compute pass (tsl-stylized-environments), snow falls as sprites, and lights glow through bloom.
import * as THREE from 'three/webgpu'
import {
  Fn, Loop, uniform, uniformArray, instanceIndex, uvec2, vec2, vec3, vec4, float, min, max, mix, smoothstep, step,
  hash, time, uv, texture, storageTexture, deltaTime, positionWorld, normalWorld, transformNormalToView, color, pass, fract, floor,
} from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'

const SIZE = 64
const STREETS = [-30, -15, 0, 15, 30]
const ROAD = 6

function randomStreetPoint() {
  const line = STREETS[1 + Math.floor(Math.random() * 3)]
  const along = (Math.random() - 0.5) * 54
  return Math.random() < 0.5 ? new THREE.Vector3(line, 0, along) : new THREE.Vector3(along, 0, line)
}

function buildCar() {
  const car = new THREE.Group()
  const paint = new THREE.MeshStandardNodeMaterial({ color: '#d2493a', roughness: 0.35, metalness: 0.3 })
  const glass = new THREE.MeshStandardNodeMaterial({ color: '#1b2430', roughness: 0.1, metalness: 0.6 })
  const rubber = new THREE.MeshStandardNodeMaterial({ color: '#16181c', roughness: 0.9 })
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 3.6), paint)
  body.position.y = 0.6
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 1.9), glass)
  cabin.position.set(0, 1.17, -0.25)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.08, 1.7), paint)
  roof.position.set(0, 1.46, -0.25)
  car.add(body, cabin, roof)
  const wheelGeometry = new THREE.CylinderGeometry(0.38, 0.38, 0.32, 20).rotateZ(Math.PI / 2)
  for (const [x, z] of [[-0.95, 1.15], [0.95, 1.15], [-0.95, -1.15], [0.95, -1.15]]) {
    const wheel = new THREE.Mesh(wheelGeometry, rubber)
    wheel.position.set(x, 0.38, z)
    car.add(wheel)
  }
  const head = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('#fff4d6').multiplyScalar(4) })
  const tail = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('#ff2a1a').multiplyScalar(3) })
  for (const x of [-0.6, 0.6]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.05), head)
    h.position.set(x, 0.68, 1.81)
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.05), tail)
    t.position.set(x, 0.7, -1.81)
    car.add(h, t)
  }
  const beam = new THREE.SpotLight('#fff1d0', 60, 34, 0.55, 0.6, 1.2)
  beam.position.set(0, 0.9, 1.7)
  beam.target.position.set(0, 0, 9)
  car.add(beam, beam.target)
  return car
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

export async function setup({ renderer, scene, camera, controls, isWebGPU, phone, setRow }) {
  setRow('Try', phone ? 'Hold Gas and steer with Left and Right. Brake while turning to slide.' : 'Arrow keys or WASD to drive. Space is the handbrake: hold it in a turn to drift.')
  controls.enabled = false
  scene.background = new THREE.Color('#1c2536')
  scene.fog = new THREE.FogExp2('#1c2536', 0.03)
  scene.add(new THREE.HemisphereLight(0xa9bde0, 0x4a5262, 2.2))
  const moon = new THREE.DirectionalLight(0xb4c6ff, 1.2)
  moon.position.set(-20, 30, 10)
  scene.add(moon)
  camera.near = 0.3
  camera.far = 200
  camera.updateProjectionMatrix()

  const solids = buildTown(scene)
  const car = buildCar()
  scene.add(car)
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
  let tracks = null
  if (isWebGPU) {
    const heightTexture = new THREE.StorageTexture(RES, RES)
    heightTexture.format = THREE.RedFormat
    heightTexture.type = THREE.FloatType
    const height = storageTexture(heightTexture).setAccess(THREE.NodeAccess?.READ_WRITE ?? 'readWrite')
    const texel = () => uvec2(instanceIndex.mod(RES), instanceIndex.div(RES))
    const fill = Fn(() => { height.store(texel(), vec4(1, 0, 0, 0)) })().compute(RES * RES)
    tracks = Fn(() => {
      const t = texel()
      const world = t.toVec2().add(0.5).div(RES).sub(0.5).mul(SIZE)
      const h = height.load(t).r.add(deltaTime.min(1 / 30).mul(0.01)).min(1).toVar()
      Loop(4, ({ i }) => {
        const w = wheels.element(i)
        const a = w.zw
        const ab = w.xy.sub(a)
        const ap = world.sub(a)
        const k = ap.dot(ab).div(max(ab.dot(ab), 1e-5)).clamp(0, 1)
        const d = ap.sub(ab.mul(k)).length()
        h.assign(min(h, smoothstep(0.1, 0.2, d).mul(0.85).add(0.15)))
      })
      height.store(t, vec4(h, 0, 0, 0))
    })().compute(RES * RES)
    renderer.compute(fill)

    const st = positionWorld.xz.div(SIZE).add(0.5)
    const e = 1 / RES
    const sample = (o) => texture(heightTexture, st.add(o)).r
    const press = sample(vec2(0, 0))
    ground.material.colorNode = mix(packed, mix(fresh, road, roadMask), smoothstep(0.15, 1, press))
    const dx = sample(vec2(e, 0)).sub(sample(vec2(-e, 0)))
    const dz = sample(vec2(0, e)).sub(sample(vec2(0, -e)))
    const n = vec3(dx.mul(-6), float(1), dz.mul(-6)).normalize()
    ground.material.normalNode = transformNormalToView(vec3(n.x, n.z.negate(), n.y))
  } else {
    ground.material.colorNode = mix(fresh, road, roadMask)
    setRow('Tyre tracks', 'Off: needs WebGPU storage textures. Driving still works.', 'bad')
  }

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
  const wheelOffsets = [[-0.95, 1.15], [0.95, 1.15], [-0.95, -1.15], [0.95, -1.15]]
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

  const camTarget = new THREE.Vector3()
  return {
    ownsCamera: true,
    update(rawDt) {
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
        const px = s.hx + 1.1 - Math.abs(ox)
        const pz = s.hz + 1.1 - Math.abs(oz)
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

      if (tracks) {
        wheelOffsets.forEach(([ox, oz], i) => {
          const wx = state.x + ox * nfz + oz * nfx
          const wz = state.z - ox * nfx + oz * nfz
          if (firstFrame) wheelPrev[i].set(wx, wz)
          wheels.array[i].set(wx, wz, wheelPrev[i].x, wheelPrev[i].y)
          wheelPrev[i].set(wx, wz)
        })
        firstFrame = false
        renderer.compute(tracks)
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

      arrow.position.set(state.x, 2.4, state.z)
      arrow.lookAt(goal.x, 2.4, goal.z)

      // Chase camera.
      // A portrait phone sees less to the sides, so the camera sits further back and higher.
      const back = camera.aspect < 1 ? 11 : 7.5
      camTarget.set(state.x - nfx * back, back * 0.5, state.z - nfz * back)
      camera.position.lerp(camTarget, 1 - Math.exp(-4 * dt))
      camera.lookAt(state.x + nfx * 3, 1, state.z + nfz * 3)
      snowCenter.value.set(state.x, 0, state.z)
      forward.set(nfx, nfz)
    },
    render() { pipeline.render() },
  }
}
