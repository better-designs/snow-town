// Instanced sprites: a two-arm spiral built from instanceIndex (tsl-instancing-and-sprites).
import * as THREE from 'three/webgpu'
import { Fn, instanceIndex, hash, vec3, float, time, uv, mix, color, smoothstep, cos, sin } from 'three/tsl'

export async function setup({ scene, camera, controls, phone, params, setRow }) {
  const count = Number(params.get('count')) || (phone ? 60000 : 200000)
  setRow('Try', `${count.toLocaleString()} sprites. Add &count=500000 to the address to push the device.`)
  scene.background = new THREE.Color('#04050a')
  camera.position.set(0, 6, 9)
  controls.target.set(0, 0, 0)

  const material = new THREE.SpriteNodeMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })

  material.positionNode = Fn(() => {
    const t = hash(instanceIndex)
    const radius = t.pow(1.7).mul(6)
    const arm = instanceIndex.mod(2).toFloat().mul(Math.PI)
    const swirl = time.mul(0.6).div(radius.add(1.2))
    const angle = arm.add(radius.mul(0.85)).add(swirl)
    const spread = t.oneMinus().mul(1.6).add(0.15)
    // Scatter in a flattened ball, not a box: a box shows up as a square at the core.
    const direction = vec3(
      hash(instanceIndex.add(11)).sub(0.5),
      hash(instanceIndex.add(23)).sub(0.5),
      hash(instanceIndex.add(37)).sub(0.5)
    ).normalize()
    const reach = hash(instanceIndex.add(41)).pow(1 / 3).mul(spread)
    const jitter = direction.mul(reach).mul(vec3(1, 0.25, 1))
    return vec3(cos(angle).mul(radius), 0, sin(angle).mul(radius)).add(jitter)
  })()

  material.scaleNode = hash(instanceIndex.add(5)).mul(0.035).add(0.012)

  material.colorNode = Fn(() => {
    const d = uv().sub(0.5).length()
    const disc = float(1).sub(smoothstep(0.05, 0.5, d))
    const tint = mix(color('#ffb36b'), color('#6fa8ff'), hash(instanceIndex).pow(0.6))
    return tint.mul(disc).mul(0.22)
  })()

  const sprites = new THREE.Sprite(material)
  sprites.count = count
  sprites.frustumCulled = false
  scene.add(sprites)
}
