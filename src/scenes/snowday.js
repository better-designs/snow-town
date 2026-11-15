// Weather card: falling snow, and ground that keeps the marks your finger draws (tsl-stylized-environments).
import * as THREE from 'three/webgpu'
import { Fn, instanceIndex, vec3, float, hash, time, uv, smoothstep } from 'three/tsl'
import { createSnowfield } from '../lib/snowfield.js'

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

export async function setup({ renderer, scene, camera, controls, ui, phone, setRow }) {
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
  const DEPTH = 0.25
  // Finger drawing presses a groove through the shared snow surface, so it works on WebGPU and on Safari's WebGL 2.
  const field = createSnowfield({ renderer, size: SIZE, res: phone ? 256 : 384, depth: DEPTH, segments: 1, tyre: 0.22, refillRate: 0.012, blurRate: 2 })
  scene.add(field.mesh)
  setRow('Try', 'Drag on the snow to draw. Marks stay, soften and slowly fill back in.')

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -DEPTH)
  const raycaster = new THREE.Raycaster()
  const hit = new THREE.Vector3()
  const from = new THREE.Vector2(NaN, NaN)
  const to = new THREE.Vector2(NaN, NaN)
  let drawing = false
  let lift = false
  function aim(e) {
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    if (!raycaster.ray.intersectPlane(plane, hit) || Math.abs(hit.x) > SIZE / 2 || Math.abs(hit.z) > SIZE / 2) return false
    to.set(hit.x, hit.z)
    if (Number.isNaN(from.x)) from.copy(to)
    return true
  }
  renderer.domElement.addEventListener('pointerdown', (e) => { if (aim(e)) { drawing = true; controls.enabled = false } })
  addEventListener('pointermove', (e) => { if (drawing) aim(e) })
  addEventListener('pointerup', () => { if (drawing) lift = true; drawing = false; controls.enabled = true })

  return {
    update(dt) {
      if (!Number.isNaN(from.x)) field.segments[0].set(from.x, from.y, to.x, to.y)
      field.update(Math.min(dt, 1 / 30))
      from.copy(to)
      if (lift) { lift = false; from.set(NaN, NaN); to.set(NaN, NaN); field.segments[0].set(1e4, 1e4, 1e4, 1e4) }
    },
  }
}
