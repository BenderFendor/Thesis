import type { Texture } from "three";
import { useEffect } from "react";
import {
  DESKTOP_FOCUS_ALTITUDE,
  DESKTOP_OVERVIEW_ALTITUDE,
  FOCUS_TRANSITION_MS,
  MOBILE_FOCUS_ALTITUDE,
  MOBILE_LAT_OFFSET,
  MOBILE_OVERVIEW_ALTITUDE,
  ZERO_COUNT,
  setLightingModeUniform,
} from "./interactive-globe-visuals";
import type { EarthLightingMode, GlobeInstance } from "./interactive-globe-types";
import type { GlobeCountryData } from "./interactive-globe-hooks";
import type { GlobeUniforms, QualityTier } from "./interactive-globe-visuals";

interface GlobeContainerRef {
  readonly current: HTMLDivElement | null;
}

interface GlobeDimensions {
  readonly height: number;
  readonly width: number;
}

type DimensionsSetter = (dimensions: GlobeDimensions) => void;

const getOverviewAltitude = (): number => {
  if (globalThis.innerWidth < 1024) {
    return MOBILE_OVERVIEW_ALTITUDE;
  }
  return DESKTOP_OVERVIEW_ALTITUDE;
};

const getFocusAltitude = (): number => {
  if (globalThis.innerWidth < 1024) {
    return MOBILE_FOCUS_ALTITUDE;
  }
  return DESKTOP_FOCUS_ALTITUDE;
};

const getLatitudeOffset = (): number => {
  if (globalThis.innerWidth < 1024) {
    return MOBILE_LAT_OFFSET;
  }
  return -5;
};

const useGlobeLighting = (uniforms: GlobeUniforms, lightingMode: EarthLightingMode): void => {
  useEffect(() => {
    setLightingModeUniform(uniforms, lightingMode);
  }, [lightingMode, uniforms]);
};

const updateGlobeCamera = (
  globeInstance: GlobeInstance,
  countryCenters: GlobeCountryData["countryCenters"],
  selectedCountry: string | null,
): void => {
  const controls = globeInstance.controls();
  if (selectedCountry === null) {
    controls.autoRotate = true;
    globeInstance.pointOfView({ altitude: getOverviewAltitude() }, FOCUS_TRANSITION_MS);
    return;
  }
  controls.autoRotate = false;
  const center = countryCenters[selectedCountry];
  if (center === undefined) {
    return;
  }
  globeInstance.pointOfView(
    {
      altitude: getFocusAltitude(),
      lat: center.lat + getLatitudeOffset(),
      lng: center.lng,
    },
    FOCUS_TRANSITION_MS,
  );
};

const useGlobeCamera = (
  globeInstance: GlobeInstance | null,
  countryCenters: GlobeCountryData["countryCenters"],
  selectedCountry: string | null,
): void => {
  useEffect(() => {
    if (globeInstance === null) {
      return;
    }
    const controls = globeInstance.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    controls.enableZoom = false;
    controls.enablePan = false;
    globeInstance.pointOfView({ altitude: getOverviewAltitude() });
  }, [globeInstance]);

  useEffect(() => {
    if (globeInstance === null) {
      return;
    }
    updateGlobeCamera(globeInstance, countryCenters, selectedCountry);
  }, [countryCenters, globeInstance, selectedCountry]);
};

const useGlobeResize = (containerRef: GlobeContainerRef, setDimensions: DimensionsSetter): void => {
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) {
      return () => {};
    }
    const updateSize = (): void => {
      const rect = element.getBoundingClientRect();
      setDimensions({
        height: Math.max(ZERO_COUNT, Math.floor(rect.height)),
        width: Math.max(ZERO_COUNT, Math.floor(rect.width)),
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [containerRef, setDimensions]);
};

const useGlobeRendererQuality = (
  globeInstance: GlobeInstance | null,
  qualityTier: QualityTier,
): void => {
  useEffect(() => {
    if (globeInstance === null) {
      return;
    }
    const renderer = globeInstance.renderer();
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio, qualityTier.pixelRatioCap));
  }, [globeInstance, qualityTier.pixelRatioCap]);
};

interface GlobeCleanupResources {
  readonly material: Readonly<{ dispose: () => void }>;
  readonly placeholderTextures: readonly Texture[];
}

const useGlobeMaterialCleanup = (resources: GlobeCleanupResources): void => {
  useEffect(
    () => () => {
      resources.placeholderTextures.forEach((texture) => {
        texture.dispose();
      });
      resources.material.dispose();
    },
    [resources],
  );
};

export {
  useGlobeCamera,
  useGlobeLighting,
  useGlobeMaterialCleanup,
  useGlobeRendererQuality,
  useGlobeResize,
};
