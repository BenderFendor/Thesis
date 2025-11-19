"use client"

import { useEffect, useState, useMemo, useRef } from "react"
import dynamic from "next/dynamic"
import { scaleSequential } from "d3-scale"
import { interpolateReds } from "d3-scale-chromatic"
import { NewsArticle } from "@/lib/api"
import { useTheme } from "next-themes"

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
  const [countries, setCountries] = useState({ features: [] })
  const [hoverD, setHoverD] = useState<any | null>(null)
  const { theme } = useTheme()
  const isDark = theme === "dark"

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

  // Color scale for heatmap
  const colorScale = useMemo(() => {
    const maxCount = Math.max(...Object.values(countryCounts), 0)
    return scaleSequential(interpolateReds).domain([0, maxCount || 1]) // Avoid division by zero
  }, [countryCounts])

  // Auto-rotate
  useEffect(() => {
    if (globeEl.current) {
      globeEl.current.controls().autoRotate = true
      globeEl.current.controls().autoRotateSpeed = 0.5
      globeEl.current.pointOfView({ altitude: 2.5 })
    }
  }, [])

  return (
    <div className="h-full w-full relative overflow-hidden rounded-lg bg-background">
      <Globe
        ref={globeEl}
        globeImageUrl={isDark ? "//unpkg.com/three-globe/example/img/earth-dark.jpg" : "//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"}
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundImageUrl={isDark ? "//unpkg.com/three-globe/example/img/night-sky.png" : "//unpkg.com/three-globe/example/img/night-sky.png"}
        lineHoverPrecision={0}
        polygonsData={countries.features.filter((d: any) => d.properties.ISO_A2 !== "AQ")} // Exclude Antarctica
        polygonAltitude={(d: any) => (d === hoverD ? 0.12 : selectedCountry === d.properties.ISO_A2 ? 0.06 : 0.01)}
        polygonCapColor={(d: any) => {
          const iso = d.properties.ISO_A2
          const count = countryCounts[iso] || 0
          
          if (d === hoverD) return "rgba(255, 255, 255, 0.3)"
          if (selectedCountry === iso) return "rgba(16, 185, 129, 0.6)" // Green for selected
          
          // Heatmap color if articles exist, otherwise transparent/default
          return count > 0 ? colorScale(count) : "rgba(200, 200, 200, 0.1)"
        }}
        polygonSideColor={() => "rgba(0, 0, 0, 0.1)"}
        polygonStrokeColor={() => "#111"}
        polygonLabel={({ properties: d }: any) => `
          <div class="bg-background/90 text-foreground p-2 rounded border shadow-sm text-xs">
            <b>${d.NAME}</b> (${d.ISO_A2}) <br />
            Articles: ${countryCounts[d.ISO_A2] || 0}
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
        width={undefined} // Let it take container width
        height={undefined} // Let it take container height
      />
      
      {/* Legend / Info Overlay */}
      <div className="absolute bottom-4 left-4 bg-background/80 backdrop-blur p-3 rounded-lg border shadow-sm text-xs z-10">
        <h3 className="font-semibold mb-2">Global News Intensity</h3>
        <div className="flex items-center gap-2">
            <div className="w-20 h-2 bg-gradient-to-r from-red-100 to-red-900 rounded"></div>
            <span>High Volume</span>
        </div>
        <div className="mt-2 text-muted-foreground">
            Click a country to filter
        </div>
        {selectedCountry && (
            <div className="mt-2 pt-2 border-t">
                Selected: <span className="font-bold text-primary">{selectedCountry}</span>
                <button 
                    onClick={() => onCountrySelect(null, null)}
                    className="ml-2 text-xs underline hover:text-primary"
                >
                    Clear
                </button>
            </div>
        )}
      </div>
    </div>
  )
}
