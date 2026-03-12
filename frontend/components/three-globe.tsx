"use client"

import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js"

interface CountryData {
  code: string
  name: string
  lat: number
  lng: number
  articleCount?: number
}

interface ThreeGlobeProps {
  onCountrySelect: (countryCode: string | null) => void
  selectedCountry: string | null
  countryData?: CountryData[]
  intensityData?: Record<string, number>
}

const defaultCountries: CountryData[] = [
  { code: "US", name: "United States", lat: 39.8283, lng: -98.5795 },
  { code: "GB", name: "United Kingdom", lat: 55.3781, lng: -3.436 },
  { code: "DE", name: "Germany", lat: 51.1657, lng: 10.4515 },
  { code: "FR", name: "France", lat: 46.2276, lng: 2.2137 },
  { code: "JP", name: "Japan", lat: 36.2048, lng: 138.2529 },
  { code: "AU", name: "Australia", lat: -25.2744, lng: 133.7751 },
  { code: "BR", name: "Brazil", lat: -14.235, lng: -51.9253 },
  { code: "IN", name: "India", lat: 20.5937, lng: 78.9629 },
  { code: "CN", name: "China", lat: 35.8617, lng: 104.1954 },
  { code: "RU", name: "Russia", lat: 61.524, lng: 105.3188 },
]

function getMarkerSize(count: number, maxCount: number): number {
  if (!count || !maxCount) return 0.02
  const normalized = Math.min(count / maxCount, 1)
  return 0.02 + normalized * 0.04
}

function getMarkerColor(count: number, maxCount: number, isSelected: boolean): number {
  if (isSelected) return 0xe9762b
  if (!count || !maxCount) return 0xd46a3a

  const normalized = Math.min(count / maxCount, 1)
  if (normalized < 0.33) return 0xd46a3a
  else if (normalized < 0.66) return 0xf1a85a
  else return 0xe0563f
}

const atmosphereVertexShader = `
  varying vec3 vNormalWorld;
  varying vec3 vPositionWorld;
  void main() {
    vNormalWorld = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vPositionWorld = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const atmosphereFragmentShader = `
  uniform vec3 sunDirection;
  uniform vec3 atmosphereColor;
  varying vec3 vNormalWorld;
  varying vec3 vPositionWorld;

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vPositionWorld);
    vec3 normal = normalize(vNormalWorld);
    
    // Fresnel effect for atmospheric rim
    float fresnel = dot(viewDirection, normal);
    fresnel = clamp(1.0 - fresnel, 0.0, 1.0);
    
    // Rayleigh scattering approximation
    float rayleigh = pow(fresnel, 3.5);
    
    // Mie scattering approximation (sun glow)
    float sunGlow = dot(sunDirection, viewDirection);
    sunGlow = clamp(sunGlow, 0.0, 1.0);
    float mie = pow(sunGlow, 40.0) * 0.5;
    
    // Day/Night terminator line
    float dayNight = dot(normal, sunDirection);
    float terminator = smoothstep(-0.2, 0.2, dayNight);
    
    vec3 color = atmosphereColor * (rayleigh + mie) * terminator;
    float alpha = (rayleigh + mie) * terminator;
    
    gl_FragColor = vec4(color, alpha);
  }
`;

export function ThreeGlobe({
  onCountrySelect,
  selectedCountry,
  countryData,
  intensityData = {},
}: ThreeGlobeProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const markersRef = useRef<THREE.Group | null>(null)
  const earthRef = useRef<THREE.Mesh | null>(null)
  const cloudsRef = useRef<THREE.Mesh | null>(null)

  const countries = countryData || defaultCountries
  const maxCount = Object.values(intensityData).reduce((max, v) => Math.max(max, v), 1)

  useEffect(() => {
    if (!mountRef.current) return

    const width = mountRef.current.clientWidth || 500
    const height = mountRef.current.clientHeight || 500

    const scene = new THREE.Scene()
    // Background Environment (Stars)
    const starsGeo = new THREE.BufferGeometry()
    const starsCount = 3000
    const posArray = new Float32Array(starsCount * 3)
    const colorArray = new Float32Array(starsCount * 3)
    for (let i = 0; i < starsCount * 3; i+=3) {
      posArray[i] = (Math.random() - 0.5) * 800
      posArray[i+1] = (Math.random() - 0.5) * 800
      posArray[i+2] = (Math.random() - 0.5) * 800
      
      const starBrightness = 0.5 + Math.random() * 0.5
      colorArray[i] = starBrightness
      colorArray[i+1] = starBrightness
      colorArray[i+2] = starBrightness
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3))
    starsGeo.setAttribute('color', new THREE.BufferAttribute(colorArray, 3))
    const starsMat = new THREE.PointsMaterial({
      size: 0.8,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true
    })
    const starMesh = new THREE.Points(starsGeo, starsMat)
    scene.add(starMesh)

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
    camera.position.z = 4 // Adjusted for 1-unit radius earth

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 1)
    renderer.shadowMap.enabled = true
    mountRef.current.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.enableZoom = true
    controls.minDistance = 1.5
    controls.maxDistance = 10

    // Load Textures
    const textureLoader = new THREE.TextureLoader()
    let texturesLoaded = 0
    const checkLoaded = () => {
      texturesLoaded++
      if (texturesLoaded === 5) setIsLoaded(true)
    }

    const albedoMap = textureLoader.load('/3dmodel/textures/earth albedo.jpg', checkLoaded)
    const bumpMap = textureLoader.load('/3dmodel/textures/earth bump.jpg', checkLoaded)
    const roughnessMap = textureLoader.load('/3dmodel/textures/earth land ocean mask.png', checkLoaded)
    const emissiveMap = textureLoader.load('/3dmodel/textures/earth night_lights_modified.png', checkLoaded)
    const cloudsMap = textureLoader.load('/3dmodel/textures/clouds earth.png', checkLoaded)

    // Sun Illumination
    const sunDirection = new THREE.Vector3(5, 3, 5).normalize()
    const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5)
    directionalLight.position.copy(sunDirection).multiplyScalar(100)
    directionalLight.castShadow = true
    scene.add(directionalLight)

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.05)
    scene.add(ambientLight)

    // Earth Geometry
    const earthGeo = new THREE.SphereGeometry(1, 128, 128)
    const earthMat = new THREE.MeshStandardMaterial({
      map: albedoMap,
      bumpMap: bumpMap,
      bumpScale: 0.015,
      roughnessMap: roughnessMap,
      roughness: 1.0,
      metalness: 0.1,
      emissiveMap: emissiveMap,
      emissive: new THREE.Color(0xffffee),
      emissiveIntensity: 1.5,
    })

    const uniforms = {
      uTime: { value: 0 },
      sunLightDirection: { value: sunDirection }
    }

    earthMat.onBeforeCompile = (shader) => {
      shader.uniforms.sunLightDirection = uniforms.sunLightDirection;
      shader.uniforms.uTime = uniforms.uTime;
      
      shader.vertexShader = shader.vertexShader.replace(
        'varying vec3 vViewPosition;',
        `varying vec3 vViewPosition;
         varying vec3 vWorldNormalCustom;
         varying vec2 vUvCustom;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <defaultnormal_vertex>',
        `#include <defaultnormal_vertex>
         vWorldNormalCustom = normalize( (modelMatrix * vec4(objectNormal, 0.0)).xyz );
         vUvCustom = uv;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         uniform vec3 sunLightDirection;
         uniform float uTime;
         varying vec3 vWorldNormalCustom;
         varying vec2 vUvCustom;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `
        #ifdef USE_EMISSIVEMAP
          vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
          
          float dayNight = dot(normalize(vWorldNormalCustom), sunLightDirection);
          float nightIntensity = smoothstep(0.1, -0.2, dayNight);
          
          emissiveColor.rgb *= emissive * nightIntensity;
          totalEmissiveRadiance *= emissiveColor.rgb;
        #endif
        `
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
          // Land is white (1.0), Ocean is black (0.0). 
          float isOcean = 1.0 - texelRoughness.g;
          
          // Add shimmering effect to the ocean
          float shimmer = sin(vUvCustom.x * 200.0 + uTime * 2.0) * sin(vUvCustom.y * 200.0 + uTime * 2.0) * 0.1;
          
          // Ocean gets low roughness (shiny) + shimmer, land gets high roughness (matte)
          roughnessFactor = mix(1.0, 0.15 + shimmer * isOcean, isOcean);
        #endif
        `
      );
    }

    const earth = new THREE.Mesh(earthGeo, earthMat)
    earthRef.current = earth
    scene.add(earth)

    // Cloud Geometry
    const cloudGeo = new THREE.SphereGeometry(1.006, 64, 64)
    const cloudMat = new THREE.MeshStandardMaterial({
      map: cloudsMap,
      alphaMap: cloudsMap,
      transparent: true,
      opacity: 0.8,
      blending: THREE.NormalBlending,
      depthWrite: false,
    })
    const clouds = new THREE.Mesh(cloudGeo, cloudMat)
    cloudsRef.current = clouds
    scene.add(clouds)

    // Atmospheric Shaders
    const atmosGeo = new THREE.SphereGeometry(1.02, 64, 64)
    const atmosMat = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertexShader,
      fragmentShader: atmosphereFragmentShader,
      uniforms: {
        sunDirection: { value: sunDirection },
        atmosphereColor: { value: new THREE.Color(0x3a82f6) }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false
    })
    const atmosphere = new THREE.Mesh(atmosGeo, atmosMat)
    scene.add(atmosphere)

    // Markers Group
    const markersGroup = new THREE.Group()
    markersRef.current = markersGroup
    scene.add(markersGroup)

    // Post-Processing Pipeline
    const composer = new EffectComposer(renderer)
    const renderPass = new RenderPass(scene, camera)
    composer.addPass(renderPass)

    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 1.0, 0.4, 0.85)
    bloomPass.threshold = 0.2
    bloomPass.strength = 0.6
    bloomPass.radius = 0.5
    composer.addPass(bloomPass)

    const smaaPass = new SMAAPass(width * renderer.getPixelRatio(), height * renderer.getPixelRatio())
    composer.addPass(smaaPass)

    // Resizing
    const handleResize = () => {
      if (!mountRef.current) return
      const newWidth = mountRef.current.clientWidth
      const newHeight = mountRef.current.clientHeight
      camera.aspect = newWidth / newHeight
      camera.updateProjectionMatrix()
      renderer.setSize(newWidth, newHeight)
      composer.setSize(newWidth, newHeight)
    }
    window.addEventListener('resize', handleResize)

    // Mouse Interaction
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
        const countryCodeValue = clickedMarker.userData.countryCode
        if (typeof countryCodeValue === "string" && countryCodeValue.length > 0) {
          onCountrySelect(selectedCountry === countryCodeValue ? null : countryCodeValue)
        }
      }
    }
    renderer.domElement.addEventListener("click", handleClick)

    const clock = new THREE.Clock()

    const animate = () => {
      requestAnimationFrame(animate)
      const delta = clock.getDelta()
      
      uniforms.uTime.value = clock.getElapsedTime()

      controls.update()

      // Independent rotation for clouds
      if (cloudsRef.current) {
        cloudsRef.current.rotation.y += delta * 0.02
      }
      
      // Slight rotation for earth to keep it dynamic if desired (optional)
      if (earthRef.current) {
        earthRef.current.rotation.y += delta * 0.005
        markersGroup.rotation.y = earthRef.current.rotation.y // sync markers
      }

      composer.render()
    }
    animate()

    return () => {
      window.removeEventListener('resize', handleResize)
      renderer.domElement.removeEventListener("click", handleClick)
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement)
      }
      renderer.dispose()
      earthGeo.dispose()
      earthMat.dispose()
      cloudGeo.dispose()
      cloudMat.dispose()
      atmosGeo.dispose()
      atmosMat.dispose()
      starsGeo.dispose()
      starsMat.dispose()
      composer.dispose()
    }
  }, [])

  useEffect(() => {
    if (!markersRef.current || !earthRef.current) return
    const markersGroup = markersRef.current

    while (markersGroup.children.length > 0) {
      markersGroup.remove(markersGroup.children[0])
    }

    countries.forEach((country) => {
      const phi = (90 - country.lat) * (Math.PI / 180)
      const theta = (country.lng + 180) * (Math.PI / 180)

      const x = -(1.02 * Math.sin(phi) * Math.cos(theta))
      const y = 1.02 * Math.cos(phi)
      const z = 1.02 * Math.sin(phi) * Math.sin(theta)

      const articleCount = intensityData[country.code] || 0
      const isSelected = selectedCountry === country.code

      const markerSize = getMarkerSize(articleCount, maxCount)
      const markerColor = getMarkerColor(articleCount, maxCount, isSelected)

      const markerGeometry = new THREE.SphereGeometry(markerSize, 8, 8)
      const markerMaterial = new THREE.MeshBasicMaterial({ color: markerColor })
      const marker = new THREE.Mesh(markerGeometry, markerMaterial)
      marker.position.set(x, y, z)
      marker.userData = { countryCode: country.code, countryName: country.name, articleCount }

      if (isSelected) {
        const glowGeometry = new THREE.SphereGeometry(markerSize * 2, 8, 8)
        const glowMaterial = new THREE.MeshBasicMaterial({
          color: 0x10b981,
          transparent: true,
          opacity: 0.5,
        })
        const glow = new THREE.Mesh(glowGeometry, glowMaterial)
        glow.position.set(x, y, z)
        markersGroup.add(glow)
      }
      markersGroup.add(marker)
    })
  }, [selectedCountry, intensityData, countries, maxCount])

  return (
    <div className="w-full h-full relative">
      <div ref={mountRef} className={`w-full h-full transition-opacity duration-1000 ${isLoaded ? "opacity-100" : "opacity-0"}`} />
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      )}
    </div>
  )
}