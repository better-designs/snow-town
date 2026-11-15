// Hold to steer: while the pointer or a finger is down, report the point on the ground it aims at.
// The target is re-read every frame, so a still finger keeps aiming correctly while the camera follows.
import * as THREE from 'three/webgpu'

export function createHoldTarget(camera, element, height = 0) {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height)
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const point = new THREE.Vector3()
  const state = { holding: false, x: 0, y: 0 }
  element.addEventListener('pointerdown', (e) => {
    state.holding = true
    state.x = e.clientX
    state.y = e.clientY
    try { element.setPointerCapture(e.pointerId) } catch {}
  })
  element.addEventListener('pointermove', (e) => { state.x = e.clientX; state.y = e.clientY })
  for (const ev of ['pointerup', 'pointercancel']) element.addEventListener(ev, () => { state.holding = false })
  return {
    get holding() { return state.holding },
    aim() {
      ndc.set((state.x / innerWidth) * 2 - 1, -(state.y / innerHeight) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      return raycaster.ray.intersectPlane(plane, point) ? point : null
    },
  }
}

// The camera keeps one angle over the platform and slides toward the subject on narrow screens.
export function createDioramaCamera(camera, size, { followWide = 0.3, followNarrow = 1, narrowScale = 0.75 } = {}) {
  const k = size / 10
  const offset = new THREE.Vector3(0, 6 * k, 8 * k)
  const look = new THREE.Vector3()
  const goal = new THREE.Vector3()
  return {
    update(subject, dt) {
      const narrow = camera.aspect < 1
      const follow = narrow ? followNarrow : followWide
      const scale = narrow ? narrowScale : 1
      goal.set(subject.x * follow, 0, subject.z * follow)
      look.lerp(goal, dt > 0 ? 1 - Math.exp(-3 * dt) : 1)
      camera.position.copy(look).addScaledVector(offset, scale)
      camera.lookAt(look)
    },
  }
}
