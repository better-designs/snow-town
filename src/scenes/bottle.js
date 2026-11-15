// Product page: colour swatches wipe a new colour up the bottle, and the finish switches matte and gloss (tsl-fundamentals).
import * as THREE from 'three/webgpu'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { uniform, positionLocal, uv, float, mix, smoothstep, mx_noise_float, color } from 'three/tsl'

const COLOURS = [
  { name: 'Sage', hex: '#8fa58b' },
  { name: 'Clay', hex: '#c4765a' },
  { name: 'Ink', hex: '#2c3a4f' },
  { name: 'Sand', hex: '#d8c7a6' },
]
const HEIGHT = 1.86

export async function setup({ renderer, scene, camera, controls, ui, params, setRow }) {
  setRow('Try', 'Pick a colour: it should wipe up the bottle. Switch Matte and Gloss to see the reflections change.')
  scene.background = new THREE.Color('#f4efe8')
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  camera.position.set(0, 1.5, 4.6)
  controls.target.set(0, 1.05, 0)
  controls.autoRotate = true
  controls.autoRotateSpeed = 1.2

  const key = new THREE.DirectionalLight(0xffffff, 1.2)
  key.position.set(2, 4, 3)
  scene.add(key)

  const start = COLOURS.find((c) => c.name === params.get('colour')) ?? COLOURS[0]
  const from = uniform(new THREE.Color(start.hex))
  const to = uniform(new THREE.Color(start.hex))
  const wipe = uniform(1.2)
  const roughness = uniform(0.6)
  const coat = uniform(0)
  const matte = uniform(1)

  const body = new THREE.MeshPhysicalNodeMaterial({ metalness: 0.1 })
  const height = positionLocal.y.div(HEIGHT)
  const reached = float(1).sub(smoothstep(wipe.sub(0.05), wipe.add(0.05), height))
  body.colorNode = mix(from, to, reached)
  body.roughnessNode = roughness.add(mx_noise_float(positionLocal.mul(70)).mul(0.08).mul(matte))
  body.clearcoatNode = coat
  body.clearcoatRoughnessNode = float(0.08)

  const shell = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.33, 0), new THREE.Vector2(0.37, 0.04),
    new THREE.Vector2(0.38, 0.12), new THREE.Vector2(0.38, 1.46), new THREE.Vector2(0.36, 1.57),
    new THREE.Vector2(0.29, 1.71), new THREE.Vector2(0.22, 1.8), new THREE.Vector2(0.215, HEIGHT), new THREE.Vector2(0, HEIGHT),
  ], 96), body)
  const capMaterial = new THREE.MeshStandardNodeMaterial({ color: '#23272e', roughness: 0.55 })
  const cap = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0, HEIGHT), new THREE.Vector2(0.235, HEIGHT), new THREE.Vector2(0.245, 1.9),
    new THREE.Vector2(0.245, 2.16), new THREE.Vector2(0.225, 2.22), new THREE.Vector2(0, 2.23),
  ], 64), capMaterial)
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.032, 12, 40), capMaterial)
  loop.position.y = 2.33
  const bottle = new THREE.Group()
  bottle.add(shell, cap, loop)
  scene.add(bottle)

  const shadowMaterial = new THREE.MeshBasicNodeMaterial({ color: '#3b3128', transparent: true, depthWrite: false })
  shadowMaterial.opacityNode = float(1).sub(smoothstep(0.05, 0.5, uv().sub(0.5).length())).mul(0.28)
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), shadowMaterial)
  contact.rotation.x = -Math.PI / 2
  contact.position.y = 0.001
  scene.add(contact)

  ui.innerHTML = `
    <section class="ds-card scene-card" aria-labelledby="bottle-title">
      <div>
        <h1 class="ds-display" id="bottle-title">Insulated bottle</h1>
        <p class="ds-supporting">750 ml of steel. Keeps drinks cold for 24 hours.</p>
      </div>
      <div class="scene-split">
        <span class="scene-price">$34</span>
        <span>Free delivery</span>
      </div>
      <fieldset class="ds-field" style="border: 0; padding: 0; margin: 0">
        <legend class="ds-label" id="bottle-colour-label">Colour: ${start.name}</legend>
        <div class="scene-row" id="bottle-colours">
          ${COLOURS.map((c) => `<button class="ds-chip" type="button" data-colour="${c.name}" aria-pressed="${c === start}"><span class="scene-swatch" style="background: ${c.hex}"></span>${c.name}</button>`).join('')}
        </div>
      </fieldset>
      <fieldset class="ds-field" style="border: 0; padding: 0; margin: 0">
        <legend class="ds-label">Finish</legend>
        <div class="scene-row" id="bottle-finish">
          <button class="ds-chip" type="button" data-finish="matte" aria-pressed="true">Matte</button>
          <button class="ds-chip" type="button" data-finish="gloss" aria-pressed="false">Gloss</button>
        </div>
      </fieldset>
      <a class="ds-btn ds-btn-primary ds-btn-lg" id="bottle-buy" href="?demo=confirmed&colour=${start.name}">Buy now</a>
    </section>`

  let current = start
  const label = ui.querySelector('#bottle-colour-label')
  const buy = ui.querySelector('#bottle-buy')
  ui.querySelector('#bottle-colours').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-colour]')
    if (!chip || chip.dataset.colour === current.name) return
    current = COLOURS.find((c) => c.name === chip.dataset.colour)
    from.value.copy(to.value)
    to.value.set(current.hex)
    wipe.value = -0.1
    label.textContent = `Colour: ${current.name}`
    buy.href = `?demo=confirmed&colour=${current.name}`
    for (const b of ui.querySelectorAll('[data-colour]')) b.setAttribute('aria-pressed', String(b === chip))
  })
  let target = { roughness: 0.6, coat: 0, matte: 1 }
  ui.querySelector('#bottle-finish').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-finish]')
    if (!chip) return
    target = chip.dataset.finish === 'gloss' ? { roughness: 0.16, coat: 1, matte: 0 } : { roughness: 0.6, coat: 0, matte: 1 }
    for (const b of ui.querySelectorAll('[data-finish]')) b.setAttribute('aria-pressed', String(b === chip))
  })

  return {
    update(dt) {
      if (wipe.value < 1.2) wipe.value = Math.min(1.2, wipe.value + dt * 1.6)
      const k = Math.min(1, dt * 6)
      roughness.value += (target.roughness - roughness.value) * k
      coat.value += (target.coat - coat.value) * k
      matte.value += (target.matte - matte.value) * k
    },
  }
}
