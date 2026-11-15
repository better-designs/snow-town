// Order-ahead pickup screen: a cup with rising steam (smoke on a plane from tsl-procedural-effects).
import * as THREE from 'three/webgpu'
import { Fn, uv, vec2, vec3, color, time, mix, min, float, positionLocal, smoothstep, mx_noise_float, mx_noise_vec3 } from 'three/tsl'

function steamMaterial(phase) {
  const material = new THREE.MeshBasicNodeMaterial({ color: '#ffffff', transparent: true, depthWrite: false, side: THREE.DoubleSide })
  material.positionNode = Fn(() => {
    const p = positionLocal.toVar()
    const h = uv().y
    p.x.addAssign(time.mul(0.6).add(phase).add(h.mul(2.5)).sin().mul(h.mul(0.3)))
    const drift = mx_noise_vec3(vec3(p.x.mul(0.8), p.y.mul(0.8).sub(time.mul(0.3)), phase))
    p.addAssign(drift.mul(h.pow(1.5).mul(0.45)))
    return p
  })()
  material.opacityNode = Fn(() => {
    const wisps = mx_noise_float(vec3(uv().mul(vec2(2.5, 1.6)).sub(vec2(0, time.mul(0.12))), phase)).mul(0.5).add(0.5)
    const edges = min(uv().y.mul(6), uv().y.oneMinus().mul(1.3), uv().x.mul(4), uv().x.oneMinus().mul(4)).clamp(0, 1)
    return wisps.pow(2).mul(edges).mul(0.6)
  })()
  return material
}

export async function setup({ scene, camera, controls, ui, setRow }) {
  setRow('Try', 'Steam should rise and drift above the cup. The order moves to Ready in about 30 seconds.')
  scene.background = new THREE.Color('#f3ebe1')
  camera.position.set(0, 2.1, 3.6)
  controls.target.set(0, 0.75, 0)

  scene.add(new THREE.HemisphereLight(0xfff3e4, 0x8a6f58, 1.4))
  const key = new THREE.DirectionalLight(0xfff0dc, 2.2)
  key.position.set(-3, 5, 2)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.radius = 6
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 15 })
  scene.add(key)

  const tableMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 })
  const grain = mx_noise_float(uv().mul(vec2(3, 40))).mul(0.5).add(0.5)
  tableMaterial.colorNode = mix(color('#e2d3bf'), color('#d4c1a8'), grain)
  const table = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), tableMaterial)
  table.rotation.x = -Math.PI / 2
  table.receiveShadow = true
  scene.add(table)

  const ceramic = new THREE.MeshStandardNodeMaterial({ color: '#f8f4ee', roughness: 0.22 })
  const saucer = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.86, 0), new THREE.Vector2(0.95, 0.05),
    new THREE.Vector2(0.93, 0.07), new THREE.Vector2(0.55, 0.04), new THREE.Vector2(0, 0.04),
  ], 72), ceramic)
  const cup = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0, 0.04), new THREE.Vector2(0.38, 0.04), new THREE.Vector2(0.43, 0.09),
    new THREE.Vector2(0.5, 0.35), new THREE.Vector2(0.56, 0.72), new THREE.Vector2(0.58, 0.84),
    new THREE.Vector2(0.55, 0.84), new THREE.Vector2(0.53, 0.72), new THREE.Vector2(0.47, 0.36),
    new THREE.Vector2(0.4, 0.12), new THREE.Vector2(0, 0.12),
  ], 72), ceramic)
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.045, 16, 40, Math.PI * 1.25), ceramic)
  handle.position.set(0.58, 0.47, 0)
  handle.rotation.z = -Math.PI * 0.62
  for (const part of [saucer, cup, handle]) { part.castShadow = part.receiveShadow = true; scene.add(part) }

  const crema = new THREE.MeshStandardNodeMaterial({ roughness: 0.45 })
  crema.colorNode = Fn(() => {
    const r = uv().sub(0.5).length()
    const swirl = mx_noise_float(vec3(uv().mul(5), time.mul(0.04))).mul(0.06)
    const foam = float(1).sub(smoothstep(0.18, 0.32, r.add(swirl)))
    return mix(color('#7a4a2a'), color('#e6c9a4'), foam)
  })()
  const drink = new THREE.Mesh(new THREE.CircleGeometry(0.535, 64), crema)
  drink.rotation.x = -Math.PI / 2
  drink.position.y = 0.74
  scene.add(drink)

  for (const [i, angle] of [0, Math.PI / 2].entries()) {
    const geometry = new THREE.PlaneGeometry(0.55, 1.5, 20, 40)
    geometry.translate(0, 0.75, 0)
    const steam = new THREE.Mesh(geometry, steamMaterial(float(i * 3.7)))
    steam.position.y = 0.78
    steam.rotation.y = angle
    scene.add(steam)
  }

  ui.innerHTML = `
    <section class="ds-card scene-card" aria-labelledby="coffee-title">
      <div>
        <h1 class="ds-display" id="coffee-title">Oat flat white</h1>
        <p class="ds-supporting" id="coffee-line">Ready in about 4 min on the pickup shelf.</p>
      </div>
      <div class="ds-progress" role="progressbar" aria-label="Order progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="35">
        <div class="ds-progress-bar" id="coffee-bar" style="width: 35%"></div>
      </div>
      <div class="scene-split">
        <span>Order 214</span>
        <span class="ds-badge" id="coffee-badge">Making</span>
      </div>
      <div class="scene-actions">
        <button class="ds-btn ds-btn-primary ds-btn-lg" id="coffee-here" type="button">I'm here</button>
      </div>
    </section>`
  const line = ui.querySelector('#coffee-line')
  const bar = ui.querySelector('#coffee-bar')
  const badge = ui.querySelector('#coffee-badge')
  const here = ui.querySelector('#coffee-here')
  const progress = ui.querySelector('[role="progressbar"]')
  let arrived = false
  here.addEventListener('click', () => {
    arrived = true
    here.textContent = 'Arrival shared'
    here.className = 'ds-btn ds-btn-outline ds-btn-lg'
  })

  let done = 0.35
  return {
    update(dt) {
      if (done >= 1) return
      done = Math.min(1, done + dt / 30)
      const pct = Math.round(done * 100)
      bar.style.width = `${pct}%`
      progress.setAttribute('aria-valuenow', String(pct))
      if (done >= 1) {
        line.textContent = arrived ? 'Ready on the pickup shelf. The barista knows you are here.' : 'Ready on the pickup shelf.'
        badge.textContent = 'Ready'
        badge.className = 'ds-badge ds-badge-safe'
      } else {
        const minutes = Math.max(1, Math.ceil((1 - done) / 0.65 * 4))
        line.textContent = `Ready in about ${minutes} min on the pickup shelf.`
      }
    },
  }
}
