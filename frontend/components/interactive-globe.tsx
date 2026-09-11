"use client";

import { useMemo, useRef, useState } from "react";
import { ZERO_COUNT, createGlobeMaterial, getQualityTier } from "./interactive-globe-visuals";
import type { GlobeUniformView, TextureReference } from "./interactive-globe-visuals";
import {
  useGlobeCounts,
  useGlobeCountryData,
  usePolygonPresentation,
} from "./interactive-globe-hooks";
import { GlobeAdapter } from "./interactive-globe-adapter";
import { GlobeCanvas } from "./interactive-globe-canvas";
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
  readonly globeRef: GlobeRef;
  readonly globeSetup: ReturnType<typeof createGlobeMaterial>;
  readonly maxCount: ReturnType<typeof useGlobeCounts>["maxCount"];
  readonly maxMentionCount: ReturnType<typeof useGlobeCounts>["maxMentionCount"];
  readonly mentionCounts: ReturnType<typeof useGlobeCounts>["mentionCounts"];
  readonly visibleCountries: ReturnType<typeof useGlobeCountryData>["visibleCountries"];
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

const useGlobeRuntime = ({
  articles,
  countryMetrics,
  lightingMode,
  selectedCountry,
}: GlobeRuntimeContext): GlobeRuntime => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ height: ZERO_COUNT, width: ZERO_COUNT });
  const [globeInstance, setGlobeInstance] = useState<GlobeInstance | null>(null);
  const globeRef = useMemo(() => createGlobeRef(setGlobeInstance), [setGlobeInstance]);
  const qualityTier = useMemo(
    () => getQualityTier(dimensions.width, dimensions.height),
    [dimensions.height, dimensions.width],
  );
  const { countryCenters, visibleCountries } = useGlobeCountryData();
  const globeSetup = useMemo(() => createGlobeMaterial(), []);
  const { displayCounts, maxCount, maxMentionCount, mentionCounts } = useGlobeCounts(
    articles,
    countryMetrics,
    visibleCountries,
  );
  useGlobeLifecycle({
    containerRef,
    countryCenters,
    globeInstance,
    globeSetup,
    lightingMode,
    qualityTier,
    selectedCountry,
    setDimensions,
  });
  return {
    dimensions,
    displayCounts,
    globeInstance,
    globeRef,
    globeSetup,
    maxCount,
    maxMentionCount,
    mentionCounts,
    visibleCountries,
  };
};

const InteractiveGlobe = ({
  articles,
  countryMetrics,
  globeComponent: GlobeComponent = GlobeAdapter,
  onCountrySelect,
  selectedCountry,
  lightingMode,
}: ReadonlyInteractiveGlobeProps) => {
  const {
    dimensions,
    displayCounts,
    globeInstance,
    globeRef,
    globeSetup,
    maxCount,
    maxMentionCount,
    mentionCounts,
    visibleCountries,
  } = useGlobeRuntime({ articles, countryMetrics, lightingMode, selectedCountry });
  const presentation = usePolygonPresentation({
    displayCounts,
    globeInstance,
    maxCount,
    maxMentionCount,
    mentionCounts,
    onCountrySelect,
    selectedCountry,
  });
  const mutablePolygonsData = useMemo(() => [...visibleCountries], [visibleCountries]);

  return (
    <GlobeCanvas>
      <GlobeComponent
        ref={globeRef} globeMaterial={globeSetup.material}
        backgroundColor="rgba(0,0,0,0)" showAtmosphere={false}
        atmosphereAltitude={0} polygonsTransitionDuration={0} lineHoverPrecision={0}
        polygonsData={mutablePolygonsData}
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

export { InteractiveGlobe };
export { computePolygonHeatFast } from "./interactive-globe-visuals";
export type { GlobeInstance, GlobeRef, InteractiveGlobeComponent } from "./interactive-globe-types";
