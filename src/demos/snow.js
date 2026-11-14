// Snow that keeps tracks: depth from below plus a read-write storage texture (tsl-stylized-environments).
import * as THREE from 'three/webgpu'
import { Fn, instanceIndex, uniform, uvec2, ivec2, vec2, vec3, vec4, float, add, min, mix, texture, storageTexture, deltaTime, positionLocal, normalLocal, cross } from 'three/tsl'

export async function setup({ renderer, scene, camera, controls, isWebGPU, phone, setRow }) {
  scene.background = new THREE.Color('#c9d4e2')
  scene.fog = new THREE.Fog('#c9d4e2', 12, 30)
  camera.position.set(0, 6, 8)
  controls.target.set(0, 0, 0)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8094ad, 1.6))
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.6)
  sunLight.position.set(4, 8, 3)
  scene.add(sunLight)

  if (!isWebGPU) {
    setRow('Snow', 'Skipped: needs WebGPU storage textures, and this device runs WebGL 2.', 'bad')
    const plain = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardNodeMaterial({ color: '#f4f7fb', roughness: 0.9 }))
    plain.rotation.x = -Math.PI / 2
    scene.add(plain)
    return {}
  }

  const SIZE = 10
  const RES = phone ? 256 : 512
  const thickness = uniform(0.3)
  const margin = uniform(1)
  setRow('Try', 'Drag on the snow to steer the ball. Tracks should stay, blur and slowly fill back in.')

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE, SIZE, RES, RES),
    new THREE.MeshStandardNodeMaterial({ color: '#f6f9fc', roughness: 0.85 })
  )
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 32, 16), new THREE.MeshStandardNodeMaterial({ color: '#e2553f', roughness: 0.4 }))
  ball.position.y = 0.3
  scene.add(ball)

  // Depth from below the floor, looking up.
  const near = 1
  const half = SIZE / 2
  const depthCamera = new THREE.OrthographicCamera(-half, half, half, -half, near, near + margin.value + thickness.value)
  depthCamera.position.y = -(near + margin.value)
  depthCamera.rotation.x = Math.PI / 2
  const depthTarget = new THREE.RenderTarget(RES, RES)
  depthTarget.depthTexture = new THREE.DepthTexture(RES, RES)
  const flat = new THREE.NodeMaterial()
  flat.fragmentNode = vec4(0, 0, 0, 1)

  // Persistent snow height. Red + float is the only read-write format every browser accepts.
  const heightTexture = new THREE.StorageTexture(RES, RES)
  heightTexture.format = THREE.RedFormat
  heightTexture.type = THREE.FloatType
  const height = storageTexture(heightTexture).setAccess(THREE.NodeAccess?.READ_WRITE ?? 'readWrite')
  const texel = () => uvec2(instanceIndex.mod(RES), instanceIndex.div(RES))

  const fill = Fn(() => { height.store(texel(), vec4(thickness, 0, 0, 0)) })().compute(RES * RES)

  const settle = Fn(() => {
    const t = texel()
    const st = t.toVec2().add(0.5).div(RES)
    const dt = deltaTime.min(1 / 30)
    const here = height.load(t).r
    const h = here.add(dt.mul(0.02)).toVar()
    const neighbours = add(
      here,
      height.load(t.add(ivec2(1, 0))).r,
      height.load(t.add(ivec2(-1, 0))).r,
      height.load(t.add(ivec2(0, 1))).r,
      height.load(t.add(ivec2(0, -1))).r
    ).div(5)
    h.assign(mix(h, neighbours, dt.mul(4)))
    const reach = texture(depthTarget.depthTexture, st).r.remapClamp(margin.div(thickness.add(margin)), 1, 0, thickness)
    h.assign(min(h, reach))
    height.store(t, vec4(h, 0, 0, 0))
  })().compute(RES * RES)

  renderer.compute(fill)

  const heightAt = Fn(([xy]) => texture(heightTexture, xy.div(SIZE).add(0.5)).r)
  floor.material.positionNode = Fn(() => {
    const p = positionLocal.toVar()
    p.z.addAssign(heightAt(p.xy))
    const d = SIZE / RES
    const a = positionLocal.add(vec3(d, 0, 0)).toVar()
    const b = positionLocal.add(vec3(0, d, 0)).toVar()
    a.z.addAssign(heightAt(a.xy))
    b.z.addAssign(heightAt(b.xy))
    normalLocal.assign(cross(a.sub(p).normalize(), b.sub(p).normalize()))
    return p
  })()

  // Steering: drag on the floor plane; idle, the ball draws a figure eight.
  const target = new THREE.Vector3()
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const raycaster = new THREE.Raycaster()
  let steering = false
  let idle = 0
  function aim(e) {
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    if (raycaster.ray.intersectPlane(plane, target)) { idle = 0; return true }
    return false
  }
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (aim(e) && Math.abs(target.x) < half && Math.abs(target.z) < half) { steering = true; controls.enabled = false }
  })
  addEventListener('pointermove', (e) => { if (steering) aim(e) })
  addEventListener('pointerup', () => { steering = false; controls.enabled = true })

  let clock = 0
  return {
    update(dt) {
      clock += dt
      idle += dt
      if (idle > 3) target.set(Math.sin(clock * 0.6) * 3.2, 0, Math.sin(clock * 1.2) * 1.8)
      ball.position.x += (target.x - ball.position.x) * Math.min(1, dt * 4)
      ball.position.z += (target.z - ball.position.z) * Math.min(1, dt * 4)
      ball.rotation.z -= dt * 2
    },
    render() {
      floor.visible = false
      scene.overrideMaterial = flat
      renderer.setRenderTarget(depthTarget)
      renderer.render(scene, depthCamera)
      renderer.setRenderTarget(null)
      scene.overrideMaterial = null
      floor.visible = true
      renderer.compute(settle)
      renderer.render(scene, camera)
    },
  }
}
