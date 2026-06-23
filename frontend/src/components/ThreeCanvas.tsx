import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export default function ThreeCanvas() {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!mountRef.current) return

    // ─── Scene setup ───
    const W = window.innerWidth
    const H = window.innerHeight
    const scene    = new THREE.Scene()
    const camera   = new THREE.PerspectiveCamera(50, W / H, 0.1, 1000)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)  // transparent bg
    mountRef.current.appendChild(renderer.domElement)
    camera.position.z = 5

    // ─── Particles system ───
    const PARTICLE_COUNT = 240
    const positions = new Float32Array(PARTICLE_COUNT * 3)
    const colors    = new Float32Array(PARTICLE_COUNT * 3)
    const sizes     = new Float32Array(PARTICLE_COUNT)

    const palette = [
      new THREE.Color('#4F46E5'),   // indigo
      new THREE.Color('#6366F1'),   // indigo-2
      new THREE.Color('#06B6D4'),   // cyan
      new THREE.Color('#8B5CF6'),   // purple
      new THREE.Color('#818CF8'),   // indigo-3
      new THREE.Color('#C7D2FE'),   // indigo-4
    ]

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const r = 2.5 + Math.random() * 4
      const theta = Math.random() * Math.PI * 2
      const phi   = Math.acos(2 * Math.random() - 1)
      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      positions[i * 3 + 2] = r * Math.cos(phi)
      const c = palette[Math.floor(Math.random() * palette.length)]
      colors[i * 3]     = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
      sizes[i] = 4 + Math.random() * 8
    }

    const particleGeo = new THREE.BufferGeometry()
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    particleGeo.setAttribute('color',    new THREE.BufferAttribute(colors, 3))
    particleGeo.setAttribute('size',     new THREE.BufferAttribute(sizes, 1))

    const particleMat = new THREE.PointsMaterial({
      vertexColors: true,
      sizeAttenuation: true,
      size: 0.06,
      transparent: true,
      opacity: 0.45,
    })

    const particles = new THREE.Points(particleGeo, particleMat)
    scene.add(particles)

    // ─── Floating 3D geometries ───
    const meshes: THREE.Mesh[] = []
    const matProps = { transparent: true, opacity: 0.12, wireframe: false }

    const geoConfigs = [
      { geo: new THREE.IcosahedronGeometry(0.7, 0), color: 0x4F46E5, pos: [-1.6, 1.0, -1.5], rotSpeed: [0.003, 0.005, 0.002] },
      { geo: new THREE.OctahedronGeometry(0.55),    color: 0x06B6D4, pos: [ 2.0, -0.8, -2.0], rotSpeed: [0.004, 0.002, 0.006] },
      { geo: new THREE.TetrahedronGeometry(0.6),    color: 0x8B5CF6, pos: [-2.2, -1.2, -1.0], rotSpeed: [0.006, 0.003, 0.004] },
      { geo: new THREE.IcosahedronGeometry(0.4, 0), color: 0x818CF8, pos: [ 1.4, 1.6, -2.5],  rotSpeed: [0.005, 0.004, 0.003] },
      { geo: new THREE.OctahedronGeometry(0.35),    color: 0x06B6D4, pos: [-0.5, -1.8, -1.0], rotSpeed: [0.007, 0.005, 0.002] },
    ]

    geoConfigs.forEach(cfg => {
      // Solid fill
      const fillMat = new THREE.MeshPhongMaterial({
        color: cfg.color, transparent: true, opacity: 0.07,
        shininess: 80,
      })
      const fillMesh = new THREE.Mesh(cfg.geo, fillMat)
      fillMesh.position.set(...cfg.pos as [number, number, number])
      scene.add(fillMesh)

      // Wireframe overlay
      const wireMat = new THREE.MeshBasicMaterial({
        color: cfg.color, wireframe: true, transparent: true, opacity: 0.25,
      })
      const wireMesh = new THREE.Mesh(cfg.geo, wireMat)
      wireMesh.position.set(...cfg.pos as [number, number, number])
      scene.add(wireMesh)

      // Store both with shared rotSpeed
      ;(fillMesh as any)._rotSpeed  = cfg.rotSpeed
      ;(wireMesh as any)._rotSpeed  = cfg.rotSpeed
      ;(fillMesh as any)._floatBase = fillMesh.position.y
      ;(wireMesh as any)._floatBase = wireMesh.position.y
      meshes.push(fillMesh, wireMesh)
    })

    // ─── Lighting ───
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dirLight = new THREE.DirectionalLight(0x4F46E5, 1.5)
    dirLight.position.set(3, 4, 5)
    scene.add(dirLight)
    const pointLight = new THREE.PointLight(0x06B6D4, 1.2, 20)
    pointLight.position.set(-3, -2, 3)
    scene.add(pointLight)

    // ─── Mouse parallax ───
    let mx = 0, my = 0
    const onMouseMove = (e: MouseEvent) => {
      mx = (e.clientX / W - 0.5) * 2
      my = (e.clientY / H - 0.5) * 2
    }
    window.addEventListener('mousemove', onMouseMove)

    // ─── Animation loop ───
    let t = 0
    let animId: number
    const animate = () => {
      animId = requestAnimationFrame(animate)
      t += 0.008

      // Rotate particles slowly
      particles.rotation.y = t * 0.04
      particles.rotation.x = t * 0.02

      // Mesh rotation + float
      meshes.forEach((m: any) => {
        m.rotation.x += m._rotSpeed[0]
        m.rotation.y += m._rotSpeed[1]
        m.rotation.z += m._rotSpeed[2]
        if (m._floatBase !== undefined) {
          m.position.y = m._floatBase + Math.sin(t + m._floatBase) * 0.12
        }
      })

      // Camera parallax from mouse
      camera.position.x += (mx * 0.4 - camera.position.x) * 0.05
      camera.position.y += (-my * 0.2 - camera.position.y) * 0.05
      camera.lookAt(0, 0, 0)

      renderer.render(scene, camera)
    }
    animate()

    // ─── Resize ───
    const onResize = () => {
      const W2 = window.innerWidth, H2 = window.innerHeight
      camera.aspect = W2 / H2
      camera.updateProjectionMatrix()
      renderer.setSize(W2, H2)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      if (mountRef.current?.contains(renderer.domElement)) {
        mountRef.current.removeChild(renderer.domElement)
      }
    }
  }, [])

  return (
    <div
      ref={mountRef}
      style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
      }}
    />
  )
}
