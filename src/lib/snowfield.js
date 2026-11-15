// Deformable snow that works on WebGPU and on Safari's WebGL 2 path.
// Height lives in render targets: a base layer of gentle drifts, written once, and a working pair A and B.
// Each frame one pass presses shapes into B while reading A, then a second pass copies B back into A.
// Pressing digs a groove and pushes a low ridge up beside it; over time the snow relaxes back to its drifts.
// A dense plane reads A to rise and sink, and every pixel rebuilds its normal from the finer height texture.
// Fine detail (grain, wind ripples, sparkle) is added at shading time only: the blur pass would erase it from the height.
import * as THREE from 'three/webgpu'
import {
  Fn, Loop, uniform, uniformArray, vec2, vec3, vec4, float, min, max, mix, smoothstep, select, sqrt, step, floor, fract,
  hash, uv, texture, color, positionLocal, positionWorld, cameraPosition, transformNormalToView, mx_noise_float,
} from 'three/tsl'

// A tileable detail map, built once. Red and green hold the slope of snow grain and wind ripples, blue their height,
// alpha a blotchy noise that makes track edges crumble. Eight bits with mipmaps: every device can filter it,
// and the mipmaps flatten the grain with distance.
function createSnowDetail(n = 256) {
  let seed = 12345
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  // Value noise on a lattice that wraps, so the map tiles.
  const lattice = (cells) => {
    const grid = Float32Array.from({ length: cells * cells }, rand)
    const at = (x, y) => grid[((y % cells + cells) % cells) * cells + ((x % cells + cells) % cells)]
    return (u, v) => {
      const x = u * cells
      const y = v * cells
      const x0 = Math.floor(x)
      const y0 = Math.floor(y)
      const fx = x - x0
      const fy = y - y0
      const sx = fx * fx * (3 - 2 * fx)
      const sy = fy * fy * (3 - 2 * fy)
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy
    }
  }
  const warp = lattice(6)
  const lump = lattice(12)
  const grainA = lattice(48)
  const grainB = lattice(96)
  const crumbA = lattice(24)
  const crumbB = lattice(56)
  const height = new Float32Array(n * n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n
      const v = y / n
      // Ripples run across the wind: a whole number of waves per tile, bent by slow noise.
      const ripple = Math.sin(Math.PI * 2 * (5 * u + 2 * v + warp(u, v) * 1.4))
      height[y * n + x] = ripple * 0.5 * (0.4 + lump(u, v)) + grainA(u, v) * 0.5 + grainB(u, v) * 0.35
    }
  }
  const data = new Uint8Array(n * n * 4)
  const wrap = (i) => (i + n) % n
  const byte = (x) => Math.max(0, Math.min(255, Math.round(x * 255)))
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4
      data[i] = byte(0.5 + (height[y * n + wrap(x - 1)] - height[y * n + wrap(x + 1)]) * 2.2)
      data[i + 1] = byte(0.5 + (height[wrap(y - 1) * n + x] - height[wrap(y + 1) * n + x]) * 2.2)
      data[i + 2] = byte(0.5 + height[y * n + x] * 0.4)
      data[i + 3] = byte((crumbA(x / n, y / n) * 0.6 + crumbB(x / n, y / n) * 0.4 - 0.5) * 2.2 + 0.5)
    }
  }
  const map = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType)
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.magFilter = THREE.LinearFilter
  map.minFilter = THREE.LinearMipmapLinearFilter
  map.generateMipmaps = true
  map.anisotropy = 4
  map.needsUpdate = true
  return map
}

export function createSnowfield({ renderer, size, res, meshRes, depth, spheres = 0, segments = 0, boxes = 0, tyre = 0.05, refillRate = 0.03, blurRate = 0.4, sunDirection = new THREE.Vector3(0, 1, 0) }) {
  const options = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
  const base = new THREE.RenderTarget(res, res, options)
  const a = new THREE.RenderTarget(res, res, options)
  const b = new THREE.RenderTarget(res, res, options)
  const full = uniform(depth)
  const relax = uniform(0)
  const blur = uniform(0)
  const tyreHalf = uniform(tyre)
  const sun = uniform(sunDirection.clone().normalize())
  const detail = createSnowDetail()
  const sphereData = uniformArray(Array.from({ length: Math.max(1, spheres) }, () => new THREE.Vector4(1e4, 1e4, 10, 0)), 'vec4')
  const segmentData = uniformArray(Array.from({ length: Math.max(1, segments) }, () => new THREE.Vector4(1e4, 1e4, 1e4, 1e4)), 'vec4')
  // A box is a footprint that caps the snow at a height: centre x and z, then sin and cos of its heading;
  // the second vector holds half width, half length and the cap height.
  const boxPlace = uniformArray(Array.from({ length: Math.max(1, boxes) }, () => new THREE.Vector4(1e4, 1e4, 0, 1)), 'vec4')
  const boxShape = uniformArray(Array.from({ length: Math.max(1, boxes) }, () => new THREE.Vector4(0, 0, 10, 0)), 'vec4')

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
    // Snow breaks in lumps: one noise read per texel shifts where the groove ends and how high the ridge piles up.
    const crumb = texture(detail, world.mul(0.55)).a
    const jitter = crumb.sub(0.5).mul(tyreHalf.mul(0.8))
    const ridge = full.mul(crumb.mul(0.6).add(0.2))
    if (spheres > 0) {
      // A ball sinks to its own underside and shoves a ring of snow up just outside where it touches.
      Loop(spheres, ({ i }) => {
        const s = sphereData.element(i)
        const d = world.distance(s.xy).add(jitter)
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
        const d = ap.sub(ab.mul(k)).length().add(jitter)
        const moving = step(1e-4, len)
        const ring = smoothstep(tyreHalf.mul(0.9), tyreHalf.mul(1.3), d).mul(float(1).sub(smoothstep(tyreHalf.mul(1.3), tyreHalf.mul(2.4), d))).mul(moving)
        h.assign(max(h, rest.add(ridge.mul(ring)).min(h.add(ridge.mul(ring))).mul(untouched(h, rest))))
        const along = world.dot(ab.div(max(len, 1e-5)))
        const tread = step(0.5, fract(along.div(tyreHalf.mul(0.9)))).mul(full.mul(0.22)).mul(moving)
        const inside = float(1).sub(smoothstep(tyreHalf.mul(0.3), tyreHalf.mul(0.8), d))
        h.assign(min(h, smoothstep(tyreHalf.mul(0.55), tyreHalf, d).mul(rest).add(tread.mul(inside))))
      })
    }
    if (boxes > 0) {
      // A car body scrapes the snow under it down to its underside, so snow never shows inside the car.
      Loop(boxes, ({ i }) => {
        const place = boxPlace.element(i)
        const shape = boxShape.element(i)
        const rel = world.sub(place.xy)
        const along = rel.x.mul(place.z).add(rel.y.mul(place.w)).abs()
        const across = rel.x.mul(place.w).sub(rel.y.mul(place.z)).abs()
        const cover = float(1).sub(smoothstep(shape.y.sub(0.03), shape.y, along)).mul(float(1).sub(smoothstep(shape.x.sub(0.03), shape.x, across)))
        h.assign(min(h, shape.z.add(float(1).sub(cover).mul(10))))
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
  const slope = vec2(sample(-e, 0).sub(sample(e, 0)), sample(0, -e).sub(sample(0, e))).div(step2)
  const pressed = float(1).sub(h.div(max(rest, 1e-4))).clamp(0, 1)
  const fresh = float(1).sub(pressed)
  const raised = h.sub(rest).div(full.mul(0.4)).clamp(0, 1)
  // Grain and wind ripples: the detail map at two scales, on fresh snow only, so a packed track reads smoother.
  const fine = texture(detail, positionWorld.xz.mul(1.9)).rg.sub(0.5)
  const wide = texture(detail, vec2(positionWorld.x.mul(0.31).add(positionWorld.z.mul(0.12)), positionWorld.z.mul(0.31).sub(positionWorld.x.mul(0.12)))).rg.sub(0.5)
  const grain = fine.mul(0.3).add(wide.mul(0.38)).mul(fresh)
  // Slopes are exaggerated a little so shallow tracks still read from the camera height.
  const n = vec3(slope.x.mul(1.6).add(grain.x), float(1), slope.y.mul(1.6).add(grain.y)).normalize()
  material.normalNode = transformNormalToView(vec3(n.x, n.z.negate(), n.y))
  // Depth inside a track: a wider ring of heights tells how far this point sits below its surroundings.
  const r = 3 * e
  const ring = sample(r, r).add(sample(-r, r)).add(sample(r, -r)).add(sample(-r, -r)).mul(0.25)
  const crease = ring.sub(h).div(full.mul(0.55)).clamp(0, 1)
  const wall = smoothstep(0.35, 1.5, slope.length())
  // Fresh snow is bright and matte. A packed floor is a little greyer and smoother, its crease darker,
  // and the groove walls turn blue, as light that scattered through the snow.
  const snow = mix(mix(color('#f3f7fc'), color('#ffffff'), raised), color('#cdd5df'), pressed.pow(0.7))
  material.colorNode = snow.mul(mix(vec3(1), vec3(0.7, 0.83, 1), wall.mul(0.65))).mul(float(1).sub(crease.mul(0.4)))
  material.roughnessNode = mix(float(0.92), float(0.6), pressed)
  // Sparkle: each small cell holds one ice crystal with its own facing. It flashes only where it mirrors the sun
  // into the eye, so glints change as the camera moves and hold still when it stops.
  const cell = positionWorld.xz.mul(150)
  const id = floor(cell).add(1300)
  const key = id.x.add(id.y.mul(2601))
  const facet = vec3(hash(key).mul(2).sub(1), 0.9, hash(key.add(7e6)).mul(2).sub(1)).normalize()
  const half = sun.add(cameraPosition.sub(positionWorld).normalize()).normalize()
  const aligned = facet.dot(half)
  const dot = float(1).sub(smoothstep(0.12, 0.34, fract(cell).sub(0.5).length()))
  // Only untouched snow sparkles: pressing breaks the crystals.
  const sparkle = smoothstep(0.994, 0.999, aligned).add(smoothstep(0.97, 0.999, aligned).mul(0.05)).mul(dot).mul(smoothstep(0.75, 1, fresh))
  // The glint joins the sun's own light, so the sun's shadow switches it off.
  material.setupLightingModel = function (builder) {
    const model = THREE.MeshStandardNodeMaterial.prototype.setupLightingModel.call(this, builder)
    const direct = model.direct.bind(model)
    model.direct = (input, b) => {
      direct(input, b)
      input.reflectedLight.directSpecular.addAssign(mix(input.lightColor, vec3(input.lightColor.g), 0.6).mul(sparkle).mul(2.2))
    }
    return model
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, meshRes ?? res, meshRes ?? res), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true

  return {
    mesh,
    spheres: sphereData.array,
    segments: segmentData.array,
    boxes: boxPlace.array.map((place, i) => ({ place, shape: boxShape.array[i] })),
    park() {
      for (const s of sphereData.array) s.set(1e4, 1e4, 10, 0)
      for (const g of segmentData.array) g.set(1e4, 1e4, 1e4, 1e4)
      for (const p of boxPlace.array) p.set(1e4, 1e4, 0, 1)
    },
    reset,
    sunDirection: sun.value,
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
