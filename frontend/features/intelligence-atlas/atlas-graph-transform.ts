import type { AtlasPosition } from "./lib/atlas-force-layout";
import type { Transform } from "./atlas-graph-types";

interface AtlasGraphBounds {
  readonly maxX: number;
  readonly maxY: number;
  readonly minX: number;
  readonly minY: number;
}

const getAtlasGraphBounds = (
  positions: Readonly<Record<string, AtlasPosition>>,
): AtlasGraphBounds | null => {
  const values = Object.values(positions);
  if (values.length === 0) {
    return null;
  }
  const xValues = values.map((position) => position.x);
  const yValues = values.map((position) => position.y);
  return {
    maxX: Math.max(...xValues),
    maxY: Math.max(...yValues),
    minX: Math.min(...xValues),
    minY: Math.min(...yValues),
  };
};

const getFittedAtlasTransform = (
  positions: Readonly<Record<string, AtlasPosition>>,
  dimensions: Readonly<{ height: number; width: number }>,
): Transform => {
  const bounds = getAtlasGraphBounds(positions);
  if (bounds === null) {
    return { offsetX: 0, offsetY: 0, scale: 1 };
  }
  const padding = 90;
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(
    1.45,
    Math.max(
      0.35,
      Math.min(
        (dimensions.width - padding * 2) / width,
        (dimensions.height - padding * 2) / height,
      ),
    ),
  );
  return {
    offsetX: dimensions.width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    offsetY: dimensions.height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
    scale,
  };
};

const getZoomedAtlasTransform = (
  current: Readonly<Transform>,
  pointerX: number,
  pointerY: number,
  factor: number,
): Transform => {
  const nextScale = Math.min(3.5, Math.max(0.3, current.scale * factor));
  const worldX = (pointerX - current.offsetX) / current.scale;
  const worldY = (pointerY - current.offsetY) / current.scale;
  return {
    offsetX: pointerX - worldX * nextScale,
    offsetY: pointerY - worldY * nextScale,
    scale: nextScale,
  };
};

export { getFittedAtlasTransform, getZoomedAtlasTransform };
