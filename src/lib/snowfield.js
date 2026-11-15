// Deformable snow that works on WebGPU and on Safari's WebGL 2 path.
// Height lives in render targets: a base layer of gentle drifts, written once, and a working pair A and B.
// Each frame one pass presses shapes into B while reading A, then a second pass copies B back into A.
// Pressing digs a groove and pushes a low ridge up beside it; over time the snow relaxes back to its drifts.
// A dense plane reads A to rise and sink, and every pixel rebuilds its normal from the finer height texture.
import * as THREE from 'three/webgpu'
import {
  Fn, Loop, uniform, uniformArray, vec2, vec3, vec4, float, min, max, mix, smoothstep, select, sqrt, step, floor, fract, abs,
  hash, uv, texture, color, positionLocal, positionWorld, transformNormalToView, mx_noise_float,
} from 'three/tsl'

export function createSnowfield({ renderer, size, res, meshRes, depth, spheres = 0, segments = 0, tyre = 0.05, refillRate = 0.03, blurRate = 0.4 }) {
  const options = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
  const base = new THREE.RenderTarget(res, res, options)
  const a = new THREE.RenderTarget(res, res, options)
  const b = new THREE.RenderTarget(res, res, options)
  const full = uniform(depth)
  const relax = uniform(0)
  const blur = uniform(0)
  const tyreHalf = uniform(tyre)
  const sphereData = uniformArray(Array.from({ length: Math.max(1, spheres) }, () => new THREE.Vector4(1e4, 1e4, 10, 0)), 'vec4')
  const segmentData = uniformArray(Array.from({ length: Math.max(1, segments) }, () => new THREE.Vector4(1e4, 1e4, 1e4, 1e4)), 'vec4')

  // Fresh snow is never flat: two octaves of noise give soft drifts of about a tenth of the depth.
  const driftMaterial = new THREE.NodeMaterial()
  driftMaterial.fragmentNode = Fn(() => {
    const world = uv().sub(0.5).mul(size)
    const n = mx_noise_float(vec3(world.mul(0.7), 0)).mul(0.7).add(mx_noise_float(vec3(world.mul(2.6), 3)).mul(0.3))
    const h = full.mul(n.mul(0.12).add(1))
    return vec4(h, h, h, 1)
  })()

  // Ridges only rise on snow that has not been pressed, or a ball would refill the groove it just left behind it.
  const untouched = (h, rest) => step(rest.mul(0.85), h)
  const pressMaterial = new THREE.NodeMaterial()
  pressMaterial.fragmentNode = Fn(() => {
    const st = uv()
    const e = float(1 / res)
    const read = (o) => texture(a.texture, st.add(o)).r
    const here = read(vec2(0, 0))
    const around = here.add(read(vec2(e, 0))).add(read(vec2(e.negate(), 0))).add(read(vec2(0, e))).add(read(vec2(0, e.negate()))).div(5)
    const rest = texture(base.texture, st).r
    const h = mix(mix(here, around, blur), rest, relax).toVar()
    const world = st.sub(0.5).mul(size)
    const ridge = full.mul(0.45)
    if (spheres > 0) {
      // A ball sinks to its own underside and shoves a ring of snow up just outside where it touches.
      Loop(spheres, ({ i }) => {
        const s = sphereData.element(i)
        const d = world.distance(s.xy)
        const contact = sqrt(max(s.w.mul(s.w).sub(s.z.sub(rest).pow(2)), 1e-6))
        const ring = smoothstep(contact.mul(0.85), contact.mul(1.1), d).mul(float(1).sub(smoothstep(contact.mul(1.1), contact.mul(1.7), d)))
        h.assign(max(h, rest.add(ridge.mul(ring)).min(h.add(ridge.mul(ring))).mul(untouched(h, rest))))
        const bottom = s.z.sub(sqrt(max(s.w.mul(s.w).sub(d.mul(d)), 0)))
        h.assign(min(h, select(d.lessThan(s.w), max(bottom, 0), float(1e3))))
      })
    }
    if (segments > 0) {
      // A tyre presses a flat-bottomed groove with tread bars across it, and pushes a ridge up on each side.
      Loop(segments, ({ i }) => {
        const g = segmentData.element(i)
        const ab = g.zw.sub(g.xy)
        const len = ab.length()
        const ap = world.sub(g.xy)
        const k = ap.dot(ab).div(max(len.mul(len), 1e-6)).clamp(0, 1)
        const d = ap.sub(ab.mul(k)).length()
        const moving = step(1e-4, len)
        const ring = smoothstep(tyreHalf.mul(0.9), tyreHalf.mul(1.3), d).mul(float(1).sub(smoothstep(tyreHalf.mul(1.3), tyreHalf.mul(2.4), d))).mul(moving)
        h.assign(max(h, rest.add(ridge.mul(ring)).min(h.add(ridge.mul(ring))).mul(untouched(h, rest))))
        const along = world.dot(ab.div(max(len, 1e-5)))
        const tread = step(0.5, fract(along.div(tyreHalf.mul(0.9)))).mul(full.mul(0.22)).mul(moving)
        const inside = float(1).sub(smoothstep(tyreHalf.mul(0.3), tyreHalf.mul(0.8), d))
        h.assign(min(h, smoothstep(tyreHalf.mul(0.55), tyreHalf, d).mul(rest).add(tread.mul(inside))))
      })
    }
    return vec4(h, h, h, 1)
  })()
  const copyMaterial = new THREE.NodeMaterial()
  copyMaterial.fragmentNode = texture(b.texture, uv())
  const driftQuad = new THREE.QuadMesh(driftMaterial)
  const pressQuad = new THREE.QuadMesh(pressMaterial)
  const copyQuad = new THREE.QuadMesh(copyMaterial)

  function reset() {
    for (const target of [base, a, b]) {
      renderer.setRenderTarget(target)
      driftQuad.render(renderer)
    }
    renderer.setRenderTarget(null)
  }
  reset()

  // The snow surface. Texture rows follow world z; the plane is rotated, so local y is minus world z.
  const material = new THREE.MeshStandardNodeMaterial()
  const heightAt = Fn(([xy]) => texture(a.texture, vec2(xy.x, xy.y.negate()).div(size).add(0.5)).r)
  material.positionNode = Fn(() => {
    const p = positionLocal.toVar()
    p.z.addAssign(heightAt(p.xy))
    return p
  })()
  // Shade from the finer height texture per pixel, not from the coarser mesh, so groove edges stay crisp.
  const st = positionWorld.xz.div(size).add(0.5)
  const e = 1 / res
  const sample = (x, z) => texture(a.texture, st.add(vec2(x, z))).r
  const h = sample(0, 0)
  const rest = texture(base.texture, st).r
  const step2 = (2 * size) / res
  // Slopes are exaggerated a little so shallow tracks still read from the camera height.
  const n = vec3(sample(-e, 0).sub(sample(e, 0)).div(step2).mul(1.6), float(1), sample(0, -e).sub(sample(0, e)).div(step2).mul(1.6)).normalize()
  material.normalNode = transformNormalToView(vec3(n.x, n.z.negate(), n.y))
  const pressed = float(1).sub(h.div(max(rest, 1e-4))).clamp(0, 1)
  const raised = h.sub(rest).div(full.mul(0.4)).clamp(0, 1)
  // Fresh snow is bright and matte; packed snow in a track is a little darker, bluer and smoother.
  material.colorNode = mix(mix(color('#f4f8fc'), color('#ffffff'), raised), color('#aebdd0'), pressed.pow(0.7)).mul(mix(float(1), float(0.88), pressed))
  material.roughnessNode = mix(float(0.88), float(0.42), pressed)
  const glint = step(0.996, hash(floor(positionWorld.xz.mul(220)))).mul(float(1).sub(pressed))
  material.emissiveNode = vec3(0.9, 0.95, 1).mul(glint).mul(0.45)
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, meshRes ?? res, meshRes ?? res), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true

  return {
    mesh,
    spheres: sphereData.array,
    segments: segmentData.array,
    park() {
      for (const s of sphereData.array) s.set(1e4, 1e4, 10, 0)
      for (const g of segmentData.array) g.set(1e4, 1e4, 1e4, 1e4)
    },
    reset,
    update(dt) {
      relax.value = Math.min(1, dt * refillRate)
      blur.value = Math.min(1, dt * blurRate)
      renderer.setRenderTarget(b)
      pressQuad.render(renderer)
      renderer.setRenderTarget(a)
      copyQuad.render(renderer)
      renderer.setRenderTarget(null)
    },
  }
}

// A diorama base under the snow: a wooden frame over layered earth, and a snow bank so the field edge never shows a gap.
export function createPlatform(size, depth) {
  const group = new THREE.Group()
  const earth = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 })
  earth.colorNode = mix(color('#4a3a2e'), color('#6b5644'), smoothstep(-1.2, 0, positionWorld.y.add(hash(floor(positionWorld.xz.mul(30))).mul(0.06))))
  const ground = new THREE.Mesh(new THREE.BoxGeometry(size + 0.5, 1.2, size + 0.5), earth)
  ground.position.y = -0.6
  ground.receiveShadow = true
  group.add(ground)
  const wood = new THREE.MeshStandardNodeMaterial({ color: '#5a4030', roughness: 0.7 })
  const snow = new THREE.MeshStandardNodeMaterial({ color: '#f4f8fc', roughness: 0.85 })
  const rim = 0.25
  const top = depth * 1.15
  for (const [w, d, x, z] of [[size + 0.5, rim, 0, (size + 0.5 - rim) / 2], [size + 0.5, rim, 0, -(size + 0.5 - rim) / 2], [rim, size + 0.5, (size + 0.5 - rim) / 2, 0], [rim, size + 0.5, -(size + 0.5 - rim) / 2, 0]]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), wood)
    frame.position.set(x, top + 0.06, z)
    frame.receiveShadow = true
    const bank = new THREE.Mesh(new THREE.BoxGeometry(w, top, d), snow)
    bank.position.set(x, top / 2, z)
    group.add(frame, bank)
  }
  return group
}
