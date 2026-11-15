// Deformable snow that works on WebGPU and on Safari's WebGL 2 path.
// Height lives in two render targets: each frame one pass presses shapes into B while reading A
// (with a little blur and refill), and a second pass copies B back into A.
// A dense plane reads A in its vertex stage to rise and sink, and rebuilds its normals from neighbouring heights.
import * as THREE from 'three/webgpu'
import {
  Fn, Loop, uniform, uniformArray, varying, vec2, vec3, vec4, float, min, max, mix, smoothstep, select, sqrt, step, floor,
  hash, uv, texture, color, positionLocal, normalLocal, positionWorld, cross,
} from 'three/tsl'

export function createSnowfield({ renderer, size, res, depth, spheres = 0, segments = 0, tyre = 0.04, refillRate = 0.01, blurRate = 1.5 }) {
  const options = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
  const a = new THREE.RenderTarget(res, res, options)
  const b = new THREE.RenderTarget(res, res, options)
  const full = uniform(depth)
  const refill = uniform(0)
  const blur = uniform(0)
  const tyreHalf = uniform(tyre)
  // Unused stamps sit far off the field.
  const sphereData = uniformArray(Array.from({ length: Math.max(1, spheres) }, () => new THREE.Vector4(1e4, 1e4, 10, 0)), 'vec4')
  const segmentData = uniformArray(Array.from({ length: Math.max(1, segments) }, () => new THREE.Vector4(1e4, 1e4, 1e4, 1e4)), 'vec4')

  const fillMaterial = new THREE.NodeMaterial()
  fillMaterial.fragmentNode = vec4(full, full, full, 1)
  const pressMaterial = new THREE.NodeMaterial()
  pressMaterial.fragmentNode = Fn(() => {
    const st = uv()
    const e = float(1 / res)
    const read = (o) => texture(a.texture, st.add(o)).r
    const here = read(vec2(0, 0))
    const around = here.add(read(vec2(e, 0))).add(read(vec2(e.negate(), 0))).add(read(vec2(0, e))).add(read(vec2(0, e.negate()))).div(5)
    const h = mix(here, around, blur).add(refill).min(full).toVar()
    const world = st.sub(0.5).mul(size)
    if (spheres > 0) {
      // A ball pushes the snow down to the underside of its own surface.
      Loop(spheres, ({ i }) => {
        const s = sphereData.element(i)
        const d = world.distance(s.xy)
        const bottom = s.z.sub(sqrt(max(s.w.mul(s.w).sub(d.mul(d)), 0)))
        h.assign(min(h, select(d.lessThan(s.w), max(bottom, 0), float(1e3))))
      })
    }
    if (segments > 0) {
      // A tyre or a fingertip presses a soft-edged groove along its path since the last frame.
      Loop(segments, ({ i }) => {
        const g = segmentData.element(i)
        const ab = g.zw.sub(g.xy)
        const ap = world.sub(g.xy)
        const k = ap.dot(ab).div(max(ab.dot(ab), 1e-6)).clamp(0, 1)
        const d = ap.sub(ab.mul(k)).length()
        h.assign(min(h, smoothstep(tyreHalf.mul(0.45), tyreHalf, d).mul(full)))
      })
    }
    return vec4(h, h, h, 1)
  })()
  const copyMaterial = new THREE.NodeMaterial()
  copyMaterial.fragmentNode = texture(b.texture, uv())
  const fillQuad = new THREE.QuadMesh(fillMaterial)
  const pressQuad = new THREE.QuadMesh(pressMaterial)
  const copyQuad = new THREE.QuadMesh(copyMaterial)

  function reset() {
    for (const target of [a, b]) {
      renderer.setRenderTarget(target)
      fillQuad.render(renderer)
    }
    renderer.setRenderTarget(null)
  }
  reset()

  // The snow surface. Texture rows follow world z, and the plane is rotated, so local y is minus world z.
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.78 })
  const heightAt = Fn(([xy]) => texture(a.texture, vec2(xy.x, xy.y.negate()).div(size).add(0.5)).r)
  material.positionNode = Fn(() => {
    const p = positionLocal.toVar()
    p.z.addAssign(heightAt(p.xy))
    const d = size / res
    const pa = positionLocal.add(vec3(d, 0, 0)).toVar()
    const pb = positionLocal.add(vec3(0, d, 0)).toVar()
    pa.z.addAssign(heightAt(pa.xy))
    pb.z.addAssign(heightAt(pb.xy))
    normalLocal.assign(cross(pa.sub(p).normalize(), pb.sub(p).normalize()))
    return p
  })()
  // Packed snow in a groove reads slightly blue-grey; untouched snow is near white with sparse glints.
  // Read the height again per pixel: a varying written inside positionNode came through as 0 once shadows were on.
  const surfaceHeight = texture(a.texture, positionWorld.xz.div(size).add(0.5)).r
  material.colorNode = mix(color('#c3cfdd'), color('#f7fafd'), smoothstep(0, full, surfaceHeight))
  material.emissiveNode = vec3(0.9, 0.95, 1).mul(step(0.997, hash(floor(positionWorld.xz.mul(140))))).mul(0.5)
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, res, res), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true

  return {
    mesh,
    spheres: sphereData.array,
    segments: segmentData.array,
    reset,
    update(dt) {
      refill.value = dt * refillRate
      blur.value = Math.min(1, dt * blurRate)
      renderer.setRenderTarget(b)
      pressQuad.render(renderer)
      renderer.setRenderTarget(a)
      copyQuad.render(renderer)
      renderer.setRenderTarget(null)
    },
  }
}

// A diorama base under the snow: a wooden frame over layered earth, and a snow rim so the field edge never shows a gap.
export function createPlatform(size, depth) {
  const group = new THREE.Group()
  const earth = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 })
  earth.colorNode = mix(color('#4a3a2e'), color('#6b5644'), smoothstep(-1.2, 0, positionWorld.y.add(hash(floor(positionWorld.xz.mul(30))).mul(0.06))))
  const base = new THREE.Mesh(new THREE.BoxGeometry(size + 0.5, 1.2, size + 0.5), earth)
  base.position.y = -0.6
  base.receiveShadow = true
  group.add(base)
  const wood = new THREE.MeshStandardNodeMaterial({ color: '#5a4030', roughness: 0.7 })
  const snow = new THREE.MeshStandardNodeMaterial({ color: '#f4f8fc', roughness: 0.8 })
  const rim = 0.25
  for (const [w, d, x, z] of [[size + 0.5, rim, 0, (size + 0.5 - rim) / 2], [size + 0.5, rim, 0, -(size + 0.5 - rim) / 2], [rim, size + 0.5, (size + 0.5 - rim) / 2, 0], [rim, size + 0.5, -(size + 0.5 - rim) / 2, 0]]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), wood)
    frame.position.set(x, depth + 0.06, z)
    frame.castShadow = frame.receiveShadow = true
    const bank = new THREE.Mesh(new THREE.BoxGeometry(w, depth, d), snow)
    bank.position.set(x, depth / 2, z)
    group.add(frame, bank)
  }
  return group
}
