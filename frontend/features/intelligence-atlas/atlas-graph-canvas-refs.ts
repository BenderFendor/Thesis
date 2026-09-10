"use client";

import { useCallback, useRef } from "react";
import type { RefCallback } from "react";

interface AtlasGraphCanvasRefs {
  readonly containerRef: RefCallback<HTMLDivElement>;
  readonly focusAtlasNode: (nodeId: string) => void;
  readonly getContainer: () => HTMLDivElement | null;
  readonly getSvgBounds: () => DOMRect | undefined;
  readonly svgRef: RefCallback<SVGSVGElement>;
}

const useAtlasGraphCanvasRefs = (): AtlasGraphCanvasRefs => {
  const containerElementRef = useRef<HTMLDivElement>(null);
  const svgElementRef = useRef<SVGSVGElement>(null);
  const setContainerRef: RefCallback<HTMLDivElement> = useCallback((element) => {
    containerElementRef.current = element;
  }, []);
  const setSvgRef: RefCallback<SVGSVGElement> = useCallback((element) => {
    svgElementRef.current = element;
  }, []);
  const getContainer = useCallback(() => containerElementRef.current, []);
  const focusAtlasNode = useCallback((nodeId: string) => {
    svgElementRef.current
      ?.querySelector<SVGGElement>(`[data-node-id="${CSS.escape(nodeId)}"]`)
      ?.focus();
  }, []);
  const getSvgBounds = useCallback(() => svgElementRef.current?.getBoundingClientRect(), []);

  return {
    containerRef: setContainerRef,
    focusAtlasNode,
    getContainer,
    getSvgBounds,
    svgRef: setSvgRef,
  };
};

export { useAtlasGraphCanvasRefs };
