import type { GlobeProps } from "react-globe.gl";
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { InteractiveGlobe } from '@/components/interactive-globe';
import type { InteractiveGlobeComponent, InteractiveGlobeHandle } from '@/components/interactive-globe';
import type { MutableRefObject } from "react";
import { Scene } from "three";

import { renderWithQueryClient } from "@/test-utils/render-with-query-client";
import { useEffect } from "react";
import { waitFor } from "@testing-library/react";

const testControls = {
    autoRotate: false,
    autoRotateSpeed: 0,
    enablePan: true,
    enableZoom: true,
  },
  pointOfView = jest.fn(),
  renderer = {
    capabilities: {
      getMaxAnisotropy: () => 1,
      maxTextureSize: 4096,
    },
    outputColorSpace: "",
    setPixelRatio: jest.fn(),
    toneMapping: 0,
    toneMappingExposure: 1,
  },
  EMPTY_ARTICLES = [] as const,
  EMPTY_COUNTRY_METRICS = {
    articles_with_country: 0,
    articles_without_country: 0,
    country_count: 0,
    counts: {},
    total_articles: 0,
  } as const,
  globeInstance: InteractiveGlobeHandle = {
    controls: () => testControls,
    getGlobeRadius: () => 100,
    pointOfView,
    renderer: () => renderer,
    scene: () => new Scene(),
  };

interface GlobeSurfaceProps extends GlobeProps {
  ref?: MutableRefObject<InteractiveGlobeHandle | undefined>;
}

const GlobeSurface: InteractiveGlobeComponent = ({ ref }: GlobeSurfaceProps) => {
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      if (ref !== undefined) {
        ref.current = globeInstance;
      }
    }, 0);
    return () =>{  globalThis.clearTimeout(timer); };
  }, [ref]);

  return <div data-testid="globe-surface" />;
};

GlobeSurface.displayName = "GlobeSurface";

const globeComponent: InteractiveGlobeComponent = GlobeSurface;

describe("interactiveGlobe", () => {
  const fetchMock = jest.fn<typeof fetch>();

  beforeEach(() => {
    testControls.autoRotate = false;
    testControls.autoRotateSpeed = 0;
    testControls.enableZoom = true;
    testControls.enablePan = true;
    pointOfView.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ features: [] }), { status: 200 }),
    );
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("initializes globe controls after the delayed client surface mounts", async () => {  expect.hasAssertions();

    renderWithQueryClient(
      <InteractiveGlobe
        articles={EMPTY_ARTICLES}
        countryMetrics={EMPTY_COUNTRY_METRICS}
        globeComponent={globeComponent}
        onCountrySelect={jest.fn()}
        selectedCountry={null}
        lightingMode="all-lit"
      />,
    );

    expect(pointOfView).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(testControls.autoRotate).toBe(true);
    });

    expect(testControls.autoRotateSpeed).toBe(0.5);
    expect(testControls.enableZoom).toBe(false);
    expect(testControls.enablePan).toBe(false);
    expect(pointOfView).toHaveBeenNthCalledWith(1, { altitude: 2.5 });
    expect(pointOfView).toHaveBeenNthCalledWith(2, { altitude: 2.5 }, 800);
  });
});
