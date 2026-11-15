// Weather card: falling snow, and ground that keeps the marks your finger draws (tsl-stylized-environments).
import * as THREE from 'three/webgpu'
import { Fn, instanceIndex, uniform, uvec2, ivec2, vec3, vec4, float, add, min, mix, hash, time, uv, smoothstep, texture, storageTexture, deltaTime, positionLocal, normalLocal, cross } from 'three/tsl'

function fallingSnow(count) {
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false })
  material.positionNode = Fn(() => {
    const fall = hash(instanceIndex.add(2)).mul(0.05).add(0.05)
    const y = hash(instanceIndex.add(3)).sub(time.mul(fall)).fract().mul(6)
    const x = hash(instanceIndex).mul(14).sub(7).add(time.mul(0.7).add(hash(instanceIndex.add(4)).mul(6.28)).sin().mul(0.25))
    return vec3(x, y, hash(instanceIndex.add(1)).mul(10).sub(5))
  })()
  material.scaleNode = hash(instanceIndex.add(5)).mul(0.035).add(0.025)
  material.colorNode = vec3(1)
  material.opacityNode = float(1).sub(smoothstep(0.2, 0.5, uv().sub(0.5).length())).mul(0.9)
  const flakes = new THREE.Sprite(material)
  flakes.count = count
  flakes.frustumCulled = false
  return flakes
}

export async function setup({ renderer, scene, camera, controls, ui, isWebGPU, phone, setRow }) {
  scene.background = new THREE.Color('#c7d3e3')
  scene.fog = new THREE.Fog('#c7d3e3', 9, 22)
  camera.position.set(0, 5.2, 6.4)
  controls.target.set(0, 0, 0)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7f93ad, 1.5))
  const sun = new THREE.DirectionalLight(0xfff6ea, 1.4)
  sun.position.set(-4, 6, 2)
  scene.add(sun)
  scene.add(fallingSnow(phone ? 1500 : 4000))

  ui.innerHTML = `
    <section class="ds-card scene-card" aria-labelledby="weather-title">
      <div>
        <h1 class="ds-display" id="weather-title">Snow until 3 pm</h1>
        <p class="ds-supporting">About 8 cm by evening. Roads may be icy after dark.</p>
      </div>
      <div class="scene-temp">−2°</div>
      <div class="scene-hours">
        <div><span>Now</span><strong>−2°</strong></div>
        <div><span>1 pm</span><strong>−2°</strong></div>
        <div><span>2 pm</span><strong>−3°</strong></div>
        <div><span>3 pm</span><strong>−1°</strong></div>
      </div>
      <button class="ds-btn ds-btn-primary ds-btn-lg" id="weather-remind" type="button">Remind me when it stops</button>
    </section>`
  const remind = ui.querySelector('#weather-remind')
  remind.addEventListener('click', () => {
    remind.textContent = 'Reminder set for 3 pm'
    remind.className = 'ds-btn ds-btn-outline ds-btn-lg'
  })

  const SIZE = 12
  if (!isWebGPU) {
    setRow('Snow marks', 'Off: needs WebGPU storage textures. Falling snow still runs.', 'bad')
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshStandardNodeMaterial({ color: '#f5f8fc', roughness: 0.9 }))
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)
    return {}
  }
  setRow('Try', 'Drag on the snow to draw. Marks stay, soften and slowly fill back in.')

  const RES = phone ? 256 : 384
  const depth = uniform(0.25)
  const margin = uniform(1)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE, RES, RES), new THREE.MeshStandardNodeMaterial({ color: '#f7f9fc', roughness: 0.85 }))
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)

  // The fingertip exists only for the camera under the snow (layer 1), so nothing is drawn on screen.
  // A fast swipe skips ground between pointer events, so a row of tips fills the gap from the last point to this one.
  const TIPS = 40
  const tipGeometry = new THREE.SphereGeometry(0.22, 16, 8)
  const tipMaterial = new THREE.MeshBasicNodeMaterial()
  const tips = Array.from({ length: TIPS }, () => {
    const t = new THREE.Mesh(tipGeometry, tipMaterial)
    t.layers.set(1)
    t.position.y = 5
    scene.add(t)
    return t
  })
  const from = new THREE.Vector3()
  const now = new THREE.Vector3()
  let hasFrom = false
  let lift = false
  function layTips() {
    const n = Math.min(TIPS, Math.max(2, Math.ceil(from.distanceTo(now) / 0.12) + 1))
    tips.forEach((t, i) => t.position.lerpVectors(from, now, Math.min(i, n - 1) / (n - 1)))
  }

  const near = 1
  const half = SIZE / 2
  const under = new THREE.OrthographicCamera(-half, half, half, -half, near, near + margin.value + depth.value)
  under.position.y = -(near + margin.value)
  under.rotation.x = Math.PI / 2
  under.layers.set(1)
  const target = new THREE.RenderTarget(RES, RES)
  target.depthTexture = new THREE.DepthTexture(RES, RES)

  const heightTexture = new THREE.StorageTexture(RES, RES)
  heightTexture.format = THREE.RedFormat
  heightTexture.type = THREE.FloatType
  const height = storageTexture(heightTexture).setAccess(THREE.NodeAccess?.READ_WRITE ?? 'readWrite')
  const texel = () => uvec2(instanceIndex.mod(RES), instanceIndex.div(RES))
  const fill = Fn(() => { height.store(texel(), vec4(depth, 0, 0, 0)) })().compute(RES * RES)
  const settle = Fn(() => {
    const t = texel()
    const dt = deltaTime.min(1 / 30)
    const here = height.load(t).r
    const h = here.add(dt.mul(0.012)).toVar()
    const around = add(here, height.load(t.add(ivec2(1, 0))).r, height.load(t.add(ivec2(-1, 0))).r, height.load(t.add(ivec2(0, 1))).r, height.load(t.add(ivec2(0, -1))).r).div(5)
    h.assign(mix(h, around, dt.mul(2)))
    const reach = texture(target.depthTexture, t.toVec2().add(0.5).div(RES)).r.remapClamp(margin.div(depth.add(margin)), 1, 0, depth)
    h.assign(min(h, reach))
    height.store(t, vec4(h, 0, 0, 0))
  })().compute(RES * RES)
  renderer.compute(fill)

  const heightAt = Fn(([xy]) => texture(heightTexture, xy.div(SIZE).add(0.5)).r)
  ground.material.positionNode = Fn(() => {
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

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const raycaster = new THREE.Raycaster()
  const hit = new THREE.Vector3()
  let drawing = false
  function press(e) {
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    if (!raycaster.ray.intersectPlane(plane, hit) || Math.abs(hit.x) > half || Math.abs(hit.z) > half) return false
    now.set(hit.x, 0.1, hit.z)
    if (!hasFrom) { from.copy(now); hasFrom = true }
    return true
  }
  renderer.domElement.addEventListener('pointerdown', (e) => { if (press(e)) { drawing = true; controls.enabled = false } })
  addEventListener('pointermove', (e) => { if (drawing) press(e) })
  addEventListener('pointerup', () => { if (drawing) lift = true; drawing = false; controls.enabled = true })

  return {
    render() {
      if (hasFrom) layTips()
      renderer.setRenderTarget(target)
      renderer.render(scene, under)
      renderer.setRenderTarget(null)
      from.copy(now)
      if (lift) { lift = false; hasFrom = false; tips.forEach((t) => { t.position.y = 5 }) }
      renderer.compute(settle)
      renderer.render(scene, camera)
    },
  }
}
