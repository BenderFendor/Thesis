import { useMemo } from "react";
import type { ReactElement } from "react";
import type {
  GlobeRenderProps,
  GlobePolygon,
  GlobeRef,
  InteractiveGlobeComponent,
} from "./interactive-globe-types";

interface GlobeDimensions {
  readonly height: number;
  readonly width: number;
}

interface GlobeCanvasRef {
  readonly current: GlobeRef["current"];
}

interface GlobeCanvasProps {
  readonly component: InteractiveGlobeComponent;
  readonly dimensions: GlobeDimensions;
  readonly globeMaterial: Readonly<NonNullable<GlobeRenderProps["globeMaterial"]>> | undefined;
  readonly globeRef: GlobeCanvasRef;
  readonly onPolygonClick: GlobeRenderProps["onPolygonClick"];
  readonly onPolygonHover: GlobeRenderProps["onPolygonHover"];
  readonly polygonAltitude: GlobeRenderProps["polygonAltitude"];
  readonly polygonCapColor: GlobeRenderProps["polygonCapColor"];
  readonly polygonLabel: GlobeRenderProps["polygonLabel"];
  readonly polygonSideColor: GlobeRenderProps["polygonSideColor"];
  readonly polygonStrokeColor: GlobeRenderProps["polygonStrokeColor"];
  readonly polygonsData: readonly GlobePolygon[];
}

const GlobeCanvas = (props: GlobeCanvasProps): ReactElement => {
  const {
    component: GlobeComponent,
    dimensions,
    globeMaterial,
    globeRef,
    onPolygonClick,
    onPolygonHover,
    polygonAltitude,
    polygonCapColor,
    polygonLabel,
    polygonSideColor,
    polygonStrokeColor,
    polygonsData,
  } = props;
  const mutablePolygonsData = useMemo(() => [...polygonsData], [polygonsData]);
  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--news-bg-primary)]">
      <GlobeComponent
        ref={globeRef}
        globeMaterial={globeMaterial}
        backgroundColor="rgba(0,0,0,0)"
        showAtmosphere={false}
        atmosphereAltitude={0}
        polygonsTransitionDuration={0}
        lineHoverPrecision={0}
        polygonsData={mutablePolygonsData}
        polygonAltitude={polygonAltitude}
        polygonCapColor={polygonCapColor}
        polygonSideColor={polygonSideColor}
        polygonStrokeColor={polygonStrokeColor}
        polygonLabel={polygonLabel}
        onPolygonHover={onPolygonHover}
        onPolygonClick={onPolygonClick}
        width={dimensions.width}
        height={dimensions.height}
      />
    </div>
  );
};

export { GlobeCanvas };
