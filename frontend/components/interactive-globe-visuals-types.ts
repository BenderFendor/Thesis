import type { CountryFeature as CountryFeatureType } from "@/lib/globe-country";
import type { GlobeProps } from "react-globe.gl";
import type { ShaderMaterial, Texture, TextureLoader, Vector3 } from "three";

type CountryFeature = CountryFeatureType;

type EarthLightingMode = "all-lit" | "day-night";
type GlobePolygon = NonNullable<GlobeProps["polygonsData"]>[number];
type TextureLoaderContract = Readonly<Pick<TextureLoader, "loadAsync">>;
type CountryCountMap = Readonly<Record<string, number>>;
type MutableCountryCountMap = Record<string, number>;

interface CountryCenter {
  readonly lat: number;
  readonly lng: number;
}

interface ReadonlyCountryFeature {
  readonly geometry?: Readonly<{ coordinates?: unknown }> | null;
  readonly properties: Readonly<CountryFeature["properties"]>;
}

type TextureReference = Readonly<Pick<Texture, "dispose">>;

interface TextureUniform {
  value: TextureReference;
}

interface NumberUniform {
  value: number;
}

interface VectorUniform {
  value: Vector3;
}

interface GlobeUniforms {
  readonly uBumpTexture: TextureUniform;
  readonly uCloudOffset: NumberUniform;
  readonly uCloudTexture: TextureUniform;
  readonly uDayTexture: TextureUniform;
  readonly uLightingMode: NumberUniform;
  readonly uNightTexture: TextureUniform;
  readonly uSunDirection: VectorUniform;
  readonly uSurfaceMask: TextureUniform;
  readonly uTime: NumberUniform;
}

interface GlobeUniformView {
  readonly uBumpTexture: Readonly<{ readonly value: TextureReference }>;
  readonly uCloudOffset: Readonly<{ readonly value: number }>;
  readonly uCloudTexture: Readonly<{ readonly value: TextureReference }>;
  readonly uDayTexture: Readonly<{ readonly value: TextureReference }>;
  readonly uLightingMode: Readonly<{ readonly value: number }>;
  readonly uNightTexture: Readonly<{ readonly value: TextureReference }>;
  readonly uSunDirection: Readonly<{
    readonly value: Readonly<Pick<Vector3, "x" | "y" | "z">>;
  }>;
  readonly uSurfaceMask: Readonly<{ readonly value: TextureReference }>;
  readonly uTime: Readonly<{ readonly value: number }>;
}

interface GlobeMaterialSetup {
  readonly material: ShaderMaterial;
  readonly placeholderTextures: readonly Texture[];
  readonly uniforms: GlobeUniforms;
}

interface GlobeTextureSet {
  readonly bumpTexture: TextureReference;
  readonly cloudTexture: TextureReference;
  readonly dayTexture: TextureReference;
  readonly nightTexture: TextureReference;
  readonly surfaceMaskTexture: TextureReference;
}

interface PolygonHeat {
  readonly iso: string | null;
  readonly mentionCount: number;
  readonly ratio: number;
  readonly sourceCount: number;
}

interface QualityTier {
  readonly anisotropyCap: number;
  readonly maxTextureSize: number;
  readonly pixelRatioCap: number;
  readonly sphereSegments: number;
  readonly starCount: number;
}

interface PolygonContext {
  readonly displayCounts: CountryCountMap;
  readonly maxCount: number;
  readonly maxMentionCount: number;
  readonly mentionCounts: CountryCountMap;
}

export {
  type EarthLightingMode,
  type GlobePolygon,
  type TextureLoaderContract,
  type CountryCountMap,
  type MutableCountryCountMap,
  type CountryCenter,
  type ReadonlyCountryFeature,
  type GlobeUniforms,
  type GlobeUniformView,
  type GlobeMaterialSetup,
  type GlobeTextureSet,
  type TextureReference,
  type PolygonHeat,
  type QualityTier,
  type PolygonContext,
};

export type * from "@/lib/globe-country";
