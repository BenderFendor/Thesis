"use client"

import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"

interface ThreeGlobeProps {
  onCountrySelect: (country: string | null) => void
  selectedCountry: string | null
}

const countries = [
  { name: "United States", lat: 39.8283, lng: -98.5795 },
  { name: "United Kingdom", lat: 55.3781, lng: -3.436 },
  { name: "Germany", lat: 51.1657, lng: 10.4515 },
  { name: "France", lat: 46.2276, lng: 2.2137 },
  { name: "Japan", lat: 36.2048, lng: 138.2529 },
  { name: "Australia", lat: -25.2744, lng: 133.7751 },
  { name: "Brazil", lat: -14.235, lng: -51.9253 },
  { name: "India", lat: 20.5937, lng: 78.9629 },
  { name: "China", lat: 35.8617, lng: 104.1954 },
  { name: "Russia", lat: 61.524, lng: 105.3188 },
]

export function ThreeGlobe({ onCountrySelect, selectedCountry }: ThreeGlobeProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene>()
  const rendererRef = useRef<THREE.WebGLRenderer>()
  const globeRef = useRef<THREE.Object3D>()
  const markersRef = useRef<THREE.Group>()
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    if (!mountRef.current) return

    // Scene setup
    const scene = new THREE.Scene()
    sceneRef.current = scene

    // Camera setup
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000)
    camera.position.z = 850

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(500, 500)
    renderer.setClearColor(0x000000, 0)
    rendererRef.current = renderer
    mountRef.current.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = false; // Optional: disable zoom

    const loader = new GLTFLoader();
    loader.load(
      "/3dmodel/earth 2.glb", // Assuming the model is converted and placed in public/3dmodel
      (gltf) => {
        console.log("GLTF model loaded:", gltf)
        const globe = gltf.scene
        globe.traverse((child) => {
          if (child.name === "Background") {
            child.visible = false
          }
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh
            console.log("Inspecting mesh:", mesh.name, mesh)
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            materials.forEach((material) => {
              if (material) {
                console.log("Material:", material.name, material)
                if (material.map) {
                  console.log("Texture found for material:", material.name, material.map)
                } else {
                  console.log("No texture map for material:", material.name)
                }
                material.side = THREE.DoubleSide
              }
            })
          }
        })
        globe.scale.set(1, 1, 1) // Adjust scale if necessary
        globeRef.current = globe
        scene.add(globe)
        setIsLoaded(true)
      },
      undefined,
      (error) => {
        console.error("An error happened while loading the model:", error)
      }
    )

    // Country markers
    const markersGroup = new THREE.Group()
    markersRef.current = markersGroup
    scene.add(markersGroup)

    countries.forEach((country) => {
      // Convert lat/lng to 3D coordinates
      const phi = (90 - country.lat) * (Math.PI / 180)
      const theta = (country.lng + 180) * (Math.PI / 180)

      const x = -(1.02 * Math.sin(phi) * Math.cos(theta))
      const y = 1.02 * Math.cos(phi)
      const z = 1.02 * Math.sin(phi) * Math.sin(theta)

      // Create marker
      const markerGeometry = new THREE.SphereGeometry(0.02, 8, 8)
      const markerMaterial = new THREE.MeshBasicMaterial({
        color: selectedCountry === country.name ? 0x10b981 : 0x059669,
      })
      const marker = new THREE.Mesh(markerGeometry, markerMaterial)
      marker.position.set(x, y, z)
      marker.userData = { country: country.name }

      // Add glow effect for selected country
      if (selectedCountry === country.name) {
        const glowGeometry = new THREE.SphereGeometry(0.04, 8, 8)
        const glowMaterial = new THREE.MeshBasicMaterial({
          color: 0x10b981,
          transparent: true,
          opacity: 0.3,
        })
        const glow = new THREE.Mesh(glowGeometry, glowMaterial)
        glow.position.set(x, y, z)
        markersGroup.add(glow)
      }

      markersGroup.add(marker)
    })

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5)
    directionalLight.position.set(5, 5, 5)
    scene.add(directionalLight)

    // Add rim lighting
    const rimLight = new THREE.DirectionalLight(0x4fc3f7, 0.3)
    rimLight.position.set(-2, -1, -1)
    scene.add(rimLight)

    // Mouse interaction
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()

    const handleClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.setFromCamera(mouse, camera)
      const intersects = raycaster.intersectObjects(markersGroup.children)

      if (intersects.length > 0) {
        const clickedMarker = intersects[0].object
        const countryName = clickedMarker.userData.country
        onCountrySelect(selectedCountry === countryName ? null : countryName)
      }
    }

    renderer.domElement.addEventListener("click", handleClick)

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate)

      // Update controls
      controls.update()

      renderer.render(scene, camera)
    }

    animate()

    // Cleanup
    return () => {
      renderer.domElement.removeEventListener("click", handleClick)
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement)
      }
      renderer.dispose()
    }
  }, [])

  // Update markers when selectedCountry changes
  useEffect(() => {
    if (!markersRef.current) return

    // Clear existing markers
    while (markersRef.current.children.length > 0) {
      markersRef.current.remove(markersRef.current.children[0])
    }

    // Recreate markers with updated selection
    countries.forEach((country) => {
      const phi = (90 - country.lat) * (Math.PI / 180)
      const theta = (country.lng + 180) * (Math.PI / 180)

      const x = -(1.02 * Math.sin(phi) * Math.cos(theta))
      const y = 1.02 * Math.cos(phi)
      const z = 1.02 * Math.sin(phi) * Math.sin(theta)

      // Create marker
      const markerGeometry = new THREE.SphereGeometry(0.02, 8, 8)
      const markerMaterial = new THREE.MeshBasicMaterial({
        color: selectedCountry === country.name ? 0x10b981 : 0x059669,
      })
      const marker = new THREE.Mesh(markerGeometry, markerMaterial)
      marker.position.set(x, y, z)
      marker.userData = { country: country.name }

      // Add glow effect for selected country
      if (selectedCountry === country.name) {
        const glowGeometry = new THREE.SphereGeometry(0.04, 8, 8)
        const glowMaterial = new THREE.MeshBasicMaterial({
          color: 0x10b981,
          transparent: true,
          opacity: 0.3,
        })
        const glow = new THREE.Mesh(glowGeometry, glowMaterial)
        glow.position.set(x, y, z)
        markersRef.current?.add(glow)
      }

      markersRef.current?.add(marker)
    })
  }, [selectedCountry])

  return (
    <div className="flex items-center justify-center h-full">
      <div ref={mountRef} className={`transition-opacity duration-500 ${isLoaded ? "opacity-100" : "opacity-0"}`} />
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      )}
    </div>
  )
}
