// Snow town: a small car on a miniature snowy town, built as a diorama on a platform.
// Hold the pointer or a finger down and the car drives toward it; its tyres press grooves into the snow.
import * as THREE from 'three/webgpu'
import { float, smoothstep, uv, time, hash, instanceIndex, vec2, vec3, Fn } from 'three/tsl'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { createSnowfield, createPlatform } from '../lib/snowfield.js'
import { buildTown } from '../lib/town.js'
import { createHoldTarget, createDioramaCamera } from '../lib/hold.js'

const SIZE = 16
const DEPTH = 0.07
const CAR_LENGTH = 1.0
const MODEL_LENGTH = 4.36

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

function fallingSnow(count) {
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false })
  material.positionNode = Fn(() => {
    const y = hash(instanceIndex.add(3)).sub(time.mul(hash(instanceIndex.add(2)).mul(0.04).add(0.05))).fract().mul(7)
    const sway = time.mul(0.7).add(hash(instanceIndex.add(4)).mul(6.28)).sin().mul(0.15)
    return vec3(hash(instanceIndex).sub(0.5).mul(SIZE).add(sway), y, hash(instanceIndex.add(1)).sub(0.5).mul(SIZE))
  })()
  material.scaleNode = hash(instanceIndex.add(5)).mul(0.03).add(0.025)
  material.colorNode = vec3(1)
  material.opacityNode = float(1).sub(smoothstep(0.15, 0.5, uv().sub(0.5).length())).mul(0.85)
  const flakes = new THREE.Sprite(material)
  flakes.count = count
  flakes.frustumCulled = false
  return flakes
}

export async function setup({ renderer, scene, camera, controls, phone, params, setRow }) {
  setRow('Try', 'Hold the pointer or a finger on the snow: the car drives toward it and leaves tracks.')
  controls.enabled = false
  scene.background = new THREE.Color('#cfd9e6')
  scene.fog = new THREE.Fog('#cfd9e6', 30, 70)
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.45
  scene.add(new THREE.HemisphereLight(0xe2ecff, 0x9aa3ae, 1.3))
  const sun = new THREE.DirectionalLight(0xffe4c4, 2.6)
  sun.position.set(-9, 11, 6)
  sun.castShadow = true
  sun.shadow.mapSize.setScalar(phone ? 1024 : 2048)
  sun.shadow.radius = 3
  sun.shadow.bias = -0.0005
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 40 })
  scene.add(sun)

  const field = createSnowfield({ renderer, size: SIZE, res: phone ? 320 : 448, depth: DEPTH, segments: 4, tyre: 0.05, refillRate: 0.004, blurRate: 0.6 })
  scene.add(field.mesh, createPlatform(SIZE, DEPTH))
  const { group: town, solids } = buildTown({ size: SIZE })
  scene.add(town)
  scene.add(fallingSnow(phone ? 900 : 2200))

  const { car, wheels, scale } = await loadCar()
  scene.add(car)
  setRow('Car model', 'Car Concept, Khronos Group sample assets, after a public-domain model by Unity Fan. CC BY 4.0')

  const hold = createHoldTarget(camera, renderer.domElement, DEPTH)
  const view = createDioramaCamera(camera, SIZE)
  const autodrive = params.get('autodrive') === '1'
  const state = { x: 0, z: 5.6, heading: Math.PI, vx: 0, vz: 0 }
  const prev = WHEELS.map(() => new THREE.Vector2(NaN, NaN))
  let roll = 0
  let steerAngle = 0
  view.update(state, 0)

  return {
    ownsCamera: true,
    update(rawDt, elapsed) {
      const dt = Math.min(rawDt, 1 / 30)
      let target = hold.holding ? hold.aim() : null
      if (autodrive) target = new THREE.Vector3(Math.sin(elapsed * 0.5) * 4, 0, Math.sin(elapsed) * 2.6 + 1.5)

      // Aim the car at the target: steer by the angle to it, accelerate while it is more than a car length away.
      let throttle = 0
      let steer = 0
      if (target) {
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
      along += throttle * 4.5 * dt
      along *= Math.exp(-(target ? 0.6 : 2.2) * dt)
      along = Math.min(along, 3.4)
      side *= Math.exp(-4 * dt)
      state.heading += steer * 2.8 * dt * THREE.MathUtils.clamp(along / 1.2, -1, 1)
      const nfx = Math.sin(state.heading)
      const nfz = Math.cos(state.heading)
      state.vx = along * nfx + side * nfz
      state.vz = along * nfz - side * nfx
      state.x += state.vx * dt
      state.z += state.vz * dt

      for (const s of solids) {
        const ox = state.x - s.x
        const oz = state.z - s.z
        const px = s.hx + 0.4 - Math.abs(ox)
        const pz = s.hz + 0.4 - Math.abs(oz)
        if (px > 0 && pz > 0) {
          if (px < pz) { state.x += Math.sign(ox) * px; state.vx *= -0.2 } else { state.z += Math.sign(oz) * pz; state.vz *= -0.2 }
        }
      }
      const edge = SIZE / 2 - 0.7
      if (Math.abs(state.x) > edge) { state.x = Math.sign(state.x) * edge; state.vx *= -0.2 }
      if (Math.abs(state.z) > edge) { state.z = Math.sign(state.z) * edge; state.vz *= -0.2 }

      car.position.set(state.x, 0, state.z)
      car.rotation.y = state.heading
      roll += along * dt / (0.38 * scale)
      steerAngle += (steer * 0.5 - steerAngle) * Math.min(1, dt * 10)
      for (const w of wheels) w.node.rotation.set(roll, 0, w.front ? steerAngle : 0, 'ZYX')

      // Each wheel presses a groove from where it was last frame to where it is now.
      WHEELS.forEach((w, i) => {
        const wx = state.x + (w.x * nfz + w.z * nfx) * scale
        const wz = state.z + (-w.x * nfx + w.z * nfz) * scale
        if (Number.isNaN(prev[i].x)) prev[i].set(wx, wz)
        field.segments[i].set(prev[i].x, prev[i].y, wx, wz)
        prev[i].set(wx, wz)
      })
      field.update(dt)
      view.update(state, dt)
    },
  }
}
