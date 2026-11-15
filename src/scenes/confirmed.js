// Checkout success: confetti simulated with compute, each thread writing only its own slot (tsl-compute-simulations).
import * as THREE from 'three/webgpu'
import { Fn, If, instancedArray, instanceIndex, uniform, uniformArray, vec2, vec3, float, hash, deltaTime, time, smoothstep, select } from 'three/tsl'

export async function setup({ renderer, scene, camera, controls, ui, phone, params, setRow }) {
  const COUNT = phone ? 6000 : 15000
  const BURST = Math.floor(COUNT / 3)
  setRow('Try', 'Confetti bursts when the page opens. Tap the scene for another burst.')
  scene.background = new THREE.Color('#f6f1ea')
  camera.position.set(0, 0.5, 8)
  controls.target.set(0, 0.5, 0)
  controls.enableRotate = false

  const position = instancedArray(COUNT, 'vec3')
  const velocity = instancedArray(COUNT, 'vec3')
  const life = instancedArray(COUNT, 'float')
  const spin = instancedArray(COUNT, 'float')
  const first = uniform(0, 'uint')
  const edge = uniform(4.2)
  const seed = uniform(0, 'uint')

  const spawn = Fn(() => {
    const slot = instanceIndex.add(COUNT).sub(first).mod(COUNT)
    If(slot.lessThan(BURST), () => {
      const s = instanceIndex.add(seed)
      const side = select(hash(s).greaterThan(0.5), float(1), float(-1))
      position.element(instanceIndex).assign(vec3(side.mul(edge), -3.2, hash(s.add(3)).sub(0.5)))
      // A fan of directions, not a box of speeds: a box shows up as a square cloud.
      const angle = hash(s.add(5)).sub(0.5).mul(0.9).add(0.42)
      const speed = hash(s.add(7)).mul(5).add(10)
      velocity.element(instanceIndex).assign(vec3(
        side.negate().mul(angle.sin()).mul(speed),
        angle.cos().mul(speed),
        hash(s.add(9)).sub(0.5).mul(2.5)
      ))
      life.element(instanceIndex).assign(float(1))
      spin.element(instanceIndex).assign(hash(s.add(11)).mul(6.28))
    })
  })().compute(COUNT)

  const step = Fn(() => {
    const p = position.element(instanceIndex)
    const v = velocity.element(instanceIndex)
    const l = life.element(instanceIndex)
    If(l.greaterThan(0), () => {
      const dt = deltaTime.min(1 / 30)
      const wobble = hash(instanceIndex.add(13))
      v.y.subAssign(dt.mul(5))
      v.mulAssign(float(1).sub(dt.mul(1.6)))
      v.x.addAssign(time.mul(3).add(wobble.mul(20)).sin().mul(dt).mul(2))
      p.addAssign(v.mul(dt))
      spin.element(instanceIndex).addAssign(dt.mul(wobble.mul(10).sub(5)))
      l.subAssign(dt.mul(0.16))
    })
  })().compute(COUNT)

  const palette = uniformArray(['#ff6b4a', '#ffc94a', '#3fb27f', '#4a8dff', '#c56bff'].map((c) => new THREE.Color(c)), 'color')
  const lifeAttr = life.toAttribute()
  const spinAttr = spin.toAttribute()
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false })
  material.positionNode = position.toAttribute()
  material.rotationNode = spinAttr
  const flip = spinAttr.mul(1.7).sin().abs()
  const alive = smoothstep(0, 0.08, lifeAttr)
  material.scaleNode = vec2(flip.mul(0.11).add(0.015), float(0.06)).mul(alive)
  material.colorNode = palette.element(hash(instanceIndex).mul(5).floor().toInt())
  material.opacityNode = alive
  const confetti = new THREE.Sprite(material)
  confetti.count = COUNT
  confetti.frustumCulled = false
  scene.add(confetti)

  function burst() {
    seed.value = (Math.random() * 1e6) | 0
    renderer.compute(spawn)
    first.value = (first.value + BURST) % COUNT
  }
  renderer.domElement.addEventListener('pointerdown', burst)
  setTimeout(burst, 250)

  const colour = ['Sage', 'Clay', 'Ink', 'Sand'].includes(params.get('colour')) ? params.get('colour') : 'Sage'
  ui.innerHTML = `
    <section class="ds-card scene-card" aria-labelledby="order-title">
      <div>
        <h1 class="ds-display" id="order-title">Payment received</h1>
        <p class="ds-supporting" id="order-line">Order 4821 arrives Thursday. The receipt is in your email.</p>
      </div>
      <dl class="scene-lines">
        <div><dt>Insulated bottle, ${colour}</dt><dd>$34</dd></div>
        <div><dt>Delivery</dt><dd>Free</dd></div>
        <div class="scene-total"><dt>Total paid</dt><dd>$34</dd></div>
      </dl>
      <div class="scene-actions">
        <button class="ds-btn ds-btn-primary ds-btn-lg" id="order-track" type="button">Track order</button>
        <a class="ds-btn ds-btn-outline ds-btn-lg" href="?demo=bottle">Keep shopping</a>
      </div>
    </section>`
  ui.querySelector('#order-track').addEventListener('click', () => {
    ui.querySelector('#order-line').textContent = 'Packed today. It leaves the warehouse tomorrow morning.'
  })

  return {
    update() {
      // Launch from the edges the camera can see, so a narrow phone screen still shows both bursts.
      const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z / camera.zoom
      edge.value = Math.min(4.2, halfHeight * camera.aspect * 0.95)
      renderer.compute(step)
    },
  }
}
