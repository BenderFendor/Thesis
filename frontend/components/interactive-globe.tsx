"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import type { GlobeMethods } from "react-globe.gl"
import type { CountryArticleCounts, NewsArticle } from "@/lib/api"

const Globe = dynamic(() => import("react-globe.gl").then((mod) => mod.default), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
    </div>
  ),
})

interface InteractiveGlobeProps {
  articles: NewsArticle[]
  countryMetrics?: CountryArticleCounts
  onCountrySelect: (countryCode: string | null, countryName?: string | null) => void
  selectedCountry: string | null
}

interface CountryFeatureProperties {
  ISO_A2?: string
  NAME?: string
  [key: string]: unknown
}

interface CountryFeature {
  properties: CountryFeatureProperties
  geometry?: { coordinates?: unknown } | null
}

interface CountryFeatureCollection {
  features: CountryFeature[]
}

function getFeatureCenter(geometry?: { coordinates?: unknown } | null) {
  if (!geometry || !geometry.coordinates) return null
  const coords: Array<[number, number]> = []

  const collect = (input: unknown) => {
    if (!Array.isArray(input)) return
    if (typeof input[0] === "number" && typeof input[1] === "number") {
      coords.push([input[0], input[1]])
      return
    }
    input.forEach(collect)
  }

  collect(geometry.coordinates)

  if (coords.length === 0) return null

  let minLng = coords[0][0]
  let maxLng = coords[0][0]
  let minLat = coords[0][1]
  let maxLat = coords[0][1]

  coords.forEach(([lng, lat]) => {
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
  })

  return {
    lng: (minLng + maxLng) / 2,
    lat: (minLat + maxLat) / 2,
  }
}

function toCountryFeature(polygon: object | null): CountryFeature | null {
  if (!polygon || typeof polygon !== "object") return null
  if (!("properties" in polygon)) return null
  const feature = polygon as CountryFeature
  if (!feature.properties || typeof feature.properties !== "object") return null
  return feature
}

function heatColor(count: number, maxCount: number) {
  if (count <= 0 || maxCount <= 0) return "rgba(255, 255, 255, 0.03)"
  const ratio = Math.min(1, count / maxCount)
  const alpha = 0.12 + ratio * 0.72
  return `rgba(233, 118, 43, ${alpha.toFixed(2)})`
}

export function InteractiveGlobe({
  articles,
  countryMetrics,
  onCountrySelect,
  selectedCountry,
}: InteractiveGlobeProps) {
  const globeEl = useRef<GlobeMethods | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [countries, setCountries] = useState<CountryFeatureCollection>({ features: [] })
  const [hoverD, setHoverD] = useState<CountryFeature | null>(null)

  useEffect(() => {
    fetch("https://raw.githubusercontent.com/vasturiano/react-globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson")
      .then((res) => res.json())
      .then((data: unknown) => {
        if (
          typeof data === "object" &&
          data !== null &&
          Array.isArray((data as { features?: unknown }).features)
        ) {
          setCountries({ features: (data as { features: CountryFeature[] }).features })
        }
      })
      .catch(() => {
        setCountries({ features: [] })
      })
  }, [])

  const fallbackSourceCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    articles.forEach((article) => {
      if (!article.country) return
      counts[article.country] = (counts[article.country] || 0) + 1
    })
    return counts
  }, [articles])

  const displayCounts = countryMetrics?.counts && Object.keys(countryMetrics.counts).length > 0
    ? countryMetrics.counts
    : fallbackSourceCounts

  const maxCount = useMemo(() => {
    const values = Object.values(displayCounts)
    return values.length > 0 ? Math.max(...values) : 0
  }, [displayCounts])

  const countryCenters = useMemo(() => {
    const centers: Record<string, { lat: number; lng: number }> = {}
    countries.features.forEach((feature) => {
      const iso = feature?.properties?.ISO_A2
      if (!iso) return
      const center = getFeatureCenter(feature.geometry)
      if (center) {
        centers[iso] = center
      }
    })
    return centers
  }, [countries])

  useEffect(() => {
    if (!globeEl.current) return
    const controls = globeEl.current.controls() as {
      autoRotate?: boolean
      autoRotateSpeed?: number
      enableZoom?: boolean
      enablePan?: boolean
    }
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.5
    controls.enableZoom = false
    controls.enablePan = false
    globeEl.current.pointOfView({ altitude: 2.5 })
  }, [])

  useEffect(() => {
    if (!globeEl.current) return
    const controls = globeEl.current.controls() as { autoRotate?: boolean }
    if (!selectedCountry) {
      controls.autoRotate = true
      globeEl.current.pointOfView({ altitude: 2.5 }, 900)
      return
    }

    const center = countryCenters[selectedCountry]
    controls.autoRotate = false
    if (center) {
      globeEl.current.pointOfView({ lat: center.lat, lng: center.lng, altitude: 1.5 }, 900)
    }
  }, [countryCenters, selectedCountry])

  useEffect(() => {
    if (!containerRef.current) return
    const element = containerRef.current
    const updateSize = () => {
      const rect = element.getBoundingClientRect()
      setDimensions({
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      })
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[var(--news-bg-primary)]">
      <Globe
        ref={globeEl}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundImageUrl={null}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor="#e9762b"
        atmosphereAltitude={0.12}
        lineHoverPrecision={0}
        polygonsData={countries.features.filter((feature) => feature.properties.ISO_A2 !== "AQ")}
        polygonAltitude={(polygon: object) => {
          const feature = toCountryFeature(polygon)
          if (!feature) return 0.01
          return feature === hoverD ? 0.12 : selectedCountry === feature.properties.ISO_A2 ? 0.08 : 0.01
        }}
        polygonCapColor={(polygon: object) => {
          const feature = toCountryFeature(polygon)
          if (!feature) return "rgba(255, 255, 255, 0.03)"
          const iso = feature.properties.ISO_A2 ?? ""
          const count = iso ? displayCounts[iso] || 0 : 0

          if (feature === hoverD) return "rgba(255, 255, 255, 0.2)"
          if (selectedCountry === iso) return "#e9762b"

          return heatColor(count, maxCount)
        }}
        polygonSideColor={() => "rgba(255, 255, 255, 0.05)"}
        polygonStrokeColor={() => "rgba(255, 255, 255, 0.08)"}
        polygonLabel={(polygon: object) => {
          const feature = toCountryFeature(polygon)
          if (!feature) return ""
          const d = feature.properties
          const iso = d.ISO_A2 ?? "--"
          const coverageCount = d.ISO_A2 ? displayCounts[d.ISO_A2] || 0 : 0
          const originCount = d.ISO_A2 ? countryMetrics?.source_counts?.[d.ISO_A2] || fallbackSourceCounts[d.ISO_A2] || 0 : 0
          return `
          <div style="background: rgba(10,10,10,0.92); color: #EAEAEA; padding: 12px; border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 20px 40px rgba(0,0,0,0.35); min-width: 180px;">
            <p style="margin: 0; font-family: var(--font-instrument-serif); font-size: 16px; color: #e9762b;">${d.NAME}</p>
            <p style="margin: 8px 0 0; font-family: var(--font-geist-mono, monospace); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(234,234,234,0.65);">
              ISO ${iso}
            </p>
            <p style="margin: 8px 0 0; font-size: 12px; color: rgba(234,234,234,0.82);">
              Coverage heat: ${coverageCount}
            </p>
            <p style="margin: 4px 0 0; font-size: 12px; color: rgba(234,234,234,0.82);">
              Local outlets: ${originCount}
            </p>
          </div>
        `
        }}
        onPolygonHover={(polygon: object | null) => setHoverD(toCountryFeature(polygon))}
        onPolygonClick={(polygon: object) => {
          const feature = toCountryFeature(polygon)
          if (!feature) return
          const iso = feature.properties.ISO_A2
          if (!iso) return
          const name = feature.properties.NAME
          if (selectedCountry === iso) {
            onCountrySelect(null, null)
          } else {
            onCountrySelect(iso, name)
          }
        }}
        width={dimensions.width}
        height={dimensions.height}
      />
    </div>
  )
}
