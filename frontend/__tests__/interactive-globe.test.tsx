import React from "react"
import { waitFor } from "@testing-library/react"

import { InteractiveGlobe } from "@/components/interactive-globe"
import { renderWithQueryClient } from "@/test-utils/render-with-query-client"

const mockControls = {
  autoRotate: false,
  autoRotateSpeed: 0,
  enableZoom: true,
  enablePan: true,
}
const mockPointOfView = jest.fn()
const mockGlobeInstance = {
  controls: () => mockControls,
  pointOfView: (...args: unknown[]) => mockPointOfView(...args),
  renderer: () => null,
  scene: () => null,
} as const
const mockReactGlobe = React.forwardRef<unknown, Record<string, unknown>>((_props, ref) => {
  React.useEffect(() => {
    if (typeof ref === "function") {
      ref(mockGlobeInstance)
      return () => ref(null)
    }

    if (ref && typeof ref === "object" && "current" in ref) {
      ;(ref as { current: unknown }).current = mockGlobeInstance
      return () => {
        ;(ref as { current: unknown }).current = null
      }
    }
  }, [ref])

  return <div data-testid="mock-globe" />
})

mockReactGlobe.displayName = "MockGlobe"

jest.mock("next/dynamic", () => {
  const React = jest.requireActual<typeof import("react")>("react")

  return (
    _loader: unknown,
    options?: { loading?: () => React.ReactNode },
  ) => {
    const DynamicGlobe = React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
      const [ready, setReady] = React.useState(false)

      React.useEffect(() => {
        const timer = window.setTimeout(() => {
          setReady(true)
        }, 0)
        return () => window.clearTimeout(timer)
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

jest.mock("react-globe.gl", () => {
  return {
    __esModule: true,
    default: mockReactGlobe,
  }
})

jest.mock("d3-geo", () => ({
  geoCentroid: () => [0, 0],
}))

describe("InteractiveGlobe", () => {
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
    } as unknown as typeof ResizeObserver
  })

  it("initializes globe controls after the delayed dynamic mount resolves", async () => {
    renderWithQueryClient(
      <InteractiveGlobe
        articles={[]}
        countryMetrics={{
          counts: {},
          total_articles: 0,
          articles_with_country: 0,
          articles_without_country: 0,
          country_count: 0,
        }}
        onCountrySelect={jest.fn()}
        selectedCountry={null}
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
    expect(mockPointOfView).toHaveBeenCalled()
  })
})
