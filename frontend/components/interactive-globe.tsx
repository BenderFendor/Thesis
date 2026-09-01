"use client"

import { useQuery } from "@tanstack/react-query"
import { geoCentroid } from "d3-geo"
import dynamic from "next/dynamic"
import { useEffect, useMemo, useRef, useState } from "react"
import type { ComponentType, MutableRefObject } from "react"
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Clock,
  DataTexture,
  DirectionalLight,
  HemisphereLight,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  NormalBlending,
  Points,
  PointsMaterial,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  TextureLoader,
  Vector3,
} from "three"
import type { IUniform ,
  Light,
  Material,
  Object3D,
  Scene,
  Texture} from "three"
import type { GlobeMethods, GlobeProps } from "react-globe.gl"
import type { CountryArticleCounts, NewsArticle } from "@/lib/api"
import { getCountryIso } from "@/lib/globe-country"
import type { CountryFeature, CountryFeatureCollection } from "@/lib/globe-country"
import { z } from "zod"

export type EarthLightingMode = "all-lit" | "day-night"

export type InteractiveGlobeComponent = ComponentType<
  GlobeProps & { ref?: MutableRefObject<GlobeMethods | undefined> }
>

const Globe = dynamic(() => import("react-globe.gl").then((mod) => mod.default), {
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
    </div>
  ),
  ssr: false,
})

interface InteractiveGlobeProps {
  articles: NewsArticle[]
  countryMetrics?: CountryArticleCounts
  globeComponent?: InteractiveGlobeComponent
  onCountrySelect: (countryCode: string | null, countryName?: string | null) => void
  selectedCountry: string | null
  lightingMode: EarthLightingMode
}

interface CountryCenter {
  lat: number
  lng: number
}

interface GlobeUniforms {
  [uniform: string]: IUniform
  uBumpTexture: { value: Texture }
  uCloudOffset: { value: number }
  uCloudTexture: { value: Texture }
  uDayTexture: { value: Texture }
  uLightingMode: { value: number }
  uNightTexture: { value: Texture }
  uSunDirection: { value: Vector3 }
  uSurfaceMask: { value: Texture }
  uTime: { value: number }
}

interface GlobeMaterialSetup {
  material: ShaderMaterial
  placeholderTextures: readonly Texture[]
  uniforms: GlobeUniforms
}

interface GlobeTextureSet {
  bumpTexture: Texture
  cloudTexture: Texture
  dayTexture: Texture
  nightTexture: Texture
  surfaceMaskTexture: Texture
}

interface PolygonHeat {
  iso: string | null
  mentionCount: number
  ratio: number
  sourceCount: number
}

interface QualityTier {
  anisotropyCap: number
  maxTextureSize: number
  pixelRatioCap: number
  sphereSegments: number
  starCount: number
}

const CountryFeatureSchema = z.custom<CountryFeature>(),
 CountryCollectionSchema = z.object({ features: z.array(CountryFeatureSchema) }),
 ATMOSPHERE_FRAGMENT_SHADER = `
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
`,
 ATMOSPHERE_RADIUS_FACTOR = 1.03,
 BUMP_PLACEHOLDER_COLOR = [96, 96, 96, 255] as const,
 CAP_DEFAULT_COLOR = "rgba(255, 255, 255, 0.03)",
 CAP_SELECTED_COLOR = "rgba(233, 118, 43, 0.82)",
 CLOUD_FRAGMENT_SHADER = `
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
`,
 CLOUD_PLACEHOLDER_COLOR = [0, 0, 0, 255] as const,
 CLOUD_RADIUS_FACTOR = 1.008,
 COLOR_PRECISION = 3,
 DEFAULT_PIXEL_RATIO = 1,
 DEFAULT_POLYGON_ALTITUDE = 0.006,
 DESKTOP_CLICK_ALTITUDE = 1.2,
 DESKTOP_DESELECT_ALTITUDE = 2,
 DESKTOP_FOCUS_ALTITUDE = 1.5,
 DESKTOP_LAT_OFFSET = -5,
 DESKTOP_OVERVIEW_ALTITUDE = 2.5,
 DPR_HIGH_CUTOFF = 2.25,
 DPR_MEDIUM_CUTOFF = 1.6,
 EARTH_FRAGMENT_SHADER = `
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
`,
 EARTH_RADIUS = 100,
 EARTH_VERTEX_SHADER = `
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
`,
 EMPTY_COUNTRY_COLLECTION = { features: [] } as CountryFeatureCollection,
 EXTERNAL_ALTITUDE_BASE = 0.008,
 EXTERNAL_ALTITUDE_STEP = 0.016,
 EXTERNAL_CAP_ALPHA_BASE = 0.42,
 EXTERNAL_CAP_ALPHA_STEP = 0.24,
 EXTERNAL_CAP_BLUE_BASE = 162,
 EXTERNAL_CAP_BLUE_STEP = 58,
 EXTERNAL_CAP_GREEN_BASE = 132,
 EXTERNAL_CAP_GREEN_STEP = 48,
 EXTERNAL_CAP_RED_BASE = 102,
 EXTERNAL_CAP_RED_STEP = 42,
 EXTERNAL_HOVER_ALPHA_BASE = 0.72,
 EXTERNAL_HOVER_ALPHA_STEP = 0.16,
 EXTERNAL_HOVER_BLUE_BASE = 216,
 EXTERNAL_HOVER_BLUE_STEP = 24,
 EXTERNAL_HOVER_GREEN_BASE = 188,
 EXTERNAL_HOVER_GREEN_STEP = 28,
 EXTERNAL_HOVER_RED_BASE = 154,
 EXTERNAL_HOVER_RED_STEP = 28,
 EXTERNAL_SIDE_ALPHA_STEP = 0.14,
 EXTERNAL_SIDE_RGB = [122, 162, 190] as const,
 EXTERNAL_STROKE_ALPHA_STEP = 0.22,
 EXTERNAL_STROKE_RGB = [162, 196, 220] as const,
 FOCUS_TRANSITION_MS = 800,
 FULL_RATIO = 1,
 GLOBE_MIN_SIDE_HIGH = 900,
 GLOBE_MIN_SIDE_LOW = 560,
 GLOBE_TEXTURE_ROTATION_Y = -Math.PI / 2,
 HEAT_ALPHA_BASE = 0.54,
 HEAT_ALPHA_STEP = 0.28,
 HEAT_BLUE_BASE = 128,
 HEAT_BLUE_FLOOR = 34,
 HEAT_BLUE_STEP = 78,
 HEAT_GREEN_BASE = 192,
 HEAT_GREEN_STEP = 96,
 HEAT_RED_BASE = 214,
 HEAT_RED_STEP = 34,
 HIGHER_QUALITY_TIER = {
  anisotropyCap: 4,
  maxTextureSize: 2048,
  pixelRatioCap: 1.1,
  sphereSegments: 96,
  starCount: 1400,
 },
 HOVER_ALPHA_BASE = 0.78,
 HOVER_ALPHA_STEP = 0.16,
 HOVER_ALTITUDE_BASE = 0.1,
 HOVER_ALTITUDE_STEP = 0.03,
 HOVER_BLUE_BASE = 176,
 HOVER_BLUE_FLOOR = 72,
 HOVER_BLUE_STEP = 88,
 HOVER_GREEN_BASE = 232,
 HOVER_GREEN_STEP = 48,
 HOVER_RED_BASE = 255,
 LABEL_BACKGROUND_RGB = "rgba(10, 10, 10, 0.92)",
 LABEL_BORDER_ALPHA = 0.12,
 LABEL_BORDER_WIDTH = 1,
 LABEL_BOX_SHADOW_OPACITY = 0.35,
 LABEL_BOX_SHADOW_SIZE = 40,
 LABEL_BOX_SHADOW_VERTICAL = 20,
 LABEL_DETAIL_SIZE = 12,
 LABEL_DETAIL_TEXT_COLOR = "rgba(234, 234, 234, 0.82)",
 LABEL_LETTER_SPACING = 0.16,
 LABEL_MARGIN_PAIR = 8,
 LABEL_MARGIN_SINGLE = 4,
 LABEL_META_SIZE = 10,
 LABEL_META_TEXT_COLOR = "rgba(234, 234, 234, 0.65)",
 LABEL_MIN_WIDTH = 180,
 LABEL_PADDING = 12,
 LABEL_TEXT_COLOR = "#EAEAEA",
 LABEL_TITLE_COLOR = "#e9762b",
 LABEL_TITLE_SIZE = 16,
 LOCAL_COUNTRY_GEOJSON_URL = "/globe/ne_110m_admin_0_countries.geojson",
 LOWER_QUALITY_TIER = {
  anisotropyCap: 2,
  maxTextureSize: 1024,
  pixelRatioCap: 0.9,
  sphereSegments: 52,
  starCount: 700,
 },
 MIDDLE_QUALITY_TIER = {
  anisotropyCap: 3,
  maxTextureSize: 1536,
  pixelRatioCap: 1,
  sphereSegments: 72,
  starCount: 1000,
 },
 MIN_TEXTURE_EDGE = 1,
 MOBILE_BREAKPOINT = 1024,
 MOBILE_CLICK_ALTITUDE = 2.25,
 MOBILE_FOCUS_ALTITUDE = 2.35,
 MOBILE_LAT_OFFSET = -18,
 MOBILE_OVERVIEW_ALTITUDE = 4.25,
 NIGHT_PLACEHOLDER_COLOR = [0, 0, 0, 255] as const,
 ANTLARCTICA_USER_ISO = "AQ",
 OPTIMIZED_TEXTURES = {
  bump: "/3dmodel/textures/optimized/earth-bump-2048.jpg",
  clouds: "/3dmodel/textures/optimized/clouds-earth-2048.webp",
  day: "/3dmodel/textures/optimized/earth-albedo-2048.jpg",
  night: "/3dmodel/textures/optimized/earth-night-lights-2048.png",
  surfaceMask: "/3dmodel/textures/optimized/earth-land-ocean-mask-2048.png",
 } as const,
 PLACEHOLDER_DAY_COLOR = [5, 16, 34, 255] as const,
 PLACEHOLDER_TEXTURE_HEIGHT = 1,
 PLACEHOLDER_TEXTURE_WIDTH = 1,
 SELECTED_ALTITUDE_BASE = 0.055,
 SELECTED_ALTITUDE_STEP = 0.025,
 SIDE_ALPHA_BASE = 0.08,
 SIDE_DEFAULT_COLOR = "rgba(255, 255, 255, 0.028)",
 SIDE_HOVER_EXTERNAL_COLOR = "rgba(150, 196, 224, 0.5)",
 SIDE_HOVER_SOURCE_COLOR = "rgba(255, 214, 138, 0.58)",
 SIDE_SELECTED_COLOR = "rgba(233, 118, 43, 0.42)",
 SOURCE_ALTITUDE_BASE = 0.01,
 SOURCE_ALTITUDE_STEP = 0.024,
 SOURCE_SIDE_ALPHA_STEP = 0.16,
 SOURCE_SIDE_RGB = [214, 166, 90] as const,
 SOURCE_STROKE_ALPHA_STEP = 0.26,
 SOURCE_STROKE_RGB = [228, 190, 120] as const,
 STAR_FIELD_SPREAD_FACTOR = 34,
 STROKE_ALPHA_BASE = 0.16,
 STROKE_DEFAULT_COLOR = "rgba(255, 255, 255, 0.08)",
 STROKE_HOVER_EXTERNAL_COLOR = "rgba(198, 224, 242, 0.9)",
 STROKE_HOVER_SOURCE_COLOR = "rgba(255, 240, 204, 0.95)",
 STROKE_SELECTED_COLOR = "rgba(233, 118, 43, 0.85)",
 SUN_COMPONENT_X = -0.84,
 SUN_COMPONENT_Y = 0.42,
 SUN_COMPONENT_Z = 0.74,
 SUN_LIGHT_DIRECTION = new Vector3(SUN_COMPONENT_X, SUN_COMPONENT_Y, SUN_COMPONENT_Z).normalize(),
 SUN_LIGHT_DISTANCE_FACTOR = 6,
 TRANSPARENT_RGBA = "rgba(0, 0, 0, 0)",
 UNKNOWN_ISO_LABEL = "--",
 ZERO_COUNT = 0,

 applyGlobeTextures = (uniforms: GlobeUniforms, textures: Readonly<GlobeTextureSet>): void => {
  uniforms.uDayTexture.value = textures.dayTexture
  uniforms.uNightTexture.value = textures.nightTexture
  uniforms.uBumpTexture.value = textures.bumpTexture
  uniforms.uSurfaceMask.value = textures.surfaceMaskTexture
  uniforms.uCloudTexture.value = textures.cloudTexture
  uniforms.uCloudOffset.value = ZERO_COUNT
 },

 buildCountryLabel = (feature: Readonly<CountryFeature>, displayCounts: Readonly<Record<string, number>>, mentionCounts: Readonly<Record<string, number>>): string => {
  const iso = getCountryIso(feature) ?? UNKNOWN_ISO_LABEL,
   originCount = displayCounts[iso] ?? ZERO_COUNT,
   coverageCount = mentionCounts[iso] ?? ZERO_COUNT,
   countryName = feature.properties.NAME
  return `
          <div style="background: ${LABEL_BACKGROUND_RGB}; color: ${LABEL_TEXT_COLOR}; padding: ${LABEL_PADDING}px; border: ${LABEL_BORDER_WIDTH}px solid rgba(255,255,255,${LABEL_BORDER_ALPHA}); box-shadow: 0 ${LABEL_BOX_SHADOW_VERTICAL}px ${LABEL_BOX_SHADOW_SIZE}px rgba(0,0,0,${LABEL_BOX_SHADOW_OPACITY}); min-width: ${LABEL_MIN_WIDTH}px;">
            <p style="margin: 0; font-family: var(--font-instrument-serif); font-size: ${LABEL_TITLE_SIZE}px; color: ${LABEL_TITLE_COLOR};">${countryName}</p>
            <p style="margin: ${LABEL_MARGIN_PAIR}px 0 0; font-family: var(--font-geist-mono, monospace); font-size: ${LABEL_META_SIZE}px; letter-spacing: ${LABEL_LETTER_SPACING}em; text-transform: uppercase; color: ${LABEL_META_TEXT_COLOR};">
              ISO ${iso}
            </p>
            <p style="margin: ${LABEL_MARGIN_PAIR}px 0 0; font-size: ${LABEL_DETAIL_SIZE}px; color: ${LABEL_DETAIL_TEXT_COLOR};">
              External coverage: ${coverageCount}
            </p>
            <p style="margin: ${LABEL_MARGIN_SINGLE}px 0 0; font-size: ${LABEL_DETAIL_SIZE}px; color: ${LABEL_DETAIL_TEXT_COLOR};">
              Local outlets: ${originCount}
            </p>
          </div>
        `
 },

 computeCapColor = (feature: Readonly<CountryFeature>, heat: Readonly<PolygonHeat>, maxSourceCount: number, maxMentionCount: number, hoverD: Readonly<CountryFeature> | null, selectedCountry: string | null): string => {
  if (feature === hoverD) {
    if (heat.sourceCount > ZERO_COUNT) { return hoverHeatColor(heat.sourceCount, maxSourceCount) }
    return externalHoverHeatColor(heat.mentionCount, maxMentionCount)
  }
  if (selectedCountry === heat.iso) { return CAP_SELECTED_COLOR }
  if (heat.sourceCount > ZERO_COUNT) { return heatColor(heat.sourceCount, maxSourceCount) }
  return externalHeatColor(heat.mentionCount, maxMentionCount)
 },

 computePolygonAltitude = (feature: Readonly<CountryFeature>, heat: Readonly<PolygonHeat>, hoverD: Readonly<CountryFeature> | null, selectedCountry: string | null): number => {
  if (feature === hoverD) { return HOVER_ALTITUDE_BASE + heat.ratio * HOVER_ALTITUDE_STEP }
  if (selectedCountry === heat.iso) { return SELECTED_ALTITUDE_BASE + heat.ratio * SELECTED_ALTITUDE_STEP }
  if (heat.sourceCount > ZERO_COUNT) { return SOURCE_ALTITUDE_BASE + heat.ratio * SOURCE_ALTITUDE_STEP }
  return EXTERNAL_ALTITUDE_BASE + heat.ratio * EXTERNAL_ALTITUDE_STEP
 },

 computeSideColor = (feature: Readonly<CountryFeature>, heat: Readonly<PolygonHeat>, hoverD: Readonly<CountryFeature> | null, selectedCountry: string | null): string => {
  if (feature === hoverD) {
    if (heat.sourceCount > ZERO_COUNT) { return SIDE_HOVER_SOURCE_COLOR }
    return SIDE_HOVER_EXTERNAL_COLOR
  }
  if (selectedCountry === heat.iso) { return SIDE_SELECTED_COLOR }
  if (heat.sourceCount > ZERO_COUNT) { return sourceSideColor(heat.ratio) }
  return externalSideColor(heat.ratio)
 },

 computeStrokeColor = (feature: Readonly<CountryFeature>, heat: Readonly<PolygonHeat>, hoverD: Readonly<CountryFeature> | null, selectedCountry: string | null): string => {
  if (feature === hoverD) {
    if (heat.sourceCount > ZERO_COUNT) { return STROKE_HOVER_SOURCE_COLOR }
    return STROKE_HOVER_EXTERNAL_COLOR
  }
  if (selectedCountry === heat.iso) { return STROKE_SELECTED_COLOR }
  if (heat.sourceCount > ZERO_COUNT) { return sourceStrokeColor(heat.ratio) }
  return externalStrokeColor(heat.ratio)
 },

 configureTexture = (texture: Texture, options: Readonly<{ anisotropy: number; color?: boolean }>): void => {
  texture.anisotropy = options.anisotropy
  texture.colorSpace = options.color ? SRGBColorSpace : NoColorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.wrapS = RepeatWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.generateMipmaps = true
  texture.needsUpdate = true
 },

 countOrZero = (counts: Readonly<Record<string, number>>, iso: string | null): number => {
  if (iso === null) { return ZERO_COUNT }
  return counts[iso] ?? ZERO_COUNT
 },

 createCloudsMaterial = (uniforms: GlobeUniforms, cloudTexture: Texture): ShaderMaterial => new ShaderMaterial({
  blending: NormalBlending,
  depthWrite: false,
  fragmentShader: CLOUD_FRAGMENT_SHADER,
  uniforms: {
    uCloudOffset: uniforms.uCloudOffset,
    uCloudTexture: { value: cloudTexture },
    uLightingMode: uniforms.uLightingMode,
    uSunDirection: uniforms.uSunDirection,
  },
  vertexShader: EARTH_VERTEX_SHADER,
 }),

 createGlobeMaterial = (): GlobeMaterialSetup => {
  const placeholderDay = createPlaceholderTexture(PLACEHOLDER_DAY_COLOR, { color: true }),
   placeholderNight = createPlaceholderTexture(NIGHT_PLACEHOLDER_COLOR, {}),
   placeholderBump = createPlaceholderTexture(BUMP_PLACEHOLDER_COLOR, {}),
   placeholderMask = createPlaceholderTexture(MASK_PLACEHOLDER_COLOR, {}),
   placeholderClouds = createPlaceholderTexture(CLOUD_PLACEHOLDER_COLOR, {}),
   uniforms: GlobeUniforms = {
   uBumpTexture: { value: placeholderBump },
   uCloudOffset: { value: ZERO_COUNT },
   uCloudTexture: { value: placeholderClouds },
   uDayTexture: { value: placeholderDay },
   uLightingMode: { value: ZERO_COUNT },
   uNightTexture: { value: placeholderNight },
   uSunDirection: { value: SUN_LIGHT_DIRECTION },
   uSurfaceMask: { value: placeholderMask },
   uTime: { value: ZERO_COUNT },
   },
   material = new ShaderMaterial({
    fragmentShader: EARTH_FRAGMENT_SHADER,
    uniforms,
    vertexShader: EARTH_VERTEX_SHADER,
   })
  return {
    material,
    placeholderTextures: [placeholderDay, placeholderNight, placeholderBump, placeholderMask, placeholderClouds],
    uniforms,
  }
 },

 createPlaceholderTexture = (color: Readonly<readonly [number, number, number, number]>, options: Readonly<{ color?: boolean }>): Texture => {
  const texture = new DataTexture(new Uint8Array(color), PLACEHOLDER_TEXTURE_WIDTH, PLACEHOLDER_TEXTURE_HEIGHT, RGBAFormat)
  configureTexture(texture, { anisotropy: 1, color: options.color })
  return texture
 },

 createSceneLights = (sunDirection: Vector3): readonly Light[] => {
  const ambientLight = new AmbientLight(0x15_21_31, 0.16),
   hemisphereLight = new HemisphereLight(0x32_5D_87, 0x04_07_0D, 0.14),
   sunLight = new DirectionalLight(0xFF_F4_DB, 2.4)
  sunLight.position.copy(sunDirection).multiplyScalar(EARTH_RADIUS * SUN_LIGHT_DISTANCE_FACTOR)
  return [ambientLight, hemisphereLight, sunLight]
 },

 createStarField = (count: number, spread: number): Points<BufferGeometry, PointsMaterial> => {
  const positions = new Float32Array(count * 3),
   colors = new Float32Array(count * 3)

  for (let index = 0; index < count; index += 1) {
    const cursor = index * 3,
     brightness = 0.55 + Math.random() * 0.4,
     warmth = Math.random() * 0.08
    positions[cursor] = (Math.random() - 0.5) * spread
    positions[cursor + 1] = (Math.random() - 0.5) * spread
    positions[cursor + 2] = (Math.random() - 0.5) * spread

    colors[cursor] = brightness
    colors[cursor + 1] = brightness - warmth * 0.5
    colors[cursor + 2] = brightness + warmth
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(positions, 3))
  geometry.setAttribute("color", new BufferAttribute(colors, 3))

  const material = new PointsMaterial({
    depthWrite: false,
    opacity: 0.72,
    size: 1.15,
    sizeAttenuation: true,
    transparent: true,
    vertexColors: true,
  })

  return new Points(geometry, material)
 },

 externalHeatColor = (count: number, maxCount: number): string => {
  if (count <= ZERO_COUNT || maxCount <= ZERO_COUNT) { return TRANSPARENT_RGBA }
  const ratio = sourceHeatRatio(count, maxCount),
   red = Math.round(EXTERNAL_CAP_RED_BASE + ratio * EXTERNAL_CAP_RED_STEP),
   green = Math.round(EXTERNAL_CAP_GREEN_BASE + ratio * EXTERNAL_CAP_GREEN_STEP),
   blue = Math.round(EXTERNAL_CAP_BLUE_BASE + ratio * EXTERNAL_CAP_BLUE_STEP),
   alpha = EXTERNAL_CAP_ALPHA_BASE + ratio * EXTERNAL_CAP_ALPHA_STEP
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(COLOR_PRECISION)})`
 },

 externalHoverHeatColor = (count: number, maxCount: number): string => {
  const ratio = hoverRatio(count, maxCount),
   red = Math.round(EXTERNAL_HOVER_RED_BASE + ratio * EXTERNAL_HOVER_RED_STEP),
   green = Math.round(EXTERNAL_HOVER_GREEN_BASE + ratio * EXTERNAL_HOVER_GREEN_STEP),
   blue = Math.round(EXTERNAL_HOVER_BLUE_BASE + ratio * EXTERNAL_HOVER_BLUE_STEP),
   alpha = EXTERNAL_HOVER_ALPHA_BASE + ratio * EXTERNAL_HOVER_ALPHA_STEP
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(COLOR_PRECISION)})`
 },

 externalSideColor = (ratio: number): string => {
  const [red, green, blue] = EXTERNAL_SIDE_RGB,
   alpha = SIDE_ALPHA_BASE + ratio * EXTERNAL_SIDE_ALPHA_STEP
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(COLOR_PRECISION)})`
 },

 externalStrokeColor = (ratio: number): string => {
  const [red, green, blue] = EXTERNAL_STROKE_RGB,
   alpha = STROKE_ALPHA_BASE + ratio * EXTERNAL_STROKE_ALPHA_STEP
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(COLOR_PRECISION)})`
 },

 findGlobeAnchor = (scene: Scene): Object3D => {
  const globeObject = scene.children.find((child) => (child as Object3D & { __globeObjType?: string }).__globeObjType === "globe")
  return globeObject ?? scene
 },

 getFeatureCenter = (geometry: Readonly<{ coordinates?: unknown }> | null | undefined): CountryCenter | undefined => {
  const coordinates = geometry?.coordinates
  if (!Array.isArray(coordinates)) { return undefined }
  const coords: [number, number][] = [],
   collect = (input: readonly unknown[]): void => {
    if (isCoordinatePair(input)) {
      const [lng, lat] = input
      coords.push([lng, lat])
      return
    }
    input.forEach((entry) => {
      if (isUnknownArray(entry)) { collect(entry) }
    })
   }
  collect(coordinates)
  if (coords.length === ZERO_COUNT) { return undefined }

  const [firstLng, firstLat] = coords[0] ?? [ZERO_COUNT, ZERO_COUNT],
   minLng = Math.min(...coords.map(([lng]) => lng)),
   maxLng = Math.max(...coords.map(([lng]) => lng)),
   minLat = Math.min(...coords.map(([, lat]) => lat)),
   maxLat = Math.max(...coords.map(([, lat]) => lat))
  void firstLng
  void firstLat
  return {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
  }
 },

 getQualityTier = (width: number, height: number): QualityTier => {
  if (globalThis.window === undefined) { return HIGHER_QUALITY_TIER }

  const minSide = Math.min(width || ZERO_COUNT, height || ZERO_COUNT),
   dpr = globalThis.devicePixelRatio || DEFAULT_PIXEL_RATIO

  if (minSide < GLOBE_MIN_SIDE_LOW || dpr >= DPR_HIGH_CUTOFF) { return LOWER_QUALITY_TIER }
  if (minSide < GLOBE_MIN_SIDE_HIGH || dpr >= DPR_MEDIUM_CUTOFF) { return MIDDLE_QUALITY_TIER }
  return HIGHER_QUALITY_TIER
 },

 heatColor = (count: number, maxCount: number): string => {
  if (count <= ZERO_COUNT || maxCount <= ZERO_COUNT) { return TRANSPARENT_RGBA }
  const ratio = sourceHeatRatio(count, maxCount),
   red = Math.round(HEAT_RED_BASE + ratio * HEAT_RED_STEP),
   green = Math.round(HEAT_GREEN_BASE - ratio * HEAT_GREEN_STEP),
   blue = Math.round(HEAT_BLUE_BASE - ratio * HEAT_BLUE_STEP),
   alpha = HEAT_ALPHA_BASE + ratio * HEAT_ALPHA_STEP
  return `rgba(${red}, ${green}, ${Math.max(HEAT_BLUE_FLOOR, blue)}, ${alpha.toFixed(COLOR_PRECISION)})`
 },

 heatRatioFor = (sourceCount: number, mentionCount: number, maxSourceCount: number, maxMentionCount: number): number => {
  if (sourceCount > ZERO_COUNT) { return sourceHeatRatio(sourceCount, maxSourceCount) }
  return sourceHeatRatio(mentionCount, maxMentionCount)
 },

 hoverHeatColor = (count: number, maxCount: number): string => {
  const ratio = hoverRatio(count, maxCount),
   red = HOVER_RED_BASE,
   green = Math.round(HOVER_GREEN_BASE - ratio * HOVER_GREEN_STEP),
   blue = Math.round(HOVER_BLUE_BASE - ratio * HOVER_BLUE_STEP),
   alpha = HOVER_ALPHA_BASE + ratio * HOVER_ALPHA_STEP
  return `rgba(${red}, ${green}, ${Math.max(HOVER_BLUE_FLOOR, blue)}, ${alpha.toFixed(COLOR_PRECISION)})`
 },

 hoverRatio = (count: number, maxCount: number): number => {
  if (maxCount > ZERO_COUNT) { return Math.min(FULL_RATIO, count / maxCount) }
  return ZERO_COUNT
 },

 isCoordinatePair = (value: Readonly<unknown>): value is readonly [number, number] => {
  const [first, second] = value as readonly [unknown, unknown]
  return typeof first === "number" && typeof second === "number"
 },

 isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value),

 loadManagedTexture = async (textureLoader: TextureLoader, path: string, options: Readonly<{ anisotropy: number; color?: boolean; maxTextureSize: number }>): Promise<Texture> => {
  let texture = await textureLoader.loadAsync(path)
  const sourceImage: unknown = texture.image

  if (sourceImage instanceof HTMLImageElement || sourceImage instanceof HTMLCanvasElement || sourceImage instanceof ImageBitmap) {
    const {width} = sourceImage,
     {height} = sourceImage
    if (width > options.maxTextureSize || height > options.maxTextureSize) {
      const scale = Math.min(options.maxTextureSize / width, options.maxTextureSize / height),
       canvas = document.createElement("canvas")
      canvas.width = Math.max(MIN_TEXTURE_EDGE, Math.floor(width * scale))
      canvas.height = Math.max(MIN_TEXTURE_EDGE, Math.floor(height * scale))

      const context = canvas.getContext("2d")
      if (context) {
        context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height)
        texture.dispose()
        texture = new CanvasTexture(canvas)
      }
    }
  }

  configureTexture(texture, { anisotropy: options.anisotropy, color: options.color })
  return texture
 },

 normalizeCountryKey = (value: string): string => value.trim().toLowerCase(),

 polygonHeat = (feature: Readonly<CountryFeature>, displayCounts: Readonly<Record<string, number>>, mentionCounts: Readonly<Record<string, number>>, maxSourceCount: number, maxMentionCount: number): PolygonHeat => {
  const iso = getCountryIso(feature),
   sourceCount = countOrZero(displayCounts, iso),
   mentionCount = countOrZero(mentionCounts, iso),
   ratio = heatRatioFor(sourceCount, mentionCount, maxSourceCount, maxMentionCount)
  return { iso, mentionCount, ratio, sourceCount }
 },

 remapCountryCounts = (counts: Readonly<Record<string, number>>, visibleCountries: readonly Readonly<CountryFeature>[]): Record<string, number> => {
  const nameToIso = new Map<string, string>(),
   isoSet = new Set<string>()

  visibleCountries.forEach((feature) => {
    const iso = getCountryIso(feature),
     countryName = typeof feature.properties.NAME === "string" ? feature.properties.NAME : null
    if (iso === null) { return }
    isoSet.add(iso)
    if (countryName !== null) {
      nameToIso.set(normalizeCountryKey(countryName), iso)
    }
  })

  const remappedCounts: Record<string, number> = {}
  Object.entries(counts).forEach(([key, count]) => {
    const normalizedKey = key.trim().toUpperCase(),
     iso = isoSet.has(normalizedKey) ? normalizedKey : nameToIso.get(normalizeCountryKey(key))
    if (iso === undefined) { return }
    remappedCounts[iso] = (remappedCounts[iso] ?? ZERO_COUNT) + count
  })

  return remappedCounts
 },

 setLightingModeUniform = (uniforms: GlobeUniforms, lightingMode: EarthLightingMode): void => {
  uniforms.uLightingMode.value = lightingMode === "day-night" ? LIGHTING_MODE_DAY_NIGHT : LIGHTING_MODE_ALL_LIT
 },

 sourceHeatRatio = (count: number, maxCount: number): number => {
  if (count <= ZERO_COUNT || maxCount <= ZERO_COUNT) { return ZERO_COUNT }
  return Math.min(FULL_RATIO, count / maxCount)
 },

 sourceSideColor = (ratio: number): string => {
  const [red, green, blue] = SOURCE_SIDE_RGB,
   alpha = SIDE_ALPHA_BASE + ratio * SOURCE_SIDE_ALPHA_STEP
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(COLOR_PRECISION)})`
 },

 sourceStrokeColor = (ratio: number): string => {
  const [red, green, blue] = SOURCE_STROKE_RGB,
   alpha = STROKE_ALPHA_BASE + ratio * SOURCE_STROKE_ALPHA_STEP
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(COLOR_PRECISION)})`
 },

 toCountryFeature = (polygon: object | null): CountryFeature | null => {
  if (polygon === null) { return null }
  const parsed = CountryFeatureSchema.safeParse(polygon)
  return parsed.success ? parsed.data : null
 },

 updateAnimationUniforms = (uniforms: GlobeUniforms, elapsed: number): void => {
  uniforms.uTime.value = elapsed
  uniforms.uCloudOffset.value = (elapsed * CLOUD_DRIFT_SPEED) % FULL_RATIO
 },

 CLOUD_DRIFT_SPEED = 0.0032,
 LIGHTING_MODE_ALL_LIT = 0,
 LIGHTING_MODE_DAY_NIGHT = 1,
 MASK_PLACEHOLDER_COLOR = [0, 0, 0, 255] as const,
 STAR_BRIGHTNESS_BASE = 0.55,
 STAR_BRIGHTNESS_SPREAD = 0.4,
 STAR_FIELD_COUNT_FACTOR = 3,
 STAR_OPACITY = 0.72,
 STAR_SIZE = 1.15,
 STAR_VERTEX_STRIDE = 3,
 STAR_WARMTH_RANGE = 0.08,
 STAR_WARMTH_SHIFT = 0.5

export const InteractiveGlobe = ({
  articles,
  countryMetrics,
  globeComponent: GlobeComponent = Globe,
  onCountrySelect,
  selectedCountry,
  lightingMode,
}: InteractiveGlobeProps) => {
  const containerRef = useRef<HTMLDivElement>(null),
   [dimensions, setDimensions] = useState({ height: ZERO_COUNT, width: ZERO_COUNT }),
   [hoverD, setHoverD] = useState<CountryFeature | null>(null),
   [globeInstance, setGlobeInstance] = useState<GlobeMethods | null>(null),
   globeRef = useMemo<MutableRefObject<GlobeMethods | undefined>>(() => {
    let current: GlobeMethods | undefined

    return {
      get current() {
        return current
      },
      set current(instance: GlobeMethods | undefined) {
        current = instance
        setGlobeInstance(instance ?? null)
      },
    }
  }, []),
   qualityTier = useMemo(() => getQualityTier(dimensions.width, dimensions.height), [dimensions.height, dimensions.width]),
   countriesQuery = useQuery<CountryFeatureCollection>({
    gcTime: Infinity,
    queryFn: async () => {
      const response = await fetch(LOCAL_COUNTRY_GEOJSON_URL),
       parsed = CountryCollectionSchema.safeParse(await response.json())
      return parsed.success ? parsed.data : EMPTY_COUNTRY_COLLECTION
    },
    queryKey: ["globe-countries"],
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: Infinity,
   }),
   countries = countriesQuery.data ?? EMPTY_COUNTRY_COLLECTION,
   visibleCountries = useMemo(
    () => countries.features.filter((feature) => Boolean(feature) && getCountryIso(feature) !== ANTLARCTICA_USER_ISO),
    [countries.features],
   ),
   globeSetup = useMemo(() => createGlobeMaterial(), []),
   customGlobeMaterial = globeSetup.material,
   globeUniforms = globeSetup.uniforms

  useEffect(() => {
    setLightingModeUniform(globeUniforms, lightingMode)
  }, [globeUniforms, lightingMode])

  const fallbackSourceCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    articles.forEach((article) => {
      const sourceCountry = article.source_country || article.country
      if (!sourceCountry || sourceCountry === "International") { return }
      counts[sourceCountry] = (counts[sourceCountry] ?? ZERO_COUNT) + 1
    })
    return counts
  }, [articles]),

   sourceOriginCounts =
    countryMetrics?.source_counts && Object.keys(countryMetrics.source_counts).length > ZERO_COUNT
      ? countryMetrics.source_counts
      : fallbackSourceCounts,
   displayCounts = useMemo(
    () => remapCountryCounts(sourceOriginCounts, visibleCountries),
    [sourceOriginCounts, visibleCountries],
  ),
   mentionCounts = useMemo(
    () => remapCountryCounts(countryMetrics?.counts ?? {}, visibleCountries),
    [countryMetrics?.counts, visibleCountries],
  ),
   maxCount = useMemo(() => maxValue(displayCounts), [displayCounts]),
   maxMentionCount = useMemo(() => maxValue(mentionCounts), [mentionCounts]),
   countryCenters = useMemo(() => {
    const centers: Record<string, CountryCenter> = {}
    countries.features.forEach((feature) => {
      const iso = getCountryIso(feature)
      if (iso === null) { return }
      const center = getFeatureCenter(feature.geometry)
      if (center) {
        centers[iso] = center
      }
    })
    return centers
  }, [countries])

  useEffect(() => {
    if (globeInstance === null) { return }
    const controls = globeInstance.controls()
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.5
    controls.enableZoom = false
    controls.enablePan = false
    globeInstance.pointOfView({
      altitude: globalThis.innerWidth < 1024 ? MOBILE_OVERVIEW_ALTITUDE : DESKTOP_OVERVIEW_ALTITUDE,
    })
  }, [globeInstance])

  useEffect(() => {
    if (globeInstance === null) { return }
    const controls = globeInstance.controls(),
     overviewAltitude = globalThis.innerWidth < 1024 ? MOBILE_OVERVIEW_ALTITUDE : DESKTOP_OVERVIEW_ALTITUDE
    if (selectedCountry === null) {
      controls.autoRotate = true
      globeInstance.pointOfView({ altitude: overviewAltitude }, FOCUS_TRANSITION_MS)
      return
    }

    const center = countryCenters[selectedCountry]
    controls.autoRotate = false
    if (center) {
      const isMobile = globalThis.innerWidth < 1024
      globeInstance.pointOfView(
        { altitude: isMobile ? MOBILE_FOCUS_ALTITUDE : DESKTOP_FOCUS_ALTITUDE, lat: center.lat, lng: center.lng },
        FOCUS_TRANSITION_MS,
      )
    }
  }, [countryCenters, globeInstance, selectedCountry])

  useEffect(() => {
    if (containerRef.current === null) { return }
    const element = containerRef.current,
     updateSize = (): void => {
      const rect = element.getBoundingClientRect()
      setDimensions({
        height: Math.max(ZERO_COUNT, Math.floor(rect.height)),
        width: Math.max(ZERO_COUNT, Math.floor(rect.width)),
      })
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (globeInstance === null) { return }
    const renderer = globeInstance.renderer()
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio, qualityTier.pixelRatioCap))
  }, [globeInstance, qualityTier.pixelRatioCap])

  useEffect(() => {
    if (globeInstance === null) { return }
    const globe = globeInstance,
     renderer = globe.renderer(),
     scene = globe.scene(),
     sunDirection = globeUniforms.uSunDirection.value,
     globeRadius = globe.getGlobeRadius(),
     setupQualityTier = getQualityTier(
      containerRef.current?.clientWidth ?? globalThis.innerWidth,
      containerRef.current?.clientHeight ?? globalThis.innerHeight,
     ),
     ambientLight = new AmbientLight(0x15_21_31, 0.16),
     hemisphereLight = new HemisphereLight(0x32_5D_87, 0x04_07_0D, 0.14),
     sunLight = new DirectionalLight(0xFF_F4_DB, 2.4)
    sunLight.position.copy(sunDirection).multiplyScalar(EARTH_RADIUS * SUN_LIGHT_DISTANCE_FACTOR)

    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05

    const globeAnchor = findGlobeAnchor(scene),
     sceneObjects: Object3D[] = [],
     sceneMaterials: Material[] = [],
     sceneTextures: Texture[] = [],
     textureLoader = new TextureLoader(),
     clock = new Clock(),
     starField = createStarField(setupQualityTier.starCount, globeRadius * STAR_FIELD_SPREAD_FACTOR)

    scene.add(ambientLight)
    scene.add(hemisphereLight)
    scene.add(sunLight)
    starField.renderOrder = -20
    scene.add(starField)
    sceneObjects.push(starField)
    sceneMaterials.push(starField.material)

    const bindEarthTextures = async () => {
      try {
        const maxTextureSize = Math.min(renderer.capabilities.maxTextureSize || setupQualityTier.maxTextureSize, setupQualityTier.maxTextureSize),
         anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), setupQualityTier.anisotropyCap),
         [dayTexture, bumpTexture, nightTexture, surfaceMaskTexture, cloudTexture] = await Promise.all([
          loadManagedTexture(textureLoader, OPTIMIZED_TEXTURES.day, { anisotropy, color: true, maxTextureSize }),
          loadManagedTexture(textureLoader, OPTIMIZED_TEXTURES.bump, { anisotropy, maxTextureSize }),
          loadManagedTexture(textureLoader, OPTIMIZED_TEXTURES.night, { anisotropy, maxTextureSize }),
          loadManagedTexture(textureLoader, OPTIMIZED_TEXTURES.surfaceMask, { anisotropy, maxTextureSize }),
          loadManagedTexture(textureLoader, OPTIMIZED_TEXTURES.clouds, { anisotropy, maxTextureSize }),
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

        applyGlobeTextures(globeUniforms, {
          bumpTexture,
          cloudTexture,
          dayTexture,
          nightTexture,
          surfaceMaskTexture,
        })

        const cloudsMaterial = createCloudsMaterial(globeUniforms, cloudTexture),
         cloudsMesh = new Mesh(
          new SphereGeometry(globeRadius * CLOUD_RADIUS_FACTOR, setupQualityTier.sphereSegments, setupQualityTier.sphereSegments),
          cloudsMaterial,
        )
        cloudsMesh.rotation.y = GLOBE_TEXTURE_ROTATION_Y
        cloudsMesh.renderOrder = -1
        globeAnchor.add(cloudsMesh)
        sceneObjects.push(cloudsMesh)
        sceneMaterials.push(cloudsMaterial)

        const atmosphereMaterial = new ShaderMaterial({
          blending: AdditiveBlending,
          depthWrite: false,
          fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
          side: BackSide,
          transparent: true,
          uniforms: {
            uLightingMode: globeUniforms.uLightingMode,
            uSunDirection: globeUniforms.uSunDirection,
          },
          vertexShader: EARTH_VERTEX_SHADER,
        }),
         atmosphereMesh = new Mesh(
          new SphereGeometry(globeRadius * ATMOSPHERE_RADIUS_FACTOR, setupQualityTier.sphereSegments, setupQualityTier.sphereSegments),
          atmosphereMaterial,
        )
        atmosphereMesh.renderOrder = 1
        globeAnchor.add(atmosphereMesh)
        sceneObjects.push(atmosphereMesh)
        sceneMaterials.push(atmosphereMaterial)
      } catch {
        // Keep the globe usable even if shader textures fail.
      }
    }

    let disposed = false
    bindEarthTextures()

    let animationFrameId = 0
    const animate = (): void => {
      if (disposed) { return }
      const elapsed = clock.getElapsedTime()
      updateAnimationUniforms(globeUniforms, elapsed)
      animationFrameId = requestAnimationFrame(animate)
    },
     startAnimation = (): void => {
      if (!animationFrameId && !disposed) {
        animationFrameId = requestAnimationFrame(animate)
      }
    },
     stopAnimation = (): void => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
        animationFrameId = 0
      }
    },
     handleVisibilityChange = (): void => {
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
        disposeSceneObject(object)
      })

      globeSetup.placeholderTextures.forEach((texture) => {
        restorePlaceholderGlobeTextures(globeUniforms)
        void texture
      })

      sceneMaterials.forEach((material) => {
        material.dispose()
      })
      sceneTextures.forEach((texture) => {
        texture.dispose()
      })
    }
  }, [globeInstance, globeSetup])

  useEffect(
    () => () => {
      globeSetup.placeholderTextures.forEach((texture) => {
        texture.dispose()
      })
      customGlobeMaterial.dispose()
    },
    [customGlobeMaterial, globeSetup],
  )

  const polygonStyleContext = useMemo<Readonly<{ displayCounts: Record<string, number>; maxCount: number; maxMentionCount: number; mentionCounts: Record<string, number> }>>(
    () => ({ displayCounts, maxCount, maxMentionCount, mentionCounts }),
    [displayCounts, maxCount, maxMentionCount, mentionCounts],
  ),

   handlePolygonHover = useMemo(
    () => (polygon: object | null): void => {
      setHoverD(toCountryFeature(polygon))
    },
    [],
  ),

   handlePolygonClick = useMemo(
    () => (polygon: object): void => {
      const feature = toCountryFeature(polygon)
      if (feature === null) { return }
      const iso = getCountryIso(feature)
      if (iso === null) { return }
      const countryName = feature.properties.NAME
      if (selectedCountry === iso) {
        onCountrySelect(null, null)
        globeInstance?.pointOfView(
          { altitude: globalThis.innerWidth < MOBILE_BREAKPOINT ? MOBILE_OVERVIEW_ALTITUDE : DESKTOP_DESELECT_ALTITUDE },
          FOCUS_TRANSITION_MS,
        )
        return
      }

      onCountrySelect(iso, countryName)
      // Zoom with a slight latitude offset so the country is not hidden behind the bottom UI drawer.
      const centroid = geoCentroid(feature),
       [lng, lat] = centroid,
       isMobile = globalThis.innerWidth < MOBILE_BREAKPOINT,
       latOffset = isMobile ? MOBILE_LAT_OFFSET : DESKTOP_LAT_OFFSET,
       zoomAltitude = isMobile ? MOBILE_CLICK_ALTITUDE : DESKTOP_CLICK_ALTITUDE
      globeInstance?.pointOfView({ altitude: zoomAltitude, lat: lat + latOffset, lng }, FOCUS_TRANSITION_MS)
    },
    [globeInstance, onCountrySelect, selectedCountry],
  ),

   polygonAltitude = useMemo(
    () => (polygon: object): number => {
      const feature = toCountryFeature(polygon)
      if (feature === null) { return DEFAULT_POLYGON_ALTITUDE }
      const heat = polygonStyleContext && computePolygonHeatFast(feature, polygonStyleContext)
      if (heat === null) { return DEFAULT_POLYGON_ALTITUDE }
      return computePolygonAltitude(feature, heat, hoverD, selectedCountry)
    },
    [hoverD, polygonStyleContext, selectedCountry],
  ),

   polygonCapColor = useMemo(
    () => (polygon: object): string => {
      const feature = toCountryFeature(polygon)
      if (feature === null) { return CAP_DEFAULT_COLOR }
      const heat = polygonStyleContext && computePolygonHeatFast(feature, polygonStyleContext)
      if (heat === null) { return CAP_DEFAULT_COLOR }
      return computeCapColor(feature, heat, polygonStyleContext.maxCount, polygonStyleContext.maxMentionCount, hoverD, selectedCountry)
    },
    [hoverD, polygonStyleContext, selectedCountry],
  ),

   polygonSideColor = useMemo(
    () => (polygon: object): string => {
      const feature = toCountryFeature(polygon)
      if (feature === null) { return SIDE_DEFAULT_COLOR }
      const heat = polygonStyleContext && computePolygonHeatFast(feature, polygonStyleContext)
      if (heat === null) { return SIDE_DEFAULT_COLOR }
      return computeSideColor(feature, heat, hoverD, selectedCountry)
    },
    [hoverD, polygonStyleContext, selectedCountry],
  ),

   polygonStrokeColor = useMemo(
    () => (polygon: object): string => {
      const feature = toCountryFeature(polygon)
      if (feature === null) { return STROKE_DEFAULT_COLOR }
      const heat = polygonStyleContext && computePolygonHeatFast(feature, polygonStyleContext)
      if (heat === null) { return STROKE_DEFAULT_COLOR }
      return computeStrokeColor(feature, heat, hoverD, selectedCountry)
    },
    [hoverD, polygonStyleContext, selectedCountry],
  ),

   polygonLabel = useMemo(
    () => (polygon: object): string => {
      const feature = toCountryFeature(polygon)
      if (feature === null) { return "" }
      const iso = getCountryIso(feature) ?? UNKNOWN_ISO_LABEL
      if (selectedCountry === iso) { return "" }
      return buildCountryLabel(feature, polygonStyleContext.displayCounts, polygonStyleContext.mentionCounts)
    },
    [polygonStyleContext, selectedCountry],
  )

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[var(--news-bg-primary)]">
      <GlobeComponent
        ref={globeRef}
        globeMaterial={customGlobeMaterial}
        backgroundImageUrl={undefined}
        backgroundColor="rgba(0,0,0,0)"
        showAtmosphere={false}
        atmosphereAltitude={0}
        polygonsTransitionDuration={0}
        lineHoverPrecision={0}
        polygonsData={visibleCountries}
        polygonAltitude={polygonAltitude}
        polygonCapColor={polygonCapColor}
        polygonSideColor={polygonSideColor}
        polygonStrokeColor={polygonStrokeColor}
        polygonLabel={polygonLabel}
        onPolygonHover={handlePolygonHover}
        onPolygonClick={handlePolygonClick}
        width={dimensions.width}
        height={dimensions.height}
      />
    </div>
  )
}

const computePolygonHeatFast = (polygon: Readonly<CountryFeature>, context: Readonly<{ displayCounts: Record<string, number>; maxCount: number; maxMentionCount: number; mentionCounts: Record<string, number> }>): PolygonHeat | null => {
  const feature = toCountryFeature(polygon)
  if (feature === null) { return null }
  return polygonHeat(feature, context.displayCounts, context.mentionCounts, context.maxCount, context.maxMentionCount)
},

 disposeSceneObject = (object: Object3D): void => {
  object.parent?.remove(object)
  if (object instanceof Mesh) {
    object.geometry.dispose()
    return
  }
  if (object instanceof Points) {
    object.geometry.dispose()
  }
},

 maxValue = (counts: Readonly<Record<string, number>>): number => {
  const values = Object.values(counts)
  if (values.length === ZERO_COUNT) { return ZERO_COUNT }
  return Math.max(...values)
},

 restorePlaceholderGlobeTextures = (uniforms: GlobeUniforms): void => {
  void uniforms
},

 countFeatures = (features: readonly CountryFeature[]): number => features.length
