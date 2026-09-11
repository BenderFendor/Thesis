import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { InteractiveGlobe } from "@/components/interactive-globe";
import type {
  GlobeInstance,
  InteractiveGlobeComponent,
} from "@/components/interactive-globe";
import { Scene } from "three";

import { renderWithQueryClient } from "@/test-utils/render-with-query-client";
import { useEffect } from "react";
import { waitFor } from "@testing-library/react";

interface CountryFixtureResponse {
  readonly json: () => Promise<Readonly<{ features: readonly never[] }>>;
  readonly ok: boolean;
  readonly status: number;
}

type CountryFixtureFetch = (input: string) => Promise<CountryFixtureResponse>;

const testControls: ReturnType<GlobeInstance["controls"]> = {
    autoRotate: false,
    autoRotateSpeed: 0,
    enablePan: true,
    enableZoom: true,
  };
const pointOfView = jest.fn<GlobeInstance["pointOfView"]>();
const renderer: ReturnType<GlobeInstance["renderer"]> = {
    capabilities: {
      getMaxAnisotropy: () => 1,
      maxTextureSize: 4096,
    },
    outputColorSpace: "",
    setPixelRatio: jest.fn<(ratio: number) => void>(),
    toneMapping: 0,
    toneMappingExposure: 1,
  };
const globeRefInstance: GlobeInstance = {
    controls: () => testControls,
    getGlobeRadius: () => 100,
    pointOfView,
    renderer: () => renderer,
    scene: () => new Scene(),
  };

const EMPTY_ARTICLES: readonly [] = [];
const EMPTY_COUNTRY_METRICS = {
  articles_with_country: 0,
  articles_without_country: 0,
  country_count: 0,
  counts: {},
  total_articles: 0,
};

const GlobeSurface: InteractiveGlobeComponent = (props) => {
  const { ref } = props;
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      if (ref !== undefined) {
        ref.current = globeRefInstance;
      }
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [ref]);

  return <div data-testid="globe-surface" />;
};

GlobeSurface.displayName = "GlobeSurface";

const globeComponent: InteractiveGlobeComponent = GlobeSurface;
const fetchMock = jest.fn<CountryFixtureFetch>();

const setupGlobeTest = (): void => {
  testControls.autoRotate = false;
  testControls.autoRotateSpeed = 0;
  testControls.enableZoom = true;
  testControls.enablePan = true;
  pointOfView.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    json: () => Promise.resolve({ features: [] }),
    ok: true,
    status: 200,
  });
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
};

const restoreGlobeTest = (): void => {
  jest.restoreAllMocks();
};

describe("interactiveGlobe", () => {
  beforeEach(setupGlobeTest);
  afterEach(restoreGlobeTest);

  it("initializes globe controls after the delayed client surface mounts", async () => {
    expect.hasAssertions();

    renderWithQueryClient(
      <InteractiveGlobe
        articles={EMPTY_ARTICLES}
        countryMetrics={EMPTY_COUNTRY_METRICS}
        globeComponent={globeComponent}
        onCountrySelect={jest.fn<(countryCode: string | null, countryName?: string | null) => void>()}
        selectedCountry={null}
        lightingMode="all-lit"
      />,
    );

    expect(pointOfView).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(testControls.autoRotate).toBe(true);
    });

    expect(testControls).toStrictEqual({
      autoRotate: true,
      autoRotateSpeed: 0.5,
      enablePan: false,
      enableZoom: false,
    });
    expect(pointOfView).toHaveBeenNthCalledWith(1, { altitude: 2.5 });
    expect(pointOfView).toHaveBeenNthCalledWith(2, { altitude: 2.5 }, 800);
  });
});
