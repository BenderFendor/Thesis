"use client";

import dynamic from "next/dynamic";
import type { GlobeMethods } from "react-globe.gl";
import { useEffect, useMemo } from "react";
import type { GlobeRef, InteractiveGlobeComponent } from "./interactive-globe-types";

const Globe = dynamic(
  async () => {
    const importedGlobe = await import("react-globe.gl");
    return importedGlobe.default;
  },
  {
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    ),
    ssr: false,
  },
);

interface GlobeRefBridge {
  current: GlobeMethods | undefined;
  target: GlobeRef | undefined;
}

interface GlobeBridgeState {
  value: GlobeMethods | null;
}

interface GlobeRefBridgeResult {
  readonly bridge: GlobeRefBridge;
}

const useGlobeRefBridge = (): GlobeRefBridgeResult => {
  const nativeRef = useMemo<GlobeRefBridge>(() => {
    const state: GlobeBridgeState = { value: null };
    const bridge: GlobeRefBridge = {
      get current() {
        return state.value ?? undefined;
      },
      set current(nextInstance: GlobeMethods | undefined) {
        state.value = nextInstance ?? null;
        const target = bridge.target;
        if (target !== undefined) {
          target.current = nextInstance;
        }
      },
      target: undefined,
    };
    return bridge;
  }, []);

  return { bridge: nativeRef };
};

const GlobeAdapter: InteractiveGlobeComponent = ({
  atmosphereAltitude,
  backgroundColor,
  backgroundImageUrl,
  globeMaterial,
  height,
  lineHoverPrecision,
  onPolygonClick,
  onPolygonHover,
  polygonAltitude,
  polygonCapColor,
  polygonLabel,
  polygonSideColor,
  polygonStrokeColor,
  polygonsData,
  polygonsTransitionDuration,
  ref: targetRef,
  showAtmosphere,
  width,
}) => {
  const { bridge: nativeRef } = useGlobeRefBridge();

  useEffect(() => {
    nativeRef.target = targetRef;
    if (targetRef !== undefined) {
      targetRef.current = nativeRef.current;
    }
  }, [nativeRef, targetRef]);

  return (
    <Globe
      ref={nativeRef}
      atmosphereAltitude={atmosphereAltitude}
      backgroundColor={backgroundColor}
      backgroundImageUrl={backgroundImageUrl}
      globeMaterial={globeMaterial}
      height={height}
      lineHoverPrecision={lineHoverPrecision}
      onPolygonClick={onPolygonClick}
      onPolygonHover={onPolygonHover}
      polygonAltitude={polygonAltitude}
      polygonCapColor={polygonCapColor}
      polygonLabel={polygonLabel}
      polygonSideColor={polygonSideColor}
      polygonStrokeColor={polygonStrokeColor}
      polygonsData={polygonsData}
      polygonsTransitionDuration={polygonsTransitionDuration}
      showAtmosphere={showAtmosphere}
      width={width}
    />
  );
};

export { GlobeAdapter };
