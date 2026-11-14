// Node materials, a shadowed floor and the node sky (tsl-fundamentals, tsl-procedural-effects).
import * as THREE from 'three/webgpu'
import { SkyMesh } from 'three/addons/objects/SkyMesh.js'
import { uv, color, time, mix, smoothstep, checker, dot, positionLocal, positionWorld, normalLocal, normalView, positionViewDirection } from 'three/tsl'

export async function setup({ renderer, scene, camera, setRow }) {
  renderer.toneMappingExposure = 0.55
  setRow('Try', 'Drag to orbit. The knot should ripple, glow at its rim and cast a soft shadow.')
  camera.position.set(5, 3, 7)

  const sky = new SkyMesh()
  sky.scale.setScalar(450)
  sky.turbidity.value = 3
  sky.rayleigh.value = 1.4
  const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(62), THREE.MathUtils.degToRad(215))
  sky.sunPosition.value.copy(sun)
  scene.add(sky)

  scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x3b3129, 0.7))
  const key = new THREE.DirectionalLight(0xffffff, 2.4)
  key.position.copy(sun).multiplyScalar(12)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.radius = 5
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 })
  scene.add(key)

  const floorMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 })
  floorMaterial.colorNode = mix(color('#d8d2c4'), color('#b7af9e'), checker(uv().mul(14)))
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), floorMaterial)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.1 })
  const bands = smoothstep(0.35, 0.65, uv().x.mul(20).add(time.mul(0.4)).fract())
  material.colorNode = mix(color('#2348c8'), color('#ff7a3d'), bands)
  const rim = dot(positionViewDirection, normalView).abs().oneMinus().pow(3)
  material.emissiveNode = color('#7fd8ff').mul(rim)
  const ripple = time.mul(2).add(positionWorld.y.mul(4)).sin().mul(0.05)
  material.positionNode = positionLocal.add(normalLocal.mul(ripple))

  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.9, 0.32, 240, 40), material)
  knot.position.y = 1.6
  knot.castShadow = true
  scene.add(knot)

  return { update(dt) { knot.rotation.y += dt * 0.3 } }
}
