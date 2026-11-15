// A miniature snowy town: clapboard houses with snow-capped gable roofs, chimneys, lit windows and doors,
// plus fir trees with snow on their branches. Every part is merged by material, so the whole town draws in a few calls.
import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { vertexColor, positionLocal, positionWorld, normalWorld, uv, fract, smoothstep, step, mix, color, float, mx_noise_float } from 'three/tsl'

function seeded(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

class Batch {
  constructor() { this.parts = new Map() }
  add(key, geometry, matrix, tint = '#ffffff') {
    const g = geometry.index ? geometry.clone() : geometry.clone()
    g.applyMatrix4(matrix)
    const c = new THREE.Color(tint)
    const colors = new Float32Array(g.attributes.position.count * 3)
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name)
    if (!this.parts.has(key)) this.parts.set(key, [])
    this.parts.get(key).push(g)
  }
  build(materials) {
    const group = new THREE.Group()
    for (const [key, list] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(list), materials[key])
      mesh.castShadow = key !== 'glass'
      mesh.receiveShadow = true
      group.add(mesh)
    }
    return group
  }
}

const m4 = (x, y, z, ry = 0, rx = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')), new THREE.Vector3(1, 1, 1))

function materials() {
  const siding = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 })
  const plank = fract(positionLocal.y.div(0.075))
  siding.colorNode = vertexColor().mul(mix(float(0.78), float(1), smoothstep(0.05, 0.16, plank)))
  const trim = new THREE.MeshStandardNodeMaterial({ color: '#f1ede4', roughness: 0.6 })
  const roof = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 })
  roof.colorNode = mix(color('#3b3433'), color('#4d4442'), step(0.5, fract(uv().y.mul(14))))
  const snow = new THREE.MeshStandardNodeMaterial({ roughness: 0.75 })
  snow.colorNode = mix(color('#dfe7f1'), color('#fbfdff'), smoothstep(0.2, 0.9, normalWorld.y))
  const glass = new THREE.MeshStandardNodeMaterial({ color: '#1a1d22', roughness: 0.2 })
  glass.emissiveNode = vertexColor().mul(1.6)
  const door = new THREE.MeshStandardNodeMaterial({ color: '#4a2f24', roughness: 0.7 })
  const brick = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 })
  brick.colorNode = mix(color('#7a3b2e'), color('#5e2c22'), step(0.85, fract(positionLocal.y.div(0.035))))
  const bark = new THREE.MeshStandardNodeMaterial({ color: '#4b3a2c', roughness: 0.95 })
  const needles = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 })
  const patch = mx_noise_float(positionWorld.mul(9)).mul(0.22)
  needles.colorNode = mix(mix(color('#1d3529'), color('#2d4f3b'), vertexColor().r), color('#f4f8fc'), smoothstep(0.62, 0.8, normalWorld.y.add(patch)))
  const metal = new THREE.MeshStandardNodeMaterial({ color: '#2a2d33', roughness: 0.5, metalness: 0.6 })
  return { siding, trim, roof, snow, glass, door, brick, bark, needles, metal }
}

function addHouse(batch, rand, { x, z, ry, w, d, floors, tint }) {
  const wallH = floors * 0.62
  const roofH = d * 0.42
  const o = 0.1
  const place = (lx, ly, lz, rx = 0, rot = 0) => {
    const local = new THREE.Vector3(lx, ly, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry)
    return m4(x + local.x, ly, z + local.z, ry + rot, rx)
  }
  batch.add('siding', new THREE.BoxGeometry(w, wallH, d), place(0, wallH / 2, 0), tint)
  const gable = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, roofH)]))
  batch.add('siding', gable, place(w / 2, wallH, 0, 0, Math.PI / 2), tint)
  batch.add('siding', gable, place(-w / 2, wallH, 0, 0, -Math.PI / 2), tint)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) batch.add('trim', new THREE.BoxGeometry(0.05, wallH, 0.05), place(sx * w / 2, wallH / 2, sz * d / 2))
  // Two roof slopes, each with a thicker snow cap on top.
  const run = d / 2 + o
  const slope = Math.hypot(run, roofH)
  const angle = Math.atan2(roofH, run)
  for (const side of [-1, 1]) {
    const cz = side * run / 2
    const cy = wallH + roofH / 2 - 0.02
    batch.add('roof', new THREE.BoxGeometry(w + 2 * o, 0.05, slope), place(0, cy, cz, side * angle))
    const nz = side * Math.sin(angle) * 0.05
    const ny = Math.cos(angle) * 0.05
    batch.add('snow', new THREE.BoxGeometry(w + 2 * o - 0.03, 0.06, slope - 0.04), place(0, cy + ny, cz + nz, side * angle))
  }
  batch.add('snow', new THREE.CylinderGeometry(0.045, 0.045, w + 2 * o - 0.03, 10).rotateZ(Math.PI / 2), place(0, wallH + roofH + 0.04, 0))
  // Chimney with a snow cap.
  const chimneyX = (rand() - 0.5) * w * 0.5
  batch.add('brick', new THREE.BoxGeometry(0.16, 0.5, 0.16), place(chimneyX, wallH + roofH * 0.75, -d * 0.18))
  batch.add('snow', new THREE.BoxGeometry(0.19, 0.04, 0.19), place(chimneyX, wallH + roofH * 0.75 + 0.27, -d * 0.18))
  // Windows on the front and back, door at the front.
  const across = Math.max(2, Math.floor(w / 0.42))
  for (let f = 0; f < floors; f++) {
    for (let i = 0; i < across; i++) {
      const wx = -w / 2 + (i + 0.5) * (w / across)
      if (f === 0 && i === Math.floor(across / 2)) continue
      for (const face of [1, -1]) {
        const lit = rand() < 0.7 ? '#ffc477' : '#000000'
        batch.add('trim', new THREE.BoxGeometry(0.2, 0.26, 0.02), place(wx, 0.3 + f * 0.62, face * (d / 2 + 0.005)))
        batch.add('glass', new THREE.BoxGeometry(0.15, 0.2, 0.024), place(wx, 0.3 + f * 0.62, face * (d / 2 + 0.007)), lit)
      }
    }
  }
  const doorX = -w / 2 + (Math.floor(across / 2) + 0.5) * (w / across)
  batch.add('door', new THREE.BoxGeometry(0.2, 0.36, 0.03), place(doorX, 0.18, d / 2 + 0.01))
  batch.add('glass', new THREE.SphereGeometry(0.03, 8, 6), place(doorX + 0.15, 0.42, d / 2 + 0.04), '#ffd28a')
  return { x, z, hx: (Math.abs(Math.cos(ry)) * w + Math.abs(Math.sin(ry)) * d) / 2 + 0.05, hz: (Math.abs(Math.sin(ry)) * w + Math.abs(Math.cos(ry)) * d) / 2 + 0.05 }
}

function firGeometry(rand) {
  const tiers = []
  const count = 5
  for (let t = 0; t < count; t++) {
    const r = 0.42 * (1 - t / (count + 0.6))
    const h = 0.42
    const cone = new THREE.ConeGeometry(r, h, 16, 2)
    const pos = cone.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      if (y > h / 2 - 1e-3) continue
      const jag = 1 + (rand() - 0.5) * 0.35
      pos.setX(i, pos.getX(i) * jag)
      pos.setZ(i, pos.getZ(i) * jag)
      if (y < -h / 2 + 1e-3) pos.setY(i, y - rand() * 0.06)
    }
    cone.computeVertexNormals()
    cone.translate(0, 0.32 + t * 0.24 + h / 2, 0)
    const shade = new Float32Array(pos.count * 3).fill(rand())
    cone.setAttribute('color', new THREE.BufferAttribute(shade, 3))
    tiers.push(cone)
  }
  return mergeGeometries(tiers)
}

export function buildTown({ size, seed = 7 }) {
  const rand = seeded(seed)
  const batch = new Batch()
  const solids = []
  const half = size / 2
  const tints = ['#b5473a', '#e3d5b8', '#7d98a8', '#d9d2c5', '#8a6f55', '#c2c9b0', '#a14f45']
  const houses = [
    { x: -5.6, z: -5.4, ry: 0, w: 2.0, d: 1.5, floors: 2 },
    { x: -2.5, z: -5.6, ry: 0, w: 1.6, d: 1.3, floors: 1 },
    { x: 0.6, z: -5.5, ry: 0, w: 2.2, d: 1.6, floors: 2 },
    { x: 3.7, z: -5.6, ry: 0, w: 1.7, d: 1.4, floors: 1 },
    { x: 6.1, z: -5.3, ry: 0, w: 1.6, d: 1.5, floors: 2 },
    { x: -6.0, z: -1.6, ry: Math.PI / 2, w: 1.8, d: 1.4, floors: 2 },
    { x: -6.1, z: 1.6, ry: Math.PI / 2, w: 1.6, d: 1.3, floors: 1 },
    { x: 6.0, z: -1.4, ry: -Math.PI / 2, w: 1.9, d: 1.5, floors: 1 },
    { x: 6.1, z: 1.9, ry: -Math.PI / 2, w: 1.6, d: 1.4, floors: 2 },
    { x: -1.6, z: -1.6, ry: 0.15, w: 1.5, d: 1.3, floors: 1 },
  ]
  houses.forEach((h, i) => solids.push(addHouse(batch, rand, { ...h, tint: tints[i % tints.length] })))

  // Street lamps.
  for (const [x, z] of [[-3.6, 0.6], [3.6, 0.6], [-3.6, -3.4], [3.6, -3.4], [0, 3.4]]) {
    batch.add('metal', new THREE.CylinderGeometry(0.025, 0.035, 0.85, 8), m4(x, 0.425, z))
    batch.add('glass', new THREE.SphereGeometry(0.07, 10, 8), m4(x, 0.9, z), '#ffd8a0')
    batch.add('snow', new THREE.CylinderGeometry(0.06, 0.08, 0.03, 10), m4(x, 0.98, z))
    solids.push({ x, z, hx: 0.06, hz: 0.06 })
  }
  const town = batch.build(materials())
  const mats = materials()

  // Firs, instanced: one crown geometry and one trunk, each tree scaled and turned differently.
  const spots = []
  const clusters = [[-6.3, 5.5, 5], [6.3, 5.4, 5], [-6.8, -7.1, 4], [6.9, -7.2, 4], [0, -7.4, 4], [-3.7, -3.0, 2], [3.4, -2.6, 2], [-4.2, 4.6, 2], [4.2, 4.4, 2]]
  for (const [cx, cz, n] of clusters) {
    for (let i = 0; i < n; i++) {
      const x = cx + (rand() - 0.5) * 1.8
      const z = cz + (rand() - 0.5) * 1.2
      if (Math.abs(x) > half - 0.5 || Math.abs(z) > half - 0.5) continue
      spots.push([x, z, 0.75 + rand() * 0.6, rand() * Math.PI * 2])
    }
  }
  const crowns = new THREE.InstancedMesh(firGeometry(rand), mats.needles, spots.length)
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.06, 0.5, 8).translate(0, 0.25, 0), mats.bark, spots.length)
  spots.forEach(([x, z, s, r], i) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r), new THREE.Vector3(s, s, s))
    crowns.setMatrixAt(i, m)
    trunks.setMatrixAt(i, m)
    solids.push({ x, z, hx: 0.12 * s, hz: 0.12 * s })
  })
  for (const t of [crowns, trunks]) { t.castShadow = true; t.receiveShadow = true; town.add(t) }
  return { group: town, solids }
}
