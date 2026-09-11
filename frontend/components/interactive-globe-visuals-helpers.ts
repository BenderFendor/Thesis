import { getCountryIso } from "@/lib/globe-country";
import { z } from "zod";
import type { Object3D, Scene } from "three";
import type {
  EarthLightingMode,
  CountryCountMap,
  MutableCountryCountMap,
  CountryCenter,
  ReadonlyCountryFeature,
  GlobeUniforms,
  PolygonHeat,
  QualityTier,
  PolygonContext,
} from "./interactive-globe-visuals-types";
import {
  CAP_SELECTED_COLOR,
  COLOR_PRECISION,
  DEFAULT_PIXEL_RATIO,
  DPR_HIGH_CUTOFF,
  DPR_MEDIUM_CUTOFF,
  EXTERNAL_ALTITUDE_BASE,
  EXTERNAL_ALTITUDE_STEP,
  EXTERNAL_CAP_ALPHA_BASE,
  EXTERNAL_CAP_ALPHA_STEP,
  EXTERNAL_CAP_BLUE_BASE,
  EXTERNAL_CAP_BLUE_STEP,
  EXTERNAL_CAP_GREEN_BASE,
  EXTERNAL_CAP_GREEN_STEP,
  EXTERNAL_CAP_RED_BASE,
  EXTERNAL_CAP_RED_STEP,
  EXTERNAL_HOVER_ALPHA_BASE,
  EXTERNAL_HOVER_ALPHA_STEP,
  EXTERNAL_HOVER_BLUE_BASE,
  EXTERNAL_HOVER_BLUE_STEP,
  EXTERNAL_HOVER_GREEN_BASE,
  EXTERNAL_HOVER_GREEN_STEP,
  EXTERNAL_HOVER_RED_BASE,
  EXTERNAL_HOVER_RED_STEP,
  EXTERNAL_SIDE_ALPHA_STEP,
  EXTERNAL_SIDE_RGB,
  EXTERNAL_STROKE_ALPHA_STEP,
  EXTERNAL_STROKE_RGB,
  FULL_RATIO,
  GLOBE_MIN_SIDE_HIGH,
  GLOBE_MIN_SIDE_LOW,
  HEAT_ALPHA_BASE,
  HEAT_ALPHA_STEP,
  HEAT_BLUE_BASE,
  HEAT_BLUE_FLOOR,
  HEAT_BLUE_STEP,
  HEAT_GREEN_BASE,
  HEAT_GREEN_STEP,
  HEAT_RED_BASE,
  HEAT_RED_STEP,
  HIGHER_QUALITY_TIER,
  HOVER_ALPHA_BASE,
  HOVER_ALPHA_STEP,
  HOVER_ALTITUDE_BASE,
  HOVER_ALTITUDE_STEP,
  HOVER_BLUE_BASE,
  HOVER_BLUE_FLOOR,
  HOVER_BLUE_STEP,
  HOVER_GREEN_BASE,
  HOVER_GREEN_STEP,
  HOVER_RED_BASE,
  LABEL_BACKGROUND_RGB,
  LABEL_BORDER_ALPHA,
  LABEL_BORDER_WIDTH,
  LABEL_BOX_SHADOW_OPACITY,
  LABEL_BOX_SHADOW_SIZE,
  LABEL_BOX_SHADOW_VERTICAL,
  LABEL_DETAIL_SIZE,
  LABEL_DETAIL_TEXT_COLOR,
  LABEL_LETTER_SPACING,
  LABEL_MARGIN_PAIR,
  LABEL_MARGIN_SINGLE,
  LABEL_META_SIZE,
  LABEL_META_TEXT_COLOR,
  LABEL_MIN_WIDTH,
  LABEL_PADDING,
  LABEL_TEXT_COLOR,
  LABEL_TITLE_COLOR,
  LABEL_TITLE_SIZE,
  LOWER_QUALITY_TIER,
  MIDDLE_QUALITY_TIER,
  SELECTED_ALTITUDE_BASE,
  SELECTED_ALTITUDE_STEP,
  SIDE_ALPHA_BASE,
  SIDE_HOVER_EXTERNAL_COLOR,
  SIDE_HOVER_SOURCE_COLOR,
  SIDE_SELECTED_COLOR,
  SOURCE_ALTITUDE_BASE,
  SOURCE_ALTITUDE_STEP,
  SOURCE_SIDE_ALPHA_STEP,
  SOURCE_SIDE_RGB,
  SOURCE_STROKE_ALPHA_STEP,
  SOURCE_STROKE_RGB,
  STROKE_ALPHA_BASE,
  STROKE_HOVER_EXTERNAL_COLOR,
  STROKE_HOVER_SOURCE_COLOR,
  STROKE_SELECTED_COLOR,
  TRANSPARENT_RGBA,
  UNKNOWN_ISO_LABEL,
  ZERO_COUNT,
  CLOUD_DRIFT_SPEED,
  LIGHTING_MODE_ALL_LIT,
  LIGHTING_MODE_DAY_NIGHT,
} from "./interactive-globe-visuals-config";

const buildCountryLabel = (
  feature: ReadonlyCountryFeature,
  displayCounts: CountryCountMap,
  mentionCounts: CountryCountMap,
): string => {
  const iso = getCountryIso(feature) ?? UNKNOWN_ISO_LABEL;
  const originCount = displayCounts[iso] ?? ZERO_COUNT;
  const coverageCount = mentionCounts[iso] ?? ZERO_COUNT;
  const countryName = feature.properties.NAME;
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
        `;
};

const computeCapColor = (
  feature: ReadonlyCountryFeature,
  heat: Readonly<PolygonHeat>,
  limits: Readonly<Pick<PolygonContext, "maxCount" | "maxMentionCount">>,
  hoverD: ReadonlyCountryFeature | null,
  selectedCountry: string | null,
): string => {
  if (feature === hoverD) {
    if (heat.sourceCount > ZERO_COUNT) {
      return hoverHeatColor(heat.sourceCount, limits.maxCount);
    }
    return externalHoverHeatColor(heat.mentionCount, limits.maxMentionCount);
  }
  if (selectedCountry === heat.iso) {
    return CAP_SELECTED_COLOR;
  }
  if (heat.sourceCount > ZERO_COUNT) {
    return heatColor(heat.sourceCount, limits.maxCount);
  }
  return externalHeatColor(heat.mentionCount, limits.maxMentionCount);
};

const computePolygonAltitude = (
  feature: ReadonlyCountryFeature,
  heat: Readonly<PolygonHeat>,
  hoverD: ReadonlyCountryFeature | null,
  selectedCountry: string | null,
): number => {
  if (feature === hoverD) {
    return HOVER_ALTITUDE_BASE + heat.ratio * HOVER_ALTITUDE_STEP;
  }
  if (selectedCountry === heat.iso) {
    return SELECTED_ALTITUDE_BASE + heat.ratio * SELECTED_ALTITUDE_STEP;
  }
  if (heat.sourceCount > ZERO_COUNT) {
    return SOURCE_ALTITUDE_BASE + heat.ratio * SOURCE_ALTITUDE_STEP;
  }
  return EXTERNAL_ALTITUDE_BASE + heat.ratio * EXTERNAL_ALTITUDE_STEP;
};

const computeSideColor = (
  feature: ReadonlyCountryFeature,
  heat: Readonly<PolygonHeat>,
  hoverD: ReadonlyCountryFeature | null,
  selectedCountry: string | null,
): string => {
  if (feature === hoverD) {
    if (heat.sourceCount > ZERO_COUNT) {
      return SIDE_HOVER_SOURCE_COLOR;
    }
    return SIDE_HOVER_EXTERNAL_COLOR;
  }
  if (selectedCountry === heat.iso) {
    return SIDE_SELECTED_COLOR;
  }
  if (heat.sourceCount > ZERO_COUNT) {
    return sourceSideColor(heat.ratio);
  }
  return externalSideColor(heat.ratio);
};

const computeStrokeColor = (
  feature: ReadonlyCountryFeature,
  heat: Readonly<PolygonHeat>,
  hoverD: ReadonlyCountryFeature | null,
  selectedCountry: string | null,
): string => {
  if (feature === hoverD) {
    if (heat.sourceCount > ZERO_COUNT) {
      return STROKE_HOVER_SOURCE_COLOR;
    }
    return STROKE_HOVER_EXTERNAL_COLOR;
  }
  if (selectedCountry === heat.iso) {
    return STROKE_SELECTED_COLOR;
  }
  if (heat.sourceCount > ZERO_COUNT) {
    return sourceStrokeColor(heat.ratio);
  }
  return externalStrokeColor(heat.ratio);
};

const countOrZero = (counts: CountryCountMap, iso: string | null): number => {
  if (iso === null) {
    return ZERO_COUNT;
  }
  return counts[iso] ?? ZERO_COUNT;
};

const externalHeatColor = (count: number, maxCount: number): string => {
  if (count <= ZERO_COUNT || maxCount <= ZERO_COUNT) {
    return TRANSPARENT_RGBA;
  }
  const ratio = sourceHeatRatio(count, maxCount);
  const red = Math.round(EXTERNAL_CAP_RED_BASE + ratio * EXTERNAL_CAP_RED_STEP);
  const green = Math.round(EXTERNAL_CAP_GREEN_BASE + ratio * EXTERNAL_CAP_GREEN_STEP);
  const blue = Math.round(EXTERNAL_CAP_BLUE_BASE + ratio * EXTERNAL_CAP_BLUE_STEP);
  const alpha = EXTERNAL_CAP_ALPHA_BASE + ratio * EXTERNAL_CAP_ALPHA_STEP;
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(COLOR_PRECISION)})`;
};

const externalHoverHeatColor = (count: number, maxCount: number): string => {
  const ratio = hoverRatio(count, maxCount);
  const red = Math.round(EXTERNAL_HOVER_RED_BASE + ratio * EXTERNAL_HOVER_RED_STEP);
  const green = Math.round(EXTERNAL_HOVER_GREEN_BASE + ratio * EXTERNAL_HOVER_GREEN_STEP);
  const blue = Math.round(EXTERNAL_HOVER_BLUE_BASE + ratio * EXTERNAL_HOVER_BLUE_STEP);
  const alpha = EXTERNAL_HOVER_ALPHA_BASE + ratio * EXTERNAL_HOVER_ALPHA_STEP;
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(COLOR_PRECISION)})`;
};

const externalSideColor = (ratio: number): string => {
  const [red, green, blue] = EXTERNAL_SIDE_RGB;
  const alpha = SIDE_ALPHA_BASE + ratio * EXTERNAL_SIDE_ALPHA_STEP;
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(COLOR_PRECISION)})`;
};

const externalStrokeColor = (ratio: number): string => {
  const [red, green, blue] = EXTERNAL_STROKE_RGB;
  const alpha = STROKE_ALPHA_BASE + ratio * EXTERNAL_STROKE_ALPHA_STEP;
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(COLOR_PRECISION)})`;
};

const findGlobeAnchor = (scene: Scene): Object3D => {
  const globeObject = scene.children.find((child) => {
    const marker: unknown = Object.getOwnPropertyDescriptor(child, "__globeObjType")?.value;
    return z.string().safeParse(marker).data === "globe";
  });
  return globeObject ?? scene;
};

interface CoordinateBounds {
  readonly maxLat: number;
  readonly maxLng: number;
  readonly minLat: number;
  readonly minLng: number;
}

const getCoordinateBounds = (
  coordinates: readonly (readonly [number, number])[],
): CoordinateBounds => ({
  maxLat: Math.max(...coordinates.map(([, lat]) => lat)),
  maxLng: Math.max(...coordinates.map(([lng]) => lng)),
  minLat: Math.min(...coordinates.map(([, lat]) => lat)),
  minLng: Math.min(...coordinates.map(([lng]) => lng)),
});

const getFeatureCenter = (
  geometry: Readonly<{ coordinates?: unknown }> | null | undefined,
): CountryCenter | undefined => {
  const coordinates = geometry?.coordinates;
  if (!Array.isArray(coordinates)) {
    return void 0;
  }
  const collect = (input: readonly unknown[]): void => {
    if (isCoordinatePair(input)) {
      const [lng, lat] = input;
      coordinatesFound.push([lng, lat]);
      return;
    }
    input.forEach((entry) => {
      if (Array.isArray(entry)) {
        collect(entry);
      }
    });
  };
  const coordinatesFound: [number, number][] = [];
  collect(coordinates);
  if (coordinatesFound.length === ZERO_COUNT) {
    return void 0;
  }

  const bounds = getCoordinateBounds(coordinatesFound);
  return {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lng: (bounds.minLng + bounds.maxLng) / 2,
  };
};

const getQualityTier = (width: number, height: number): QualityTier => {
  if (globalThis.window === undefined) {
    return HIGHER_QUALITY_TIER;
  }

  const dpr = globalThis.devicePixelRatio || DEFAULT_PIXEL_RATIO,
    minSide = Math.min(width || ZERO_COUNT, height || ZERO_COUNT);

  if (minSide < GLOBE_MIN_SIDE_LOW || dpr >= DPR_HIGH_CUTOFF) {
    return LOWER_QUALITY_TIER;
  }
  if (minSide < GLOBE_MIN_SIDE_HIGH || dpr >= DPR_MEDIUM_CUTOFF) {
    return MIDDLE_QUALITY_TIER;
  }
  return HIGHER_QUALITY_TIER;
};

const heatColor = (count: number, maxCount: number): string => {
  if (count <= ZERO_COUNT || maxCount <= ZERO_COUNT) {
    return TRANSPARENT_RGBA;
  }
  const ratio = sourceHeatRatio(count, maxCount);
  const red = Math.round(HEAT_RED_BASE + ratio * HEAT_RED_STEP);
  const green = Math.round(HEAT_GREEN_BASE - ratio * HEAT_GREEN_STEP);
  const blue = Math.round(HEAT_BLUE_BASE - ratio * HEAT_BLUE_STEP);
  const alpha = HEAT_ALPHA_BASE + ratio * HEAT_ALPHA_STEP;
  return `rgba(${red}, ${green}, ${Math.max(HEAT_BLUE_FLOOR, blue)}, ${alpha.toFixed(COLOR_PRECISION)})`;
};

const heatRatioFor = (
  sourceCount: number,
  mentionCount: number,
  maxSourceCount: number,
  maxMentionCount: number,
): number => {
  if (sourceCount > ZERO_COUNT) {
    return sourceHeatRatio(sourceCount, maxSourceCount);
  }
  return sourceHeatRatio(mentionCount, maxMentionCount);
};

const hoverHeatColor = (count: number, maxCount: number): string => {
  const ratio = hoverRatio(count, maxCount);
  const red = HOVER_RED_BASE;
  const green = Math.round(HOVER_GREEN_BASE - ratio * HOVER_GREEN_STEP);
  const blue = Math.round(HOVER_BLUE_BASE - ratio * HOVER_BLUE_STEP);
  const alpha = HOVER_ALPHA_BASE + ratio * HOVER_ALPHA_STEP;
  return `rgba(${red}, ${green}, ${Math.max(HOVER_BLUE_FLOOR, blue)}, ${alpha.toFixed(COLOR_PRECISION)})`;
};

const hoverRatio = (count: number, maxCount: number): number => {
  if (maxCount > ZERO_COUNT) {
    return Math.min(FULL_RATIO, count / maxCount);
  }
  return ZERO_COUNT;
};

const isCoordinatePair = (value: readonly unknown[]): value is readonly [number, number] => {
  const [first, second] = value;
  return (
    value.length === 2 &&
    z.number().safeParse(first).success &&
    z.number().safeParse(second).success
  );
};

const normalizeCountryKey = (value: string): string => value.trim().toLowerCase();

const polygonHeat = (
  feature: ReadonlyCountryFeature,
  displayCounts: CountryCountMap,
  mentionCounts: CountryCountMap,
  maxSourceCount: number,
  maxMentionCount: number,
): PolygonHeat => {
  const iso = getCountryIso(feature);
  const sourceCount = countOrZero(displayCounts, iso);
  const mentionCount = countOrZero(mentionCounts, iso);
  const ratio = heatRatioFor(sourceCount, mentionCount, maxSourceCount, maxMentionCount);
  return { iso, mentionCount, ratio, sourceCount };
};

const remapCountryCounts = (
  counts: CountryCountMap,
  visibleCountries: readonly ReadonlyCountryFeature[],
) => {
  const isoSet = new Set<string>(),
    nameToIso = new Map<string, string>();

  visibleCountries.forEach((feature) => {
    const countryName = feature.properties.NAME ?? null,
      iso = getCountryIso(feature);
    if (iso === null) {
      return;
    }
    isoSet.add(iso);
    if (countryName !== null) {
      nameToIso.set(normalizeCountryKey(countryName), iso);
    }
  });

  const remappedCounts: MutableCountryCountMap = {};
  Object.entries(counts).forEach(([key, count]) => {
    const normalizedKey = key.trim().toUpperCase();
    if (isoSet.has(normalizedKey)) {
      remappedCounts[normalizedKey] = (remappedCounts[normalizedKey] ?? ZERO_COUNT) + count;
      return;
    }
    const nameIso = nameToIso.get(normalizeCountryKey(key));
    if (nameIso === undefined) {
      return;
    }
    remappedCounts[nameIso] = (remappedCounts[nameIso] ?? ZERO_COUNT) + count;
  });

  return remappedCounts satisfies CountryCountMap;
};

const setLightingModeUniform = (uniforms: GlobeUniforms, lightingMode: EarthLightingMode): void => {
  if (lightingMode === "day-night") {
    uniforms.uLightingMode.value = LIGHTING_MODE_DAY_NIGHT;
    return;
  }
  uniforms.uLightingMode.value = LIGHTING_MODE_ALL_LIT;
};

const sourceHeatRatio = (count: number, maxCount: number): number => {
  if (count <= ZERO_COUNT || maxCount <= ZERO_COUNT) {
    return ZERO_COUNT;
  }
  return Math.min(FULL_RATIO, count / maxCount);
};

const sourceSideColor = (ratio: number): string => {
  const [red, green, blue] = SOURCE_SIDE_RGB,
    alpha = SIDE_ALPHA_BASE + ratio * SOURCE_SIDE_ALPHA_STEP;
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(COLOR_PRECISION)})`;
};

const sourceStrokeColor = (ratio: number): string => {
  const [red, green, blue] = SOURCE_STROKE_RGB,
    alpha = STROKE_ALPHA_BASE + ratio * SOURCE_STROKE_ALPHA_STEP;
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(COLOR_PRECISION)})`;
};

const updateAnimationUniforms = (uniforms: GlobeUniforms, elapsed: number): void => {
  uniforms.uTime.value = elapsed;
  uniforms.uCloudOffset.value = (elapsed * CLOUD_DRIFT_SPEED) % FULL_RATIO;
};
export {
  buildCountryLabel,
  computeCapColor,
  computePolygonAltitude,
  computeSideColor,
  computeStrokeColor,
  findGlobeAnchor,
  getFeatureCenter,
  getQualityTier,
  polygonHeat,
  remapCountryCounts,
  setLightingModeUniform,
  updateAnimationUniforms,
};
