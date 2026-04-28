"use client"

import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react"
import * as THREE from "three"
import dynamic from "next/dynamic"
import type { GlobeMethods } from "react-globe.gl"
import type { CountryArticleCounts, NewsArticle } from "@/lib/api"
import { geoCentroid } from "d3-geo"
import { getCountryIso, type CountryFeature, type CountryFeatureCollection } from "@/lib/globe-country"

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
  lightingMode: EarthLightingMode
}

export type EarthLightingMode = "all-lit" | "day-night"
const EMPTY_COUNTRY_COLLECTION: CountryFeatureCollection = { features: [] }

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

function heatColor(count: number, maxCount: number) {
  if (count <= 0 || maxCount <= 0) return "rgba(0, 0, 0, 0)"
  const ratio = Math.min(1, count / maxCount)
  const red = Math.round(214 + ratio * 34)
  const green = Math.round(192 - ratio * 96)
  const blue = Math.round(128 - ratio * 78)
  const alpha = 0.54 + ratio * 0.28
  return `rgba(${red}, ${green}, ${Math.max(34, blue)}, ${alpha.toFixed(3)})`
}

function hoverHeatColor(count: number, maxCount: number) {
  const ratio = maxCount > 0 ? Math.min(1, count / maxCount) : 0
  const red = 255
  const green = Math.round(232 - ratio * 48)
  const blue = Math.round(176 - ratio * 88)
  const alpha = 0.78 + ratio * 0.16
  return `rgba(${red}, ${green}, ${Math.max(72, blue)}, ${alpha.toFixed(3)})`
}

function sourceHeatRatio(count: number, maxCount: number) {
  if (count <= 0 || maxCount <= 0) return 0
  return Math.min(1, count / maxCount)
}

function externalHeatColor(count: number, maxCount: number) {
  if (count <= 0 || maxCount <= 0) return "rgba(0, 0, 0, 0)"
  const ratio = Math.min(1, count / maxCount)
  const red = Math.round(102 + ratio * 42)
  const green = Math.round(132 + ratio * 48)
  const blue = Math.round(162 + ratio * 58)
  const alpha = 0.42 + ratio * 0.24
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`
}

function externalHoverHeatColor(count: number, maxCount: number) {
  const ratio = maxCount > 0 ? Math.min(1, count / maxCount) : 0
  const red = Math.round(154 + ratio * 28)
  const green = Math.round(188 + ratio * 28)
  const blue = Math.round(216 + ratio * 24)
  const alpha = 0.72 + ratio * 0.16
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`
}

function normalizeCountryKey(value: string) {
  return value.trim().toLowerCase()
}

function remapCountryCounts(
  counts: Record<string, number>,
  visibleCountries: CountryFeature[],
) {
  const nameToIso = new Map<string, string>()
  const isoSet = new Set<string>()

  visibleCountries.forEach((feature) => {
    const iso = getCountryIso(feature)
    const countryName = typeof feature.properties.NAME === "string" ? feature.properties.NAME : null
    if (!iso) return
    isoSet.add(iso)
    if (countryName) {
      nameToIso.set(normalizeCountryKey(countryName), iso)
    }
  })

  const remappedCounts: Record<string, number> = {}
  Object.entries(counts).forEach(([key, count]) => {
    const normalizedKey = key.trim().toUpperCase()
    const iso = isoSet.has(normalizedKey)
      ? normalizedKey
      : nameToIso.get(normalizeCountryKey(key))

    if (!iso) return
    remappedCounts[iso] = (remappedCounts[iso] || 0) + count
  })

  return remappedCounts
}

const EARTH_RADIUS = 100
const MOBILE_OVERVIEW_ALTITUDE = 4.25
const DESKTOP_OVERVIEW_ALTITUDE = 2.5
const GLOBE_TEXTURE_ROTATION_Y = -Math.PI / 2
const LOCAL_COUNTRY_GEOJSON_URL = "/globe/ne_110m_admin_0_countries.geojson"
const OPTIMIZED_TEXTURES = {
  day: "/3dmodel/textures/optimized/earth-albedo-2048.jpg",
  bump: "/3dmodel/textures/optimized/earth-bump-2048.jpg",
  night: "/3dmodel/textures/optimized/earth-night-lights-2048.png",
  surfaceMask: "/3dmodel/textures/optimized/earth-land-ocean-mask-2048.png",
  clouds: "/3dmodel/textures/optimized/clouds-earth-2048.webp",
} as const

const EARTH_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const EARTH_FRAGMENT_SHADER = `
  uniform sampler2D uDayTexture;
  uniform sampler2D uNightTexture;
  uniform sampler2D uBumpTexture;
  uniform sampler2D uSurfaceMask;
  uniform sampler2D uCloudTexture;
  uniform vec3 uSunDirection;
  uniform float uTime;
  uniform float uCloudOffset;
  uniform float uLightingMode;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  #include <common>

  float clamp01(float value) {
    return clamp(value, 0.0, 1.0);
  }

  float luma(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 sunDirection = normalize(uSunDirection);

    vec2 surfaceUv = vUv;
    vec2 cloudUv = vec2(vUv.x + uCloudOffset, vUv.y);

    vec3 dayColor = texture2D(uDayTexture, surfaceUv).rgb;
    float terrainHeight = texture2D(uBumpTexture, surfaceUv).r;
    float landMask = texture2D(uSurfaceMask, surfaceUv).r;
    float oceanMask = 1.0 - landMask;
    float nightMask = texture2D(uNightTexture, surfaceUv).r;
    float cloudMask = smoothstep(0.28, 0.82, luma(texture2D(uCloudTexture, cloudUv).rgb));
    float lightingMix = clamp01(uLightingMode);

    float sunFacing = dot(normal, sunDirection);
    float daylight = smoothstep(-0.18, 0.22, sunFacing);
    float diffuse = smoothstep(-0.08, 0.8, sunFacing);
    float displayDaylight = mix(1.0, daylight, lightingMix);
    float nightSide = (1.0 - daylight) * lightingMix;

    float viewFacing = clamp01(dot(normal, viewDirection));
    float fresnel = pow(1.0 - viewFacing, 5.0);
    float microWaves = 0.94 + 0.06 * sin(surfaceUv.x * 320.0 + uTime * 0.28) * sin(surfaceUv.y * 180.0 - uTime * 0.2);
    float terrainAccent = smoothstep(0.26, 0.78, terrainHeight);

    vec3 landDay = mix(dayColor, vec3(luma(dayColor)), 0.05);
    landDay *= mix(1.02 + terrainAccent * 0.08, 0.9 + diffuse * 0.16 + terrainAccent * 0.12, lightingMix);

    vec3 oceanDay = mix(dayColor, dayColor * vec3(0.18, 0.44, 0.84), 0.22);
    oceanDay = mix(oceanDay, vec3(0.006, 0.038, 0.11), 0.34);
    oceanDay *= mix(0.84, 0.35 + diffuse * 0.58, lightingMix);

    vec3 daySurface = mix(oceanDay, landDay, landMask);
    daySurface *= 1.0 - cloudMask * mix(0.06, daylight * 0.16, lightingMix);

    vec3 nightBase = mix(dayColor * 0.03, vec3(0.003, 0.005, 0.01), 0.55);
    vec3 cityLights = vec3(1.08, 0.77, 0.46) * pow(nightMask, 1.35) * nightSide * landMask * 1.85;

    vec3 halfVector = normalize(sunDirection + viewDirection);
    float specular = pow(clamp01(dot(normal, halfVector)), mix(220.0, 180.0, lightingMix));
    float specularStrength = mix(0.012 + fresnel * 0.08, mix(0.04, 0.58, fresnel), lightingMix);
    float oceanSpecular = specular * oceanMask * mix(0.35, daylight, lightingMix) * microWaves * specularStrength * 0.82;

    float twilight = smoothstep(-0.22, 0.02, sunFacing) * (1.0 - smoothstep(0.02, 0.22, sunFacing));
    twilight *= (0.45 + 0.55 * fresnel) * lightingMix;
    vec3 twilightColor = vec3(0.94, 0.39, 0.08) * twilight * 0.55;

    vec3 atmosphereWrap = mix(
      vec3(0.06, 0.12, 0.22) * fresnel * 0.16,
      vec3(0.10, 0.18, 0.32) * fresnel * daylight * 0.18,
      lightingMix
    );

    vec3 color = mix(nightBase, daySurface, displayDaylight);
    color += cityLights;
    color += vec3(oceanSpecular);
    color += twilightColor;
    color += atmosphereWrap;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const CLOUD_FRAGMENT_SHADER = `
  uniform sampler2D uCloudTexture;
  uniform vec3 uSunDirection;
  uniform float uCloudOffset;
  uniform float uLightingMode;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  #include <common>

  float clamp01(float value) {
    return clamp(value, 0.0, 1.0);
  }

  float luma(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 sunDirection = normalize(uSunDirection);

    vec2 cloudUv = vec2(vUv.x + uCloudOffset, vUv.y);
    float cloudMask = smoothstep(0.24, 0.8, luma(texture2D(uCloudTexture, cloudUv).rgb));
    float daylight = clamp01(dot(normal, sunDirection));
    float lightingMix = clamp01(uLightingMode);
    float rim = pow(1.0 - clamp01(dot(normal, viewDirection)), 3.0);
    float silverLining = pow(clamp01(dot(reflect(-sunDirection, normal), viewDirection)), 6.0);

    vec3 litColor = mix(vec3(0.08, 0.10, 0.14), vec3(0.92, 0.96, 1.0), 0.18 + daylight * 0.82);
    vec3 allLitColor = mix(vec3(0.72, 0.78, 0.84), vec3(0.96, 0.98, 1.0), 0.46 + rim * 0.24);
    vec3 color = mix(allLitColor, litColor, lightingMix);
    color += vec3(0.28, 0.36, 0.48) * rim * 0.25;
    color += vec3(1.0) * silverLining * mix(0.08, 0.18, lightingMix);

    float alpha = cloudMask * mix(0.22 + rim * 0.1, 0.16 + daylight * 0.42 + rim * 0.14, lightingMix);
    if (alpha < 0.01) discard;

    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const ATMOSPHERE_FRAGMENT_SHADER = `
  uniform vec3 uSunDirection;
  uniform float uLightingMode;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  #include <common>

  float clamp01(float value) {
    return clamp(value, 0.0, 1.0);
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 sunDirection = normalize(uSunDirection);

    float horizon = pow(1.0 - clamp01(dot(normal, viewDirection)), 3.4);
    float sunFacing = clamp01(dot(normal, sunDirection));
    float lightingMix = clamp01(uLightingMode);
    float forwardScatter = pow(clamp01(dot(viewDirection, sunDirection)), 6.0) * lightingMix;

    float alpha = mix(
      horizon * 0.26,
      horizon * (0.18 + sunFacing * 0.72) + horizon * forwardScatter * 0.12,
      lightingMix
    );
    vec3 color = mix(
      vec3(0.18, 0.42, 0.74),
      mix(vec3(0.08, 0.24, 0.52), vec3(0.44, 0.74, 1.0), sunFacing),
      lightingMix
    );

    gl_FragColor = vec4(color, alpha * 0.68);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function configureTexture(texture: THREE.Texture, options: { color?: boolean; anisotropy: number }) {
  texture.anisotropy = options.anisotropy
  texture.colorSpace = options.color ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = true
  texture.needsUpdate = true
}

async function loadManagedTexture(
  textureLoader: THREE.TextureLoader,
  path: string,
  options: { color?: boolean; anisotropy: number; maxTextureSize: number },
) {
  let texture = await textureLoader.loadAsync(path)
  const sourceImage = texture.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | undefined

  if (sourceImage) {
    const { width, height } = sourceImage
    if (width > options.maxTextureSize || height > options.maxTextureSize) {
      const scale = Math.min(options.maxTextureSize / width, options.maxTextureSize / height)
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.floor(width * scale))
      canvas.height = Math.max(1, Math.floor(height * scale))

      const context = canvas.getContext("2d")
      if (context) {
        context.drawImage(sourceImage as unknown as CanvasImageSource, 0, 0, canvas.width, canvas.height)
        texture.dispose()
        texture = new THREE.CanvasTexture(canvas)
      }
    }
  }

  configureTexture(texture, { color: options.color, anisotropy: options.anisotropy })
  return texture
}

function createStarField(count: number, spread: number) {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)

  for (let index = 0; index < count; index += 1) {
    const cursor = index * 3
    positions[cursor] = (Math.random() - 0.5) * spread
    positions[cursor + 1] = (Math.random() - 0.5) * spread
    positions[cursor + 2] = (Math.random() - 0.5) * spread

    const brightness = 0.55 + Math.random() * 0.4
    const warmth = Math.random() * 0.08
    colors[cursor] = brightness
    colors[cursor + 1] = brightness - warmth * 0.5
    colors[cursor + 2] = brightness + warmth
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))

  const material = new THREE.PointsMaterial({
    size: 1.15,
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    sizeAttenuation: true,
    depthWrite: false,
  })

  return new THREE.Points(geometry, material)
}

function createPlaceholderTexture(color: [number, number, number, number], options: { color?: boolean }) {
  const texture = new THREE.DataTexture(new Uint8Array(color), 1, 1, THREE.RGBAFormat)
  configureTexture(texture, { color: options.color, anisotropy: 1 })
  return texture
}

function applyGlobeTextures(
  material: THREE.ShaderMaterial,
  textures: {
    dayTexture: THREE.Texture
    nightTexture: THREE.Texture
    bumpTexture: THREE.Texture
    surfaceMaskTexture: THREE.Texture
    cloudTexture: THREE.Texture
  },
) {
  material.uniforms.uDayTexture.value = textures.dayTexture
  material.uniforms.uNightTexture.value = textures.nightTexture
  material.uniforms.uBumpTexture.value = textures.bumpTexture
  material.uniforms.uSurfaceMask.value = textures.surfaceMaskTexture
  material.uniforms.uCloudTexture.value = textures.cloudTexture
  material.needsUpdate = true
}

function restorePlaceholderGlobeTextures(material: THREE.ShaderMaterial, placeholderTextures: THREE.Texture[]) {
  material.uniforms.uDayTexture.value = placeholderTextures[0]
  material.uniforms.uNightTexture.value = placeholderTextures[1]
  material.uniforms.uBumpTexture.value = placeholderTextures[2]
  material.uniforms.uSurfaceMask.value = placeholderTextures[3]
  material.uniforms.uCloudTexture.value = placeholderTextures[4]
  material.needsUpdate = true
}

function setLightingModeUniform(material: THREE.ShaderMaterial, lightingMode: EarthLightingMode) {
  material.uniforms.uLightingMode.value = lightingMode === "day-night" ? 1 : 0
}

function updateAnimationUniforms(material: THREE.ShaderMaterial, elapsed: number) {
  material.uniforms.uTime.value = elapsed
  material.uniforms.uCloudOffset.value = (elapsed * 0.0032) % 1
}

function findGlobeAnchor(scene: THREE.Scene) {
  return (
    scene.children.find(
      (child): child is THREE.Object3D =>
        Boolean(child) &&
        (child as THREE.Object3D & { __globeObjType?: string }).__globeObjType === "globe",
    ) ?? scene
  )
}

function getQualityTier(width: number, height: number) {
  if (typeof window === "undefined") {
    return {
      pixelRatioCap: 1.1,
      maxTextureSize: 2048,
      starCount: 1400,
      sphereSegments: 96,
      anisotropyCap: 4,
    }
  }

  const minSide = Math.min(width || 0, height || 0)
  const dpr = window.devicePixelRatio || 1

  if (minSide < 560 || dpr >= 2.25) {
    return {
      pixelRatioCap: 0.9,
      maxTextureSize: 1024,
      starCount: 700,
      sphereSegments: 52,
      anisotropyCap: 2,
    }
  }

  if (minSide < 900 || dpr >= 1.6) {
    return {
      pixelRatioCap: 1.0,
      maxTextureSize: 1536,
      starCount: 1000,
      sphereSegments: 72,
      anisotropyCap: 3,
    }
  }

  return {
    pixelRatioCap: 1.1,
    maxTextureSize: 2048,
    starCount: 1400,
    sphereSegments: 96,
    anisotropyCap: 4,
  }
}

export function InteractiveGlobe({
  articles,
  countryMetrics,
  onCountrySelect,
  selectedCountry,
  lightingMode,
}: InteractiveGlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [hoverD, setHoverD] = useState<CountryFeature | null>(null)
  const [globeInstance, setGlobeInstance] = useState<GlobeMethods | null>(null)
  const globeRef = useMemo<MutableRefObject<GlobeMethods | undefined>>(() => {
    let current: GlobeMethods | undefined

    return {
      get current() {
        return current
      },
      set current(instance: GlobeMethods | undefined) {
        current = instance
        const nextInstance = instance ?? null
        setGlobeInstance((existing) => (existing === nextInstance ? existing : nextInstance))
      },
    }
  }, [])
  const qualityTier = useMemo(
    () => getQualityTier(dimensions.width, dimensions.height),
    [dimensions.height, dimensions.width],
  )
  const countriesQuery = useQuery<CountryFeatureCollection>({
    queryKey: ["globe-countries"],
    queryFn: async () => {
      const response = await fetch(LOCAL_COUNTRY_GEOJSON_URL)
      const data: unknown = await response.json()
      if (
        typeof data === "object" &&
        data !== null &&
        Array.isArray((data as { features?: unknown }).features)
      ) {
        return { features: (data as { features: CountryFeature[] }).features }
      }
      return { features: [] }
    },
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  })
  const countries = countriesQuery.data ?? EMPTY_COUNTRY_COLLECTION
  const visibleCountries = useMemo(
    () => countries.features.filter((feature) => Boolean(feature) && getCountryIso(feature) !== "AQ"),
    [countries.features],
  )

  const customGlobeMaterial = useMemo(() => {
    const placeholderDay = createPlaceholderTexture([5, 16, 34, 255], { color: true })
    const placeholderNight = createPlaceholderTexture([0, 0, 0, 255], {})
    const placeholderBump = createPlaceholderTexture([96, 96, 96, 255], {})
    const placeholderMask = createPlaceholderTexture([0, 0, 0, 255], {})
    const placeholderClouds = createPlaceholderTexture([0, 0, 0, 255], {})

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uDayTexture: { value: placeholderDay },
        uNightTexture: { value: placeholderNight },
        uBumpTexture: { value: placeholderBump },
        uSurfaceMask: { value: placeholderMask },
        uCloudTexture: { value: placeholderClouds },
        uSunDirection: { value: new THREE.Vector3(-0.84, 0.42, 0.74).normalize() },
        uTime: { value: 0 },
        uCloudOffset: { value: 0 },
        uLightingMode: { value: 0 },
      },
      vertexShader: EARTH_VERTEX_SHADER,
      fragmentShader: EARTH_FRAGMENT_SHADER,
    })
    material.userData.placeholderTextures = [
      placeholderDay,
      placeholderNight,
      placeholderBump,
      placeholderMask,
      placeholderClouds,
    ]
    return material
  }, [])

  useEffect(() => {
    setLightingModeUniform(customGlobeMaterial, lightingMode)
  }, [customGlobeMaterial, lightingMode])

  const fallbackSourceCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    articles.forEach((article) => {
      const sourceCountry = article.source_country || article.country
      if (!sourceCountry || sourceCountry === "International") return
      counts[sourceCountry] = (counts[sourceCountry] || 0) + 1
    })
    return counts
  }, [articles])

  const sourceOriginCounts =
    countryMetrics?.source_counts && Object.keys(countryMetrics.source_counts).length > 0
      ? countryMetrics.source_counts
      : fallbackSourceCounts

  const displayCounts = useMemo(
    () => remapCountryCounts(sourceOriginCounts, visibleCountries),
    [sourceOriginCounts, visibleCountries],
  )
  const mentionCounts = useMemo(
    () => remapCountryCounts(countryMetrics?.counts || {}, visibleCountries),
    [countryMetrics?.counts, visibleCountries],
  )

  const maxCount = useMemo(() => {
    const values = Object.values(displayCounts)
    return values.length > 0 ? Math.max(...values) : 0
  }, [displayCounts])
  const maxMentionCount = useMemo(() => {
    const values = Object.values(mentionCounts)
    return values.length > 0 ? Math.max(...values) : 0
  }, [mentionCounts])

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
    if (!globeInstance) return
    const controls = globeInstance.controls() as {
      autoRotate?: boolean
      autoRotateSpeed?: number
      enableZoom?: boolean
      enablePan?: boolean
    }
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.5
    controls.enableZoom = false
    controls.enablePan = false
    globeInstance.pointOfView({
      altitude: window.innerWidth < 1024 ? MOBILE_OVERVIEW_ALTITUDE : DESKTOP_OVERVIEW_ALTITUDE,
    })
  }, [globeInstance])

  useEffect(() => {
    if (!globeInstance) return
    const controls = globeInstance.controls() as { autoRotate?: boolean }
    if (!selectedCountry) {
      controls.autoRotate = true
      globeInstance.pointOfView({
        altitude: window.innerWidth < 1024 ? MOBILE_OVERVIEW_ALTITUDE : DESKTOP_OVERVIEW_ALTITUDE,
      }, 900)
      return
    }

    const center = countryCenters[selectedCountry]
    controls.autoRotate = false
    if (center) {
      const isMobile = window.innerWidth < 1024
      globeInstance.pointOfView({ lat: center.lat, lng: center.lng, altitude: isMobile ? 2.35 : 1.5 }, 900)
    }
  }, [countryCenters, globeInstance, selectedCountry])

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
    if (!globeInstance) return
    const renderer = globeInstance.renderer()
    if (!renderer) return

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityTier.pixelRatioCap))
  }, [globeInstance, qualityTier.pixelRatioCap])

  useEffect(() => {
    if (!globeInstance) return
    const globeMaterial = customGlobeMaterial
    if (!globeMaterial) return
    const globe = globeInstance
    const scene = globe.scene()
    const renderer = globe.renderer()
    if (!scene || !renderer) return

    const setupQualityTier = getQualityTier(
      containerRef.current?.clientWidth ?? window.innerWidth,
      containerRef.current?.clientHeight ?? window.innerHeight,
    )

    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05

    const sunDirection = globeMaterial.uniforms.uSunDirection.value as THREE.Vector3
    const globeAnchor = findGlobeAnchor(scene)
    const ambientLight = new THREE.AmbientLight(0x152131, 0.16)
    const hemisphereLight = new THREE.HemisphereLight(0x325d87, 0x04070d, 0.14)
    const sunLight = new THREE.DirectionalLight(0xfff4db, 2.4)
    sunLight.position.copy(sunDirection).multiplyScalar(EARTH_RADIUS * 6)

    scene.add(ambientLight)
    scene.add(hemisphereLight)
    scene.add(sunLight)

    const sceneObjects: THREE.Object3D[] = []
    const sceneMaterials: THREE.Material[] = []
    const sceneTextures: THREE.Texture[] = []
    const textureLoader = new THREE.TextureLoader()
    const clock = new THREE.Clock()
    const globeRadius = globe.getGlobeRadius()
    const maxTextureSize = Math.min(
      renderer.capabilities.maxTextureSize || setupQualityTier.maxTextureSize,
      setupQualityTier.maxTextureSize,
    )
    const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), setupQualityTier.anisotropyCap)
    const starField = createStarField(setupQualityTier.starCount, globeRadius * 34)
    starField.renderOrder = -20
    scene.add(starField)
    sceneObjects.push(starField)
    sceneMaterials.push(starField.material as THREE.Material)

    let animationFrameId = 0
    let disposed = false

    const initEarth = async () => {
      try {
        const [dayTexture, bumpTexture, nightTexture, surfaceMaskTexture, cloudTexture] = await Promise.all([
          loadManagedTexture(textureLoader, OPTIMIZED_TEXTURES.day, {
            color: true,
            anisotropy,
            maxTextureSize,
          }),
          loadManagedTexture(textureLoader, OPTIMIZED_TEXTURES.bump, {
            anisotropy,
            maxTextureSize,
          }),
          loadManagedTexture(textureLoader, OPTIMIZED_TEXTURES.night, {
            anisotropy,
            maxTextureSize,
          }),
          loadManagedTexture(textureLoader, OPTIMIZED_TEXTURES.surfaceMask, {
            anisotropy,
            maxTextureSize,
          }),
          loadManagedTexture(textureLoader, OPTIMIZED_TEXTURES.clouds, {
            anisotropy,
            maxTextureSize,
          }),
        ])

        if (disposed) {
          dayTexture.dispose()
          bumpTexture.dispose()
          nightTexture.dispose()
          surfaceMaskTexture.dispose()
          cloudTexture.dispose()
          return
        }

        sceneTextures.push(dayTexture, bumpTexture, nightTexture, surfaceMaskTexture, cloudTexture)

        applyGlobeTextures(globeMaterial, {
          dayTexture,
          nightTexture,
          bumpTexture,
          surfaceMaskTexture,
          cloudTexture,
        })

        const cloudsMaterial = new THREE.ShaderMaterial({
          uniforms: {
            uCloudTexture: { value: cloudTexture },
            uSunDirection: globeMaterial.uniforms.uSunDirection,
            uCloudOffset: globeMaterial.uniforms.uCloudOffset,
            uLightingMode: globeMaterial.uniforms.uLightingMode,
          },
          vertexShader: EARTH_VERTEX_SHADER,
          fragmentShader: CLOUD_FRAGMENT_SHADER,
          transparent: true,
          depthWrite: false,
          blending: THREE.NormalBlending,
        })

        const atmosphereMaterial = new THREE.ShaderMaterial({
          uniforms: {
            uSunDirection: globeMaterial.uniforms.uSunDirection,
            uLightingMode: globeMaterial.uniforms.uLightingMode,
          },
          vertexShader: EARTH_VERTEX_SHADER,
          fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
          transparent: true,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
          depthWrite: false,
        })

        const cloudsMesh = new THREE.Mesh(
          new THREE.SphereGeometry(
            globeRadius * 1.008,
            setupQualityTier.sphereSegments,
            setupQualityTier.sphereSegments,
          ),
          cloudsMaterial,
        )
        const atmosphereMesh = new THREE.Mesh(
          new THREE.SphereGeometry(
            globeRadius * 1.03,
            setupQualityTier.sphereSegments,
            setupQualityTier.sphereSegments,
          ),
          atmosphereMaterial,
        )

        cloudsMesh.rotation.y = GLOBE_TEXTURE_ROTATION_Y
        cloudsMesh.renderOrder = -1
        atmosphereMesh.renderOrder = 1

        globeAnchor.add(cloudsMesh)
        globeAnchor.add(atmosphereMesh)

        sceneObjects.push(cloudsMesh, atmosphereMesh)
        sceneMaterials.push(cloudsMaterial, atmosphereMaterial)
      } catch {
        // Keep the globe usable even if shader textures fail.
      }
    }

    initEarth()

    const animate = () => {
      if (disposed) return
      const elapsed = clock.getElapsedTime()
      updateAnimationUniforms(globeMaterial, elapsed)
      animationFrameId = requestAnimationFrame(animate)
    }

    const startAnimation = () => {
      if (!animationFrameId && !disposed) {
        animationFrameId = requestAnimationFrame(animate)
      }
    }

    const stopAnimation = () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
        animationFrameId = 0
      }
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopAnimation()
        return
      }
      clock.getElapsedTime()
      startAnimation()
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    if (!document.hidden) {
      startAnimation()
    }

    return () => {
      disposed = true
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      stopAnimation()

      scene.remove(ambientLight)
      scene.remove(hemisphereLight)
      scene.remove(sunLight)

      sceneObjects.forEach((object) => {
        object.parent?.remove(object)
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
        }
        if (object instanceof THREE.Points) {
          object.geometry.dispose()
        }
      })

      const placeholderTextures = globeMaterial.userData.placeholderTextures as THREE.Texture[] | undefined
      if (placeholderTextures) {
        restorePlaceholderGlobeTextures(globeMaterial, placeholderTextures)
      }

      sceneMaterials.forEach((material) => material.dispose())
      sceneTextures.forEach((texture) => texture.dispose())
    }
  }, [customGlobeMaterial, globeInstance])

  useEffect(() => {
    return () => {
      const placeholderTextures = customGlobeMaterial.userData.placeholderTextures as THREE.Texture[] | undefined
      placeholderTextures?.forEach((texture) => texture.dispose())
      customGlobeMaterial.dispose()
    }
  }, [customGlobeMaterial])

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[var(--news-bg-primary)]">
      <Globe
        ref={globeRef}
        globeMaterial={customGlobeMaterial}
        backgroundImageUrl={null}
        backgroundColor="rgba(0,0,0,0)"
        showAtmosphere={false}
        atmosphereAltitude={0}
        polygonsTransitionDuration={0}
        lineHoverPrecision={0}
        polygonsData={visibleCountries}
        polygonAltitude={(polygon: object) => {
          const feature = toCountryFeature(polygon)
          if (!feature) return 0.006
          const iso = getCountryIso(feature)
          const sourceCount = iso ? displayCounts[iso] || 0 : 0
          const mentionCount = iso ? mentionCounts[iso] || 0 : 0
          const ratio = sourceCount > 0
            ? sourceHeatRatio(sourceCount, maxCount)
            : sourceHeatRatio(mentionCount, maxMentionCount)
          if (feature === hoverD) return 0.1 + ratio * 0.03
          if (selectedCountry === iso) return 0.055 + ratio * 0.025
          return sourceCount > 0 ? 0.01 + ratio * 0.024 : 0.008 + ratio * 0.016
        }}
        polygonCapColor={(polygon: object) => {
          const feature = toCountryFeature(polygon)
          if (!feature) return "rgba(255, 255, 255, 0.03)"
          const iso = getCountryIso(feature) ?? ""
          const sourceCount = iso ? displayCounts[iso] || 0 : 0
          const mentionCount = iso ? mentionCounts[iso] || 0 : 0

          if (feature === hoverD) {
            return sourceCount > 0
              ? hoverHeatColor(sourceCount, maxCount)
              : externalHoverHeatColor(mentionCount, maxMentionCount)
          }
          if (selectedCountry === iso) return "rgba(233, 118, 43, 0.82)"
          if (sourceCount > 0) return heatColor(sourceCount, maxCount)
          return externalHeatColor(mentionCount, maxMentionCount)
        }}
        polygonSideColor={(polygon: object) => {
          const feature = toCountryFeature(polygon)
          if (!feature) return "rgba(255, 255, 255, 0.028)"
          const iso = getCountryIso(feature) ?? ""
          const sourceCount = iso ? displayCounts[iso] || 0 : 0
          const mentionCount = iso ? mentionCounts[iso] || 0 : 0
          const ratio = sourceCount > 0
            ? sourceHeatRatio(sourceCount, maxCount)
            : sourceHeatRatio(mentionCount, maxMentionCount)
          if (feature === hoverD) {
            return sourceCount > 0 ? "rgba(255, 214, 138, 0.58)" : "rgba(150, 196, 224, 0.5)"
          }
          if (selectedCountry === iso) return "rgba(233, 118, 43, 0.42)"
          if (sourceCount > 0) {
            return `rgba(214, 166, 90, ${(0.08 + ratio * 0.16).toFixed(3)})`
          }
          return `rgba(122, 162, 190, ${(0.08 + ratio * 0.14).toFixed(3)})`
        }}
        polygonStrokeColor={(polygon: object) => {
          const feature = toCountryFeature(polygon)
          if (!feature) return "rgba(255, 255, 255, 0.08)"
          const iso = getCountryIso(feature) ?? ""
          const sourceCount = iso ? displayCounts[iso] || 0 : 0
          const mentionCount = iso ? mentionCounts[iso] || 0 : 0
          const ratio = sourceCount > 0
            ? sourceHeatRatio(sourceCount, maxCount)
            : sourceHeatRatio(mentionCount, maxMentionCount)
          if (feature === hoverD) {
            return sourceCount > 0 ? "rgba(255, 240, 204, 0.95)" : "rgba(198, 224, 242, 0.9)"
          }
          if (selectedCountry === iso) return "rgba(233, 118, 43, 0.85)"
          if (sourceCount > 0) {
            return `rgba(228, 190, 120, ${(0.16 + ratio * 0.26).toFixed(3)})`
          }
          return `rgba(162, 196, 220, ${(0.16 + ratio * 0.22).toFixed(3)})`
        }}
        polygonLabel={(polygon: object) => {
          const feature = toCountryFeature(polygon)
          if (!feature) return ""
          const d = feature.properties
          const iso = getCountryIso(feature) ?? "--"
          
          if (selectedCountry === iso) return ""
          
          const originCount = iso !== "--" ? displayCounts[iso] || 0 : 0
          const coverageCount = iso !== "--"
            ? mentionCounts[iso] || 0
            : 0
          return `
          <div style="background: rgba(10,10,10,0.92); color: #EAEAEA; padding: 12px; border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 20px 40px rgba(0,0,0,0.35); min-width: 180px;">
            <p style="margin: 0; font-family: var(--font-instrument-serif); font-size: 16px; color: #e9762b;">${d.NAME}</p>
            <p style="margin: 8px 0 0; font-family: var(--font-geist-mono, monospace); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(234,234,234,0.65);">
              ISO ${iso}
            </p>
            <p style="margin: 8px 0 0; font-size: 12px; color: rgba(234,234,234,0.82);">
              External coverage: ${coverageCount}
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
            globeInstance?.pointOfView({
              altitude: window.innerWidth < 1024 ? MOBILE_OVERVIEW_ALTITUDE : 2.0,
            }, 800)
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
            const latOffset = isMobile ? -18 : -5
            const zoomAlt = isMobile ? 2.25 : 1.2
            
            // Adjust zoom scale.
            globeInstance?.pointOfView({ 
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
