// Hold to steer: while one pointer or one finger is down, report the point on the ground it aims at.
// The target is re-read every frame, so a still finger keeps aiming correctly while the camera follows.
// Two fingers pinch to zoom instead of steering.
import * as THREE from 'three/webgpu'

export function createHoldTarget(camera, element, height = 0, { onPinch } = {}) {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height)
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const point = new THREE.Vector3()
  const pointers = new Map()
  const state = { x: 0, y: 0 }
  let pinchFrom = 0
  const spread = () => {
    const [a, b] = [...pointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  element.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    state.x = e.clientX
    state.y = e.clientY
    if (pointers.size === 2) pinchFrom = spread()
    try { element.setPointerCapture(e.pointerId) } catch {}
  })
  element.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 2) {
      const now = spread()
      if (pinchFrom > 0 && now > 0) onPinch?.(pinchFrom / now)
      pinchFrom = now
    } else {
      state.x = e.clientX
      state.y = e.clientY
    }
  })
  for (const ev of ['pointerup', 'pointercancel']) element.addEventListener(ev, (e) => {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinchFrom = 0
  })
  return {
    get holding() { return pointers.size === 1 },
    aim() {
      ndc.set((state.x / innerWidth) * 2 - 1, -(state.y / innerHeight) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      return raycaster.ray.intersectPlane(plane, point) ? point : null
    },
  }
}

// The camera keeps one angle over the platform and follows the subject. zoomBy() moves it closer or further
// along that same angle, eased so the wheel and a pinch both feel smooth.
export function createDioramaCamera(camera, size, { followWide = 0.3, followNarrow = 1, narrowScale = 0.75, wideScale = 1, minZoom = 0.45, maxZoom = 2.6 } = {}) {
  const k = size / 10
  const offset = new THREE.Vector3(0, 6 * k, 8 * k)
  const look = new THREE.Vector3()
  const goal = new THREE.Vector3()
  let zoom = 1
  let zoomGoal = 1
  return {
    get zoom() { return zoomGoal },
    zoomBy(factor) { zoomGoal = THREE.MathUtils.clamp(zoomGoal * factor, minZoom, maxZoom) },
    update(subject, dt) {
      const narrow = camera.aspect < 1
      const follow = narrow ? followNarrow : followWide
      const scale = narrow ? narrowScale : wideScale
      const ease = dt > 0 ? 1 - Math.exp(-3 * dt) : 1
      zoom += (zoomGoal - zoom) * (dt > 0 ? 1 - Math.exp(-8 * dt) : 1)
      goal.set(subject.x * follow, 0, subject.z * follow)
      look.lerp(goal, ease)
      camera.position.copy(look).addScaledVector(offset, scale * zoom)
      camera.lookAt(look)
    },
  }
}
