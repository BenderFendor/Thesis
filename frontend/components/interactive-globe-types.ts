import type { CountryArticleCounts, NewsArticle } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import type { ComponentType, JSXElementConstructor } from "react";
import type { GlobeProps } from "react-globe.gl";
import type { Scene } from "three";

type EarthLightingMode = "all-lit" | "day-night";

interface GlobeControls {
  autoRotate: boolean;
  autoRotateSpeed: number;
  enablePan: boolean;
  enableZoom: boolean;
}

interface GlobeRenderer {
  capabilities: Readonly<{
    getMaxAnisotropy: () => number;
    maxTextureSize: number;
  }>;
  outputColorSpace: string;
  setPixelRatio: (value: number) => void;
  toneMapping: number;
  toneMappingExposure: number;
}

interface GlobeInstance {
  readonly controls: () => GlobeControls;
  readonly getGlobeRadius: () => number;
  readonly pointOfView: (
    view: Readonly<{ altitude?: number; lat?: number; lng?: number }>,
    transitionDuration?: number,
  ) => void;
  readonly renderer: () => GlobeRenderer;
  readonly scene: () => Scene;
}

interface GlobeRef {
  current: GlobeInstance | undefined;
}

type GlobePolygon = NonNullable<GlobeProps["polygonsData"]>[number];

type GlobeRenderProps = Readonly<
  Pick<
    GlobeProps,
    | "atmosphereAltitude"
    | "backgroundColor"
    | "backgroundImageUrl"
    | "globeMaterial"
    | "height"
    | "lineHoverPrecision"
    | "onPolygonClick"
    | "onPolygonHover"
    | "polygonAltitude"
    | "polygonCapColor"
    | "polygonLabel"
    | "polygonSideColor"
    | "polygonStrokeColor"
    | "polygonsData"
    | "polygonsTransitionDuration"
    | "showAtmosphere"
    | "width"
  >
> & { readonly ref?: GlobeRef };

type InteractiveGlobeComponent = ComponentType<GlobeRenderProps>;

interface InteractiveGlobeProps {
  readonly articles: readonly NewsArticle[];
  readonly countryMetrics?: Readonly<CountryArticleCounts>;
  readonly globeComponent?: InteractiveGlobeComponent;
  readonly lightingMode: EarthLightingMode;
  readonly onCountrySelect: (countryCode: string | null, countryName?: string | null) => void;
  readonly selectedCountry: string | null;
}

interface ReadonlyInteractiveGlobeProps {
  readonly articles: readonly DeepReadonly<NewsArticle>[];
  readonly countryMetrics?: DeepReadonly<CountryArticleCounts>;
  readonly globeComponent?: JSXElementConstructor<GlobeRenderProps>;
  readonly lightingMode: EarthLightingMode;
  readonly onCountrySelect: InteractiveGlobeProps["onCountrySelect"];
  readonly selectedCountry: string | null;
}

export type {
  EarthLightingMode,
  GlobeInstance,
  GlobePolygon,
  GlobeRef,
  GlobeRenderProps,
  InteractiveGlobeComponent,
  InteractiveGlobeProps,
  ReadonlyInteractiveGlobeProps,
};
