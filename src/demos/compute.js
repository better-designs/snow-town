// GPU sparks: storage buffers, a spawn pass and an update pass (tsl-compute-simulations).
import * as THREE from 'three/webgpu'
import { Fn, If, instancedArray, instanceIndex, uniform, vec3, float, hash, deltaTime, uv, mix, color, smoothstep, cos, sin, TWO_PI } from 'three/tsl'

export async function setup({ renderer, scene, camera, controls, isWebGPU, phone, setRow }) {
  const COUNT = phone ? 40000 : 120000
  const BURST = phone ? 2000 : 5000
  setRow('Try', `Tap the floor to fire ${BURST.toLocaleString()} sparks. ${isWebGPU ? 'Compute runs natively.' : 'Compute is emulated on WebGL 2.'}`)
  scene.background = new THREE.Color('#0b0c10')
  camera.position.set(0, 4, 9)
  controls.target.set(0, 0.5, 0)

  const grid = new THREE.GridHelper(12, 24, 0x3a3f4d, 0x23262f)
  scene.add(grid)

  const position = instancedArray(COUNT, 'vec3')
  const velocity = instancedArray(COUNT, 'vec3')
  const life = instancedArray(COUNT, 'float')

  const origin = uniform(new THREE.Vector3())
  const first = uniform(0, 'uint')
  const seed = uniform(0, 'uint')

  // Every thread writes only its own slot: the WebGL 2 fallback cannot write to another thread's element.
  const spawn = Fn(() => {
    const slot = instanceIndex.add(COUNT).sub(first).mod(COUNT)
    If(slot.lessThan(BURST), () => {
      const s = instanceIndex.add(seed)
      const heading = hash(s).mul(TWO_PI)
      const outward = hash(s.add(7)).mul(2.4)
      const upward = hash(s.add(13)).mul(5).add(2.5)
      position.element(instanceIndex).assign(origin)
      velocity.element(instanceIndex).assign(vec3(cos(heading).mul(outward), upward, sin(heading).mul(outward)))
      life.element(instanceIndex).assign(float(1))
    })
  })().compute(COUNT)

  const step = Fn(() => {
    const p = position.element(instanceIndex)
    const v = velocity.element(instanceIndex)
    const l = life.element(instanceIndex)
    If(l.greaterThan(0), () => {
      const dt = deltaTime.min(1 / 30)
      v.y.subAssign(dt.mul(9.8))
      p.addAssign(v.mul(dt))
      If(p.y.lessThan(0), () => {
        p.y.assign(0)
        v.y.assign(v.y.abs().mul(0.45))
        v.x.mulAssign(0.8)
        v.z.mulAssign(0.8)
      })
      l.subAssign(dt.mul(0.4))
    })
  })().compute(COUNT)

  const lifeAttr = life.toAttribute()
  const material = new THREE.SpriteNodeMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
  material.positionNode = position.toAttribute()
  material.scaleNode = lifeAttr.max(0).mul(0.07)
  material.colorNode = Fn(() => {
    const l = lifeAttr.max(0)
    const disc = float(1).sub(smoothstep(0.1, 0.5, uv().sub(0.5).length()))
    return mix(color('#ff4a1c'), color('#fff1b0'), l).mul(disc).mul(l.mul(2.5))
  })()
  const sparks = new THREE.Sprite(material)
  sparks.count = COUNT
  sparks.frustumCulled = false
  scene.add(sparks)

  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const raycaster = new THREE.Raycaster()
  const hit = new THREE.Vector3()
  function fire(at) {
    origin.value.copy(at)
    seed.value = (Math.random() * 1e6) | 0
    renderer.compute(spawn)
    first.value = (first.value + BURST) % COUNT
  }
  renderer.domElement.addEventListener('pointerdown', (e) => {
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    if (raycaster.ray.intersectPlane(ground, hit)) fire(hit)
  })

  let wait = 0
  return {
    update(dt) {
      wait -= dt
      if (wait <= 0) {
        wait = 1.1
        fire(new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 4))
      }
      renderer.compute(step)
    },
  }
}
