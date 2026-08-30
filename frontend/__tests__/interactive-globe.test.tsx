import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from "react"
import { waitFor } from "@testing-library/react"

import { InteractiveGlobe } from "@/components/interactive-globe"
import { renderWithQueryClient } from "@/test-utils/render-with-query-client"

const mockControls = {
  autoRotate: false,
  autoRotateSpeed: 0,
  enablePan: true,
  enableZoom: true,
},
 mockPointOfView = jest.fn(),
 mockGlobeInstance = {
  controls: () => mockControls,
  pointOfView: (...args:readonly  unknown[]) => mockPointOfView(...args),
  renderer: () => null,
  scene: () => null,
} as const,
 mockReactGlobe = React.forwardRef<unknown, Record<string, unknown>>((_props, ref) => {
  React.useEffect(() => {
    if (typeof ref === "function") {
      ref(mockGlobeInstance)
      return () =>{  ref(undefined); }
    }

    if (ref && typeof ref === "object" && "current" in ref) {
      ;(ref as { current: unknown }).current = mockGlobeInstance
      return () => {
        ;(ref as { current: unknown }).current = undefined
      }
    }
    return
  }, [ref])

  return <div data-testid="mock-globe" />
})

mockReactGlobe.displayName = "MockGlobe"

jest.mock<typeof import('next/dynamic')>("next/dynamic", () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const React = jest.requireActual<typeof import("react")>("react")

  return (
    _loader: unknown,
    options?:Readonly< { loading?: () => React.ReactNode }>,
  ) => {
    const DynamicGlobe = React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
      const [ready, setReady] = React.useState(false)

      React.useEffect(() => {
        const timer = globalThis.setTimeout(() => {
          setReady(true)
        }, 0)
        return () =>{  globalThis.clearTimeout(timer); }
      }, [])

      if (!ready) {
        return options?.loading ? <>{options.loading()}</> : null
      }

      const MockGlobeComponent = mockReactGlobe
      return <MockGlobeComponent {...props} ref={ref} />
    })

    DynamicGlobe.displayName = "DynamicGlobeMock"
    return DynamicGlobe
  }
})

jest.mock<typeof import('react-globe.gl')>("react-globe.gl", () => (
  {
    __esModule: true,
    default: mockReactGlobe,
  }
))

jest.mock<typeof import('d3-geo')>("d3-geo", () => ({
  geoCentroid: () => [0, 0],
}))

describe("interactiveGlobe", () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    mockControls.autoRotate = false
    mockControls.autoRotateSpeed = 0
    mockControls.enableZoom = true
    mockControls.enablePan = true
    mockPointOfView.mockReset()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({
      json: async () => ({ features: [] }),
    })
    global.fetch = fetchMock as typeof fetch
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  })

  it("initializes globe controls after the delayed dynamic mount resolves", async () => {  expect.hasAssertions();
  
    renderWithQueryClient(
      <InteractiveGlobe
        articles={[]}
        countryMetrics={{
          articles_with_country: 0,
          articles_without_country: 0,
          country_count: 0,
          counts: {},
          total_articles: 0,
        }}
        onCountrySelect={jest.fn()}
        selectedCountry={undefined}
        lightingMode="all-lit"
      />,
    )

    expect(mockPointOfView).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(mockControls.autoRotate).toBe(true)
    })

    expect(mockControls.autoRotateSpeed).toBe(0.5)
    expect(mockControls.enableZoom).toBe(false)
    expect(mockControls.enablePan).toBe(false)
    expect(mockPointOfView).toHaveBeenCalledWith()
  })
})
