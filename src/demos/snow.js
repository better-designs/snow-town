// Snow ball: hold the pointer or a finger on the snow and the ball rolls toward it, pressing a groove as it goes.
import * as THREE from 'three/webgpu'
import { float, smoothstep, uv } from 'three/tsl'
import { createSnowfield, createPlatform } from '../lib/snowfield.js'
import { createHoldTarget, createDioramaCamera } from '../lib/hold.js'

const SIZE = 10
const DEPTH = 0.3
const RADIUS = 0.45

export async function setup({ renderer, scene, camera, controls, phone, params, setRow }) {
  setRow('Try', 'Hold the pointer or a finger on the snow: the ball rolls toward it. Tracks stay, soften and slowly fill in.')
  controls.enabled = false
  scene.background = new THREE.Color('#c9d4e2')
  scene.fog = new THREE.Fog('#c9d4e2', 20, 45)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8094ad, 1.5))
  const sun = new THREE.DirectionalLight(0xfff4e6, 1.8)
  sun.position.set(-5, 8, 4)
  scene.add(sun)

  const field = createSnowfield({ renderer, size: SIZE, res: phone ? 256 : 384, depth: DEPTH, spheres: 1, refillRate: 0.02, blurRate: 3 })
  const platform = createPlatform(SIZE, DEPTH)
  scene.add(field.mesh, platform)

  const ball = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 48, 24), new THREE.MeshStandardNodeMaterial({ color: '#e2553f', roughness: 0.4 }))
  ball.position.set(0, RADIUS, 2)
  scene.add(ball)
  // A soft contact shadow under the ball. The sun's shadow map darkened the whole displaced field on Safari's path.
  const blob = new THREE.MeshBasicNodeMaterial({ color: '#4a5566', transparent: true, depthWrite: false })
  blob.opacityNode = float(1).sub(smoothstep(0.1, 0.5, uv().sub(0.5).length())).mul(0.45)
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(RADIUS * 2.6, RADIUS * 2.6), blob)
  contact.rotation.x = -Math.PI / 2
  scene.add(contact)

  const hold = createHoldTarget(camera, renderer.domElement, RADIUS)
  const view = createDioramaCamera(camera, SIZE, { followWide: 0, followNarrow: 0.35, narrowScale: 1.25 })
  const autodrive = params.get('autodrive') === '1'
  const velocity = new THREE.Vector3()
  const axis = new THREE.Vector3()
  const spin = new THREE.Quaternion()
  view.update(ball.position, 0)

  return {
    ownsCamera: true,
    update(rawDt, elapsed) {
      const dt = Math.min(rawDt, 1 / 30)
      let target = hold.holding ? hold.aim() : null
      if (autodrive) target = new THREE.Vector3(Math.sin(elapsed * 0.6) * 3, RADIUS, Math.sin(elapsed * 1.2) * 1.8)
      // Pull toward the target with a little momentum, so the ball rolls rather than snaps.
      if (target) {
        velocity.x += (target.x - ball.position.x) * 6 * dt
        velocity.z += (target.z - ball.position.z) * 6 * dt
      }
      velocity.multiplyScalar(Math.exp(-(target ? 2.5 : 1.6) * dt))
      const speed = Math.hypot(velocity.x, velocity.z)
      if (speed > 3.5) velocity.multiplyScalar(3.5 / speed)
      ball.position.x = THREE.MathUtils.clamp(ball.position.x + velocity.x * dt, -SIZE / 2 + RADIUS + 0.3, SIZE / 2 - RADIUS - 0.3)
      ball.position.z = THREE.MathUtils.clamp(ball.position.z + velocity.z * dt, -SIZE / 2 + RADIUS + 0.3, SIZE / 2 - RADIUS - 0.3)
      // Roll about the axis across the direction of travel.
      if (speed > 1e-4) {
        axis.set(velocity.z, 0, -velocity.x).normalize()
        spin.setFromAxisAngle(axis, (speed * dt) / RADIUS)
        ball.quaternion.premultiply(spin)
      }
      field.spheres[0].set(ball.position.x, ball.position.z, RADIUS, RADIUS)
      contact.position.set(ball.position.x, 0.02, ball.position.z)
      field.update(dt)
      view.update(ball.position, dt)
    },
  }
}
