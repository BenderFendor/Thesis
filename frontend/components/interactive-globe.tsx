"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import dynamic from "next/dynamic"
import type { GlobeMethods } from "react-globe.gl"
import type { CountryArticleCounts, NewsArticle } from "@/lib/api"
import { geoCentroid } from "d3-geo"

const Globe = dynamic(() => import("react-globe.gl").then((mod) => mod.default), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
    </div>
  ),
})

interface InteractiveGlobeProps {
  articles: NewsArticle[]
  countryMetrics?: CountryArticleCounts
  onCountrySelect: (countryCode: string | null, countryName?: string | null) => void
  selectedCountry: string | null
}

interface CountryFeatureProperties {
  ISO_A2?: string
  ADM0_A3?: string
  NAME?: string
  [key: string]: unknown
}

interface CountryFeature {
  properties: CountryFeatureProperties
  geometry?: { coordinates?: unknown } | null
}

interface CountryFeatureCollection {
  features: CountryFeature[]
}

function getFeatureCenter(geometry?: { coordinates?: unknown } | null) {
  if (!geometry || !geometry.coordinates) return null
  const coords: Array<[number, number]> = []

  const collect = (input: unknown) => {
    if (!Array.isArray(input)) return
    if (typeof input[0] === "number" && typeof input[1] === "number") {
      coords.push([input[0], input[1]])
      return
    }
    input.forEach(collect)
  }

  collect(geometry.coordinates)

  if (coords.length === 0) return null

  let minLng = coords[0][0]
  let maxLng = coords[0][0]
  let minLat = coords[0][1]
  let maxLat = coords[0][1]

  coords.forEach(([lng, lat]) => {
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
  })

  return {
    lng: (minLng + maxLng) / 2,
    lat: (minLat + maxLat) / 2,
  }
}

function toCountryFeature(polygon: object | null): CountryFeature | null {
  if (!polygon || typeof polygon !== "object") return null
  if (!("properties" in polygon)) return null
  const feature = polygon as CountryFeature
  if (!feature.properties || typeof feature.properties !== "object") return null
  return feature
}

const GEOJSON_ISO_FALLBACKS: Record<string, string> = {
  FRA: "FR",
  NOR: "NO",
}

function getCountryIso(feature: CountryFeature | null): string | null {
  if (!feature) return null
  const iso = feature.properties.ISO_A2?.trim()
  if (iso && iso !== "-99") return iso

  const adm0 = feature.properties.ADM0_A3?.trim()
  if (!adm0) return null
  return GEOJSON_ISO_FALLBACKS[adm0] ?? null
}

export const __testUtils = {
  getCountryIso,
}

function heatColor(count: number, maxCount: number) {
  if (count <= 0 || maxCount <= 0) return "rgba(255, 255, 255, 0.03)"
  const ratio = Math.min(1, count / maxCount)
  const alpha = 0.12 + ratio * 0.72
  return `rgba(233, 118, 43, ${alpha.toFixed(2)})`
}

export function InteractiveGlobe({
  articles,
  countryMetrics,
  onCountrySelect,
  selectedCountry,
}: InteractiveGlobeProps) {
  const globeEl = useRef<GlobeMethods | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [countries, setCountries] = useState<CountryFeatureCollection>({ features: [] })
  const [hoverD, setHoverD] = useState<CountryFeature | null>(null)

  const shaderUniforms = useRef({
    uTime: { value: 0 },
    sunLightDirection: { value: new THREE.Vector3(-5, 3, 5).normalize() }
  })

  const customGlobeMaterial = useMemo(() => {
    const textureLoader = new THREE.TextureLoader()
    const emptyTexture = new THREE.Texture()
    
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: emptyTexture,
      bumpMap: emptyTexture,
      roughnessMap: emptyTexture,
      emissiveMap: emptyTexture,
      roughness: 1.0,
      metalness: 0.1,
      bumpScale: 1.5,
      emissive: new THREE.Color(0xffffee),
      emissiveIntensity: 2.0
    })

    if (typeof window !== 'undefined') {
      textureLoader.load('/3dmodel/textures/earth albedo.jpg', (tex) => { material.map = tex; material.needsUpdate = true; })
      textureLoader.load('/3dmodel/textures/earth bump.jpg', (tex) => { material.bumpMap = tex; material.needsUpdate = true; })
      textureLoader.load('/3dmodel/textures/earth land ocean mask.png', (tex) => { material.roughnessMap = tex; material.needsUpdate = true; })
      textureLoader.load('/3dmodel/textures/earth night_lights_modified.png', (tex) => { material.emissiveMap = tex; material.needsUpdate = true; })
    }

    material.onBeforeCompile = (shader) => {
      shader.uniforms.sunLightDirection = shaderUniforms.current.sunLightDirection
      shader.uniforms.uTime = shaderUniforms.current.uTime
      
      shader.vertexShader = shader.vertexShader.replace(
        'varying vec3 vViewPosition;',
        `varying vec3 vViewPosition;
         varying vec3 vWorldNormalCustom;
         varying vec2 vUvCustom;`
      )
      shader.vertexShader = shader.vertexShader.replace(
        '#include <defaultnormal_vertex>',
        `#include <defaultnormal_vertex>
         vWorldNormalCustom = normalize( (modelMatrix * vec4(objectNormal, 0.0)).xyz );
         vUvCustom = uv;`
      )
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         uniform vec3 sunLightDirection;
         uniform float uTime;
         varying vec3 vWorldNormalCustom;
         varying vec2 vUvCustom;`
      )
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `
        #ifdef USE_EMISSIVEMAP
          vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
          float dayNight = dot(normalize(vWorldNormalCustom), sunLightDirection);
          float nightIntensity = smoothstep(0.0, -0.2, dayNight);
          emissiveColor.rgb *= emissive * nightIntensity;
          totalEmissiveRadiance *= emissiveColor.rgb;
        #endif
        `
      )
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
          float isOcean = 1.0 - texelRoughness.g;
          
          float shimmer = sin(vUvCustom.x * 200.0 + uTime * 2.0) * sin(vUvCustom.y * 200.0 + uTime * 2.0) * 0.1;
          
          roughnessFactor = mix(1.0, 0.15 + shimmer * isOcean, isOcean);
        #endif
        `
      )
    }
    
    return material
  }, [])

  useEffect(() => {
    fetch("https://raw.githubusercontent.com/vasturiano/react-globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson")
      .then((res) => res.json())
      .then((data: unknown) => {
        if (
          typeof data === "object" &&
          data !== null &&
          Array.isArray((data as { features?: unknown }).features)
        ) {
          setCountries({ features: (data as { features: CountryFeature[] }).features })
        }
      })
      .catch(() => {
        setCountries({ features: [] })
      })
  }, [])

  const fallbackSourceCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    articles.forEach((article) => {
      if (!article.country) return
      counts[article.country] = (counts[article.country] || 0) + 1
    })
    return counts
  }, [articles])

  const displayCounts = countryMetrics?.counts && Object.keys(countryMetrics.counts).length > 0
    ? countryMetrics.counts
    : fallbackSourceCounts

  const maxCount = useMemo(() => {
    const values = Object.values(displayCounts)
    return values.length > 0 ? Math.max(...values) : 0
  }, [displayCounts])

  const countryCenters = useMemo(() => {
    const centers: Record<string, { lat: number; lng: number }> = {}
    countries.features.forEach((feature) => {
      const iso = getCountryIso(feature)
      if (!iso) return
      const center = getFeatureCenter(feature.geometry)
      if (center) {
        centers[iso] = center
      }
    })
    return centers
  }, [countries])

  useEffect(() => {
    if (!globeEl.current) return
    const controls = globeEl.current.controls() as {
      autoRotate?: boolean
      autoRotateSpeed?: number
      enableZoom?: boolean
      enablePan?: boolean
    }
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.5
    controls.enableZoom = false
    controls.enablePan = false
    globeEl.current.pointOfView({ altitude: 2.5 })
  }, [])

  useEffect(() => {
    if (!globeEl.current) return
    const controls = globeEl.current.controls() as { autoRotate?: boolean }
    if (!selectedCountry) {
      controls.autoRotate = true
      globeEl.current.pointOfView({ altitude: 2.5 }, 900)
      return
    }

    const center = countryCenters[selectedCountry]
    controls.autoRotate = false
    if (center) {
      globeEl.current.pointOfView({ lat: center.lat, lng: center.lng, altitude: 1.5 }, 900)
    }
  }, [countryCenters, selectedCountry])

  useEffect(() => {
    if (!containerRef.current) return
    const element = containerRef.current
    const updateSize = () => {
      const rect = element.getBoundingClientRect()
      setDimensions({
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      })
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!globeEl.current) return
    const globe = globeEl.current as unknown as { 
      scene: () => THREE.Scene; 
      getGlobeRadius: () => number; 
    }
    const scene = globe.scene()
    if (!scene) return

    // Setup ambient and directional light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.05)
    scene.add(ambientLight)

    const sunLight = new THREE.DirectionalLight(0xffffff, 3.5)
    sunLight.position.copy(shaderUniforms.current.sunLightDirection).multiplyScalar(500)
    scene.add(sunLight)

    const textureLoader = new THREE.TextureLoader()

    // Stars
    const starsGeo = new THREE.BufferGeometry()
    const starsCount = 4000
    const posArray = new Float32Array(starsCount * 3)
    const colorArray = new Float32Array(starsCount * 3)
    for (let i = 0; i < starsCount * 3; i += 3) {
      posArray[i] = (Math.random() - 0.5) * 3000
      posArray[i + 1] = (Math.random() - 0.5) * 3000
      posArray[i + 2] = (Math.random() - 0.5) * 3000
      const starBrightness = 0.5 + Math.random() * 0.5
      colorArray[i] = starBrightness
      colorArray[i + 1] = starBrightness
      colorArray[i + 2] = starBrightness
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3))
    starsGeo.setAttribute('color', new THREE.BufferAttribute(colorArray, 3))
    const starsMat = new THREE.PointsMaterial({
      size: 1.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true
    })
    const starMesh = new THREE.Points(starsGeo, starsMat)
    scene.add(starMesh)

    const clock = new THREE.Clock()
    const globeRadius = 100 // react-globe.gl defaults to 100

    // Realistic Atmosphere
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
        
        float fresnel = dot(viewDirection, normal);
        fresnel = clamp(1.0 - fresnel, 0.0, 1.0);
        
        float rayleigh = pow(fresnel, 3.5);
        
        float sunGlow = dot(sunDirection, viewDirection);
        sunGlow = clamp(sunGlow, 0.0, 1.0);
        float mie = pow(sunGlow, 40.0) * 0.5;
        
        float dayNight = dot(normal, sunDirection);
        float terminator = smoothstep(-0.2, 0.2, dayNight);
        
        vec3 color = atmosphereColor * (rayleigh + mie) * terminator;
        float alpha = (rayleigh + mie) * terminator;
        
        gl_FragColor = vec4(color, alpha);
      }
    `;

    const atmosGeo = new THREE.SphereGeometry(globeRadius * 1.03, 72, 72)
    const atmosMat = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertexShader,
      fragmentShader: atmosphereFragmentShader,
      uniforms: {
        sunDirection: shaderUniforms.current.sunLightDirection,
        atmosphereColor: { value: new THREE.Color(0x3a82f6) }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false
    })
    const atmosphereMesh = new THREE.Mesh(atmosGeo, atmosMat)
    scene.add(atmosphereMesh)

    // Add clouds
    let animationFrameId: number;
    textureLoader.load('/3dmodel/textures/clouds earth.png', (cloudsTexture) => {
      const cloudsGeo = new THREE.SphereGeometry(globeRadius * 1.012, 72, 72)
      const cloudsMat = new THREE.MeshStandardMaterial({
        map: cloudsTexture,
        transparent: true,
        opacity: 0.4,
        blending: THREE.NormalBlending,
        depthWrite: false,
      })
      const cloudsMesh = new THREE.Mesh(cloudsGeo, cloudsMat)
      scene.add(cloudsMesh)
      
      const animate = () => {
        shaderUniforms.current.uTime.value = clock.getElapsedTime()
        cloudsMesh.rotation.y += 0.0003
        animationFrameId = requestAnimationFrame(animate)
      }
      animate()
    })

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[var(--news-bg-primary)]">
      <Globe
        ref={globeEl}
        globeMaterial={customGlobeMaterial}
        backgroundImageUrl={null}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereAltitude={0}
        lineHoverPrecision={0}
        polygonsData={countries.features.filter((feature) => getCountryIso(feature) !== "AQ")}
        polygonAltitude={(polygon: object) => {
          const feature = toCountryFeature(polygon)
          if (!feature) return 0.01
          const iso = getCountryIso(feature)
          return feature === hoverD ? 0.12 : selectedCountry === iso ? 0.08 : 0.01
        }}
        polygonCapColor={(polygon: object) => {
          const feature = toCountryFeature(polygon)
          if (!feature) return "rgba(255, 255, 255, 0.03)"
          const iso = getCountryIso(feature) ?? ""
          const count = iso ? displayCounts[iso] || 0 : 0

          if (feature === hoverD) return "rgba(255, 255, 255, 0.2)"
          if (selectedCountry === iso) return "#e9762b"

          return heatColor(count, maxCount)
        }}
        polygonSideColor={() => "rgba(255, 255, 255, 0.05)"}
        polygonStrokeColor={() => "rgba(255, 255, 255, 0.08)"}
        polygonLabel={(polygon: object) => {
          const feature = toCountryFeature(polygon)
          if (!feature) return ""
          const d = feature.properties
          const iso = getCountryIso(feature) ?? "--"
          
          if (selectedCountry === iso) return ""
          
          const coverageCount = iso !== "--" ? displayCounts[iso] || 0 : 0
          const originCount = iso !== "--"
            ? countryMetrics?.source_counts?.[iso] || fallbackSourceCounts[iso] || 0
            : 0
          return `
          <div style="background: rgba(10,10,10,0.92); color: #EAEAEA; padding: 12px; border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 20px 40px rgba(0,0,0,0.35); min-width: 180px;">
            <p style="margin: 0; font-family: var(--font-instrument-serif); font-size: 16px; color: #e9762b;">${d.NAME}</p>
            <p style="margin: 8px 0 0; font-family: var(--font-geist-mono, monospace); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(234,234,234,0.65);">
              ISO ${iso}
            </p>
            <p style="margin: 8px 0 0; font-size: 12px; color: rgba(234,234,234,0.82);">
              Coverage heat: ${coverageCount}
            </p>
            <p style="margin: 4px 0 0; font-size: 12px; color: rgba(234,234,234,0.82);">
              Local outlets: ${originCount}
            </p>
          </div>
        `
        }}
        onPolygonHover={(polygon: object | null) => setHoverD(toCountryFeature(polygon))}
        onPolygonClick={(polygon: object) => {
          const feature = toCountryFeature(polygon)
          if (!feature) return
          const iso = getCountryIso(feature)
          if (!iso) return
          const name = feature.properties.NAME
          if (selectedCountry === iso) {
            onCountrySelect(null, null)
            // Zoom back out smoothly
            globeEl.current?.pointOfView({ altitude: 2.0 }, 800)
          } else {
            onCountrySelect(iso, name)
            
            // Get centroid for zooming using d3-geo
            const centroid = geoCentroid(feature as unknown as Parameters<typeof geoCentroid>[0])
            const lng = centroid[0]
            const lat = centroid[1]
            
            // Detect if mobile via screen width
            const isMobile = window.innerWidth < 1024
            
            // Apply a slight latitude offset (tilt up) so the country isn't hidden behind the bottom UI drawer
            // On mobile, we offset more aggressively because the drawer takes up ~60vh
            const latOffset = isMobile ? -25 : -5
            const zoomAlt = isMobile ? 1.0 : 1.2
            
            // Adjust zoom scale.
            globeEl.current?.pointOfView({ 
              lat: lat + latOffset, 
              lng, 
              altitude: zoomAlt
            }, 800)
          }
        }}
        width={dimensions.width}
        height={dimensions.height}
      />
    </div>
  )
}
