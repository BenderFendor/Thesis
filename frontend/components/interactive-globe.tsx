"use client"

import { useEffect, useState, useMemo, useRef } from "react"
import dynamic from "next/dynamic"
import { scaleSequential } from "d3-scale"
import { interpolateBuGn } from "d3-scale-chromatic"
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

  // Color scale for heatmap - Blue/Green scale is friendlier than Red
  const colorScale = useMemo(() => {
    const maxCount = Math.max(...Object.values(countryCounts), 0)
    return scaleSequential(interpolateBuGn).domain([0, maxCount || 1]) 
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
    <div className="h-full w-full relative overflow-hidden rounded-lg bg-gradient-to-b from-slate-950 to-slate-900">
      <Globe
        ref={globeEl}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundImageUrl={null} // Remove space background for cleaner look
        backgroundColor="rgba(0,0,0,0)" // Transparent to show gradient
        atmosphereColor="#7dd3fc" // Light blue atmosphere
        atmosphereAltitude={0.15}
        lineHoverPrecision={0}
        polygonsData={countries.features.filter((d: any) => d.properties.ISO_A2 !== "AQ")} // Exclude Antarctica
        polygonAltitude={(d: any) => (d === hoverD ? 0.12 : selectedCountry === d.properties.ISO_A2 ? 0.06 : 0.01)}
        polygonCapColor={(d: any) => {
          const iso = d.properties.ISO_A2
          const count = countryCounts[iso] || 0
          
          if (d === hoverD) return "rgba(255, 255, 255, 0.3)"
          if (selectedCountry === iso) return "rgba(16, 185, 129, 0.8)" // Green for selected
          
          // Heatmap color if articles exist, otherwise transparent/default
          return count > 0 ? String(colorScale(count)) : "rgba(255, 255, 255, 0.05)"
        }}
        polygonSideColor={() => "rgba(255, 255, 255, 0.05)"}
        polygonStrokeColor={() => "rgba(255, 255, 255, 0.1)"}
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
      <div className="absolute bottom-4 left-4 bg-background/60 backdrop-blur-md p-4 rounded-xl border border-white/10 shadow-lg text-xs z-10">
        <h3 className="font-semibold mb-2 text-foreground">News Intensity</h3>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Low</span>
            <div className="w-24 h-2 bg-gradient-to-r from-emerald-50 to-emerald-900 rounded-full"></div>
            <span className="text-[10px] text-muted-foreground">High</span>
        </div>
        <div className="mt-3 text-muted-foreground">
            Click a country to filter
        </div>
        {selectedCountry && (
            <div className="mt-3 pt-3 border-t border-white/10">
                <div className="flex justify-between items-center">
                    <span>Selected: <span className="font-bold text-primary">{selectedCountry}</span></span>
                    <button 
                        onClick={() => onCountrySelect(null, null)}
                        className="text-xs bg-primary/10 hover:bg-primary/20 text-primary px-2 py-1 rounded transition-colors"
                    >
                        Clear
                    </button>
                </div>
            </div>
        )}
      </div>
    </div>
  )
}
