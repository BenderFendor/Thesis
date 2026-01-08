"use client"

import { useEffect, useState, useMemo, useRef } from "react"
import dynamic from "next/dynamic"
import { NewsArticle } from "@/lib/api"

// Dynamically import Globe with no SSR
const Globe = dynamic(() => import("react-globe.gl"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  ),
})

interface InteractiveGlobeProps {
  articles: NewsArticle[]
  onCountrySelect: (countryCode: string | null, countryName?: string | null) => void
  selectedCountry: string | null
}

export function InteractiveGlobe({ articles, onCountrySelect, selectedCountry }: InteractiveGlobeProps) {
  const globeEl = useRef<any>()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [countries, setCountries] = useState({ features: [] })
  const [hoverD, setHoverD] = useState<any | null>(null)

  const getFeatureCenter = (geometry: any) => {
    if (!geometry || !geometry.coordinates) return null
    const coords: Array<[number, number]> = []

    const collect = (input: any) => {
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

  // Fetch countries GeoJSON
  useEffect(() => {
    fetch("https://raw.githubusercontent.com/vasturiano/react-globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson")
      .then((res) => res.json())
      .then(setCountries)
  }, [])

  // Calculate article counts per country
  const countryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    articles.forEach((article) => {
      if (article.country) {
        counts[article.country] = (counts[article.country] || 0) + 1
      }
    })
    return counts
  }, [articles])

  const countryCenters = useMemo(() => {
    const centers: Record<string, { lat: number; lng: number }> = {}
    countries.features.forEach((feature: any) => {
      const iso = feature?.properties?.ISO_A2
      if (!iso) return
      const center = getFeatureCenter(feature.geometry)
      if (center) {
        centers[iso] = center
      }
    })
    return centers
  }, [countries])

  // Auto-rotate
  useEffect(() => {
    if (globeEl.current) {
      globeEl.current.controls().autoRotate = true
      globeEl.current.controls().autoRotateSpeed = 0.5
      globeEl.current.pointOfView({ altitude: 2.5 })
    }
  }, [])

  useEffect(() => {
    if (!globeEl.current) return
    const controls = globeEl.current.controls()
    if (!selectedCountry) {
      controls.autoRotate = true
      globeEl.current.pointOfView({ altitude: 2.5 }, 900)
      return
    }
    const center = countryCenters[selectedCountry]
    controls.autoRotate = false
    if (center) {
      globeEl.current.pointOfView(
        { lat: center.lat, lng: center.lng, altitude: 1.6 },
        900
      )
    }
  }, [selectedCountry, countryCenters])

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
    <div
      ref={containerRef}
      className="h-full w-full relative overflow-hidden bg-[var(--news-bg-primary)]"
    >
      <Globe
        ref={globeEl}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundImageUrl={null}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor="#e9762b"
        atmosphereAltitude={0.12}
        lineHoverPrecision={0}
        polygonsData={countries.features.filter((d: any) => d.properties.ISO_A2 !== "AQ")}
        polygonAltitude={(d: any) => (d === hoverD ? 0.12 : selectedCountry === d.properties.ISO_A2 ? 0.08 : 0.01)}
        polygonCapColor={(d: any) => {
          const iso = d.properties.ISO_A2
          const count = countryCounts[iso] || 0
          
          if (d === hoverD) return "rgba(255, 255, 255, 0.2)"
          if (selectedCountry === iso) return "#e9762b"
          
          return count > 0 ? "rgba(233, 118, 43, 0.4)" : "rgba(255, 255, 255, 0.03)"
        }}
        polygonSideColor={() => "rgba(255, 255, 255, 0.05)"}
        polygonStrokeColor={() => "rgba(255, 255, 255, 0.08)"}
        polygonLabel={({ properties: d }: any) => `
          <div class="bg-[var(--news-bg-secondary)]/90 text-foreground p-3 rounded-lg border border-border/60 shadow-2xl backdrop-blur-md">
            <p class="font-serif italic text-base text-primary">${d.NAME}</p>
            <p class="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground mt-1">
              ISO: ${d.ISO_A2} · ${countryCounts[d.ISO_A2] || 0} Articles
            </p>
          </div>
        `}
        onPolygonHover={setHoverD}
        onPolygonClick={(d: any) => {
          const iso = d.properties.ISO_A2
          const name = d.properties.NAME
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
