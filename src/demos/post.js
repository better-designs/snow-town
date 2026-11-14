// RenderPipeline with MRT, bloom, normal-based outlines and FXAA (tsl-post-processing).
import * as THREE from 'three/webgpu'
import { pass, mrt, output, normalWorld, renderOutput, color, time, float, vec4, mix, positionWorld } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { sobel } from 'three/addons/tsl/display/SobelOperatorNode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'

export async function setup({ renderer, scene, camera, setRow }) {
  setRow('Try', 'Glowing rings should bloom, and every shape should carry a thin dark outline.')
  camera.position.set(0, 3.5, camera.aspect < 1 ? 9 / camera.aspect : 9)
  scene.background = new THREE.Color('#2b303b')
  scene.add(new THREE.HemisphereLight(0x8fa8ff, 0x201a14, 1.2))
  const key = new THREE.DirectionalLight(0xffffff, 1.5)
  key.position.set(3, 6, 4)
  scene.add(key)

  const shapes = []
  const geometries = [new THREE.TorusGeometry(0.6, 0.12, 24, 96), new THREE.IcosahedronGeometry(0.55, 0), new THREE.BoxGeometry(0.8, 0.8, 0.8)]
  for (let i = 0; i < 9; i++) {
    const material = new THREE.MeshStandardNodeMaterial({ color: '#cfd6e6', roughness: 0.5 })
    if (i % 3 === 0) {
      const pulse = time.mul(1.6).add(i).sin().mul(0.5).add(0.5)
      material.emissiveNode = mix(color('#ff5b2e'), color('#ffd36b'), pulse).mul(pulse.mul(3).add(0.5))
    }
    const mesh = new THREE.Mesh(geometries[i % 3], material)
    mesh.position.set(((i % 3) - 1) * 2.4, 1.2 + Math.floor(i / 3) * 1.4 - 1, 0)
    scene.add(mesh)
    shapes.push(mesh)
  }

  const pipeline = new THREE.RenderPipeline(renderer)
  pipeline.outputColorTransform = false

  const scenePass = pass(scene, camera)
  scenePass.setMRT(mrt({ output, normal: normalWorld }))
  const sceneColor = scenePass.getTextureNode('output')
  const edges = sobel(scenePass.getTextureNode('normal')).r.remapClamp(0.2, 0.8, 0, 1)

  const glow = bloom(sceneColor, 1.1, 0.4, 0.6)
  const lit = sceneColor.add(glow)
  const inked = vec4(mix(lit.rgb, color('#05060a'), edges.mul(0.85)), float(1))
  pipeline.outputNode = fxaa(renderOutput(inked))

  return {
    update(dt) { shapes.forEach((m, i) => { m.rotation.x += dt * (0.2 + i * 0.03); m.rotation.y += dt * 0.4 }) },
    render() { pipeline.render() },
  }
}
