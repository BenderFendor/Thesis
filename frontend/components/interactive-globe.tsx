"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ZERO_COUNT, createGlobeMaterial, getQualityTier } from "./interactive-globe-visuals";
import type { GlobeUniformView, TextureReference } from "./interactive-globe-visuals";
import {
  useGlobeCounts,
  useGlobeCountryData,
  usePolygonPresentation,
} from "./interactive-globe-hooks";
import { GlobeAdapter } from "./interactive-globe-adapter";
import { GlobeCanvas } from "./interactive-globe-canvas";
import type { DeepReadonly } from "@/lib/deep-readonly";
import {
  useGlobeCamera,
  useGlobeLighting,
  useGlobeMaterialCleanup,
  useGlobeRendererQuality,
  useGlobeResize,
} from "./interactive-globe-lifecycle";
import { useGlobeScene } from "./interactive-globe-scene";
import type {
  GlobeInstance,
  GlobeRef,
  ReadonlyInteractiveGlobeProps,
} from "./interactive-globe-types";

interface GlobeInstanceState {
  value: GlobeInstance | null;
}

interface GlobeRuntimeContext {
  readonly articles: ReadonlyInteractiveGlobeProps["articles"];
  readonly countryMetrics: ReadonlyInteractiveGlobeProps["countryMetrics"];
  readonly lightingMode: ReadonlyInteractiveGlobeProps["lightingMode"];
  readonly selectedCountry: ReadonlyInteractiveGlobeProps["selectedCountry"];
}

interface GlobeRuntime {
  readonly dimensions: { readonly height: number; readonly width: number };
  readonly displayCounts: ReturnType<typeof useGlobeCounts>["displayCounts"];
  readonly globeInstance: GlobeInstance | null;
  readonly globeRef: Readonly<GlobeRef>;
  readonly globeSetup: ReturnType<typeof createGlobeMaterial>;
  readonly maxCount: ReturnType<typeof useGlobeCounts>["maxCount"];
  readonly maxMentionCount: ReturnType<typeof useGlobeCounts>["maxMentionCount"];
  readonly mentionCounts: ReturnType<typeof useGlobeCounts>["mentionCounts"];
  readonly visibleCountries: ReturnType<typeof useGlobeCountryData>["visibleCountries"];
}

interface GlobeRuntimeEnvironment {
  readonly containerRef: { readonly current: HTMLDivElement | null };
  readonly dimensions: GlobeRuntime["dimensions"];
  readonly globeInstance: GlobeInstance | null;
  readonly globeRef: Readonly<GlobeRef>;
  readonly globeSetup: ReturnType<typeof createGlobeMaterial>;
  readonly qualityTier: ReturnType<typeof getQualityTier>;
  readonly setDimensions: (dimensions: GlobeRuntime["dimensions"]) => void;
}

interface GlobeLifecycleContext {
  readonly containerRef: { readonly current: HTMLDivElement | null };
  readonly countryCenters: ReturnType<typeof useGlobeCountryData>["countryCenters"];
  readonly globeInstance: GlobeInstance | null;
  readonly globeSetup: GlobeSetupView;
  readonly lightingMode: ReadonlyInteractiveGlobeProps["lightingMode"];
  readonly qualityTier: ReturnType<typeof getQualityTier>;
  readonly selectedCountry: ReadonlyInteractiveGlobeProps["selectedCountry"];
  readonly setDimensions: (dimensions: { readonly height: number; readonly width: number }) => void;
}

interface GlobeSetupView {
  readonly material: Readonly<{ dispose: () => void }>;
  readonly placeholderTextures: readonly TextureReference[];
  readonly uniforms: GlobeUniformView;
}

type GlobeInstanceSetter = (instance: GlobeInstance | null) => void;

const createGlobeRef = (setGlobeInstance: GlobeInstanceSetter): GlobeRef => {
  const state: GlobeInstanceState = { value: null };
  return {
    get current() {
      return state.value ?? undefined;
    },
    set current(instance: GlobeInstance | undefined) {
      state.value = instance ?? null;
      setGlobeInstance(instance ?? null);
    },
  };
};

const useGlobeLifecycle = ({
  containerRef,
  countryCenters,
  globeInstance,
  globeSetup,
  lightingMode,
  qualityTier,
  selectedCountry,
  setDimensions,
}: GlobeLifecycleContext): void => {
  useGlobeLighting(globeSetup.uniforms, lightingMode);
  useGlobeCamera(globeInstance, countryCenters, selectedCountry);
  useGlobeResize(containerRef, setDimensions);
  useGlobeRendererQuality(globeInstance, qualityTier);
  useGlobeScene({ containerRef, globeInstance, globeUniforms: globeSetup.uniforms });
  useGlobeMaterialCleanup(globeSetup);
};

const useGlobeRuntimeEnvironment = (): GlobeRuntimeEnvironment => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ height: ZERO_COUNT, width: ZERO_COUNT });
  const [globeInstance, setGlobeInstance] = useState<GlobeInstance | null>(null);
  const globeRef = useMemo(() => createGlobeRef(setGlobeInstance), [setGlobeInstance]);
  const qualityTier = useMemo(
    () => getQualityTier(dimensions.width, dimensions.height),
    [dimensions.height, dimensions.width],
  );
  const globeSetup = useMemo(() => createGlobeMaterial(), []);
  return {
    containerRef,
    dimensions,
    globeInstance,
    globeRef,
    globeSetup,
    qualityTier,
    setDimensions,
  };
};

const useGlobeRuntimeData = ({
  articles,
  countryMetrics,
}: DeepReadonly<Pick<GlobeRuntimeContext, "articles" | "countryMetrics">>) => {
  const { countryCenters, visibleCountries } = useGlobeCountryData();
  const { displayCounts, maxCount, maxMentionCount, mentionCounts } = useGlobeCounts(
    articles,
    countryMetrics,
    visibleCountries,
  );
  return {
    countryCenters,
    displayCounts,
    maxCount,
    maxMentionCount,
    mentionCounts,
    visibleCountries,
  };
};

const useGlobeRuntime = ({
  articles,
  countryMetrics,
  lightingMode,
  selectedCountry,
}: GlobeRuntimeContext): GlobeRuntime => {
  const environment = useGlobeRuntimeEnvironment();
  const data = useGlobeRuntimeData({ articles, countryMetrics });
  useGlobeLifecycle({
    containerRef: environment.containerRef,
    countryCenters: data.countryCenters,
    globeInstance: environment.globeInstance,
    globeSetup: environment.globeSetup,
    lightingMode,
    qualityTier: environment.qualityTier,
    selectedCountry,
    setDimensions: environment.setDimensions,
  });
  return {
    dimensions: environment.dimensions,
    displayCounts: data.displayCounts,
    globeInstance: environment.globeInstance,
    globeRef: environment.globeRef,
    globeSetup: environment.globeSetup,
    maxCount: data.maxCount,
    maxMentionCount: data.maxMentionCount,
    mentionCounts: data.mentionCounts,
    visibleCountries: data.visibleCountries,
  };
};

interface GlobeSurfaceProps {
  readonly dimensions: GlobeRuntime["dimensions"];
  readonly globeComponent: NonNullable<ReadonlyInteractiveGlobeProps["globeComponent"]>;
  readonly globeRef: Readonly<{ readonly current: GlobeRef["current"] }>;
  readonly globeMaterial: () => GlobeRuntime["globeSetup"]["material"];
  readonly mutablePolygonsData: readonly Readonly<GlobeRuntime["visibleCountries"][number]>[];
  readonly presentation: ReturnType<typeof usePolygonPresentation>;
}

const GlobeSurface = ({
  dimensions,
  globeComponent: GlobeComponent,
  globeRef,
  globeMaterial,
  mutablePolygonsData,
  presentation,
}: DeepReadonly<GlobeSurfaceProps> &
  Readonly<Pick<GlobeSurfaceProps, "globeComponent">>) => {
  const polygonsData = useMemo(() => [...mutablePolygonsData], [mutablePolygonsData]);
  return (
    <GlobeCanvas>
      <GlobeComponent
        ref={globeRef} globeMaterial={globeMaterial()}
        backgroundColor="rgba(0,0,0,0)" showAtmosphere={false}
        atmosphereAltitude={0} polygonsTransitionDuration={0} lineHoverPrecision={0}
        polygonsData={polygonsData}
        polygonAltitude={presentation.polygonAltitude}
        polygonCapColor={presentation.polygonCapColor}
        polygonSideColor={presentation.polygonSideColor}
        polygonStrokeColor={presentation.polygonStrokeColor}
        polygonLabel={presentation.polygonLabel}
        onPolygonHover={presentation.handlePolygonHover}
        onPolygonClick={presentation.handlePolygonClick}
        width={dimensions.width}
        height={dimensions.height}
      />
    </GlobeCanvas>
  );
};

const InteractiveGlobe = ({
  articles,
  countryMetrics,
  globeComponent: GlobeComponent = GlobeAdapter,
  onCountrySelect,
  selectedCountry,
  lightingMode,
}: ReadonlyInteractiveGlobeProps) => {
  const runtime = useGlobeRuntime({ articles, countryMetrics, lightingMode, selectedCountry });
  const presentation = usePolygonPresentation({
    displayCounts: runtime.displayCounts,
    globeInstance: runtime.globeInstance,
    maxCount: runtime.maxCount,
    maxMentionCount: runtime.maxMentionCount,
    mentionCounts: runtime.mentionCounts,
    onCountrySelect,
    selectedCountry,
  });
  const globeMaterial = useCallback(() => runtime.globeSetup.material, [runtime.globeSetup]);

  return (
    <GlobeSurface
      dimensions={runtime.dimensions}
      globeComponent={GlobeComponent}
      globeRef={runtime.globeRef}
      globeMaterial={globeMaterial}
      mutablePolygonsData={runtime.visibleCountries}
      presentation={presentation}
    />
  );
};

export { InteractiveGlobe };
export { computePolygonHeatFast } from "./interactive-globe-visuals";
export type { GlobeInstance, InteractiveGlobeComponent } from "./interactive-globe-types";
