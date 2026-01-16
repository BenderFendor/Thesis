"use client"

import { useState, useEffect } from "react"
import { fetchSourceDebugData, SourceDebugData } from "@/lib/api"
import { isDebugMode, setDebugMode } from "@/lib/logger"
import { ArrowLeft, RefreshCw, Code, ExternalLink, AlertTriangle, CheckCircle, Image, FileText, Globe, Search, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import JsonView from 'react18-json-view'
import 'react18-json-view/src/style.css'

export default async function SourceDebugPage(props: { params: Promise<{ source: string }> }) {
  const params = await props.params
  const sourceName = decodeURIComponent(params.source)
  const [debugData, setDebugData] = useState<SourceDebugData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [debugMode, setDebugModeState] = useState(false)

  const loadDebugData = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchSourceDebugData(sourceName)
      setDebugData(data)
    } catch (err) {
      setError("Failed to load debug data. The source might be unavailable or the backend service is down.")
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDebugData()
  }, [sourceName])

  useEffect(() => {
    setDebugModeState(isDebugMode())
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "thesis_debug_mode") {
        setDebugModeState(isDebugMode())
      }
    }
    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [])

  const toggleDebugMode = () => {
    const next = !debugMode
    setDebugMode(next)
    setDebugModeState(next)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background dark">
        <div className="flex items-center gap-3 text-lg">
          <RefreshCw className="w-6 h-6 animate-spin" />
          <span>Loading debug data for {sourceName}...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background dark text-red-500">
        <AlertTriangle className="w-12 h-12 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Error</h1>
        <p className="text-center max-w-md">{error}</p>
        <Button onClick={loadDebugData} className="mt-6">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  if (!debugData) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background dark">
        <p>No debug data available for {sourceName}.</p>
      </div>
    )
  }

  const filteredDebugData = () => {
    if (!searchQuery) {
      return debugData
    }
    const lowercasedQuery = searchQuery.toLowerCase()
    const filtered = JSON.parse(JSON.stringify(debugData))

  const filterObject = (obj: any): any => {
      if (Array.isArray(obj)) {
        return obj.filter(item => filterObject(item) !== null)
      }
      if (typeof obj === 'object' && obj !== null) {
        let hasMatch = false
        const newObj: any = {}
        for (const key in obj) {
          if (key.toLowerCase().includes(lowercasedQuery)) {
            hasMatch = true
            newObj[key] = obj[key]
          } else if (typeof obj[key] === 'string' && obj[key].toLowerCase().includes(lowercasedQuery)) {
            hasMatch = true
            newObj[key] = obj[key]
          } else {
            const result = filterObject(obj[key])
            if (result !== null && (typeof result !== 'object' || Object.keys(result).length > 0)) {
              hasMatch = true
              newObj[key] = result
            }
          }
        }
        return hasMatch ? newObj : null
      }
      return null
    }

    return filterObject(filtered)
  }

  return (
    <div className="min-h-screen bg-background dark text-foreground p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/sources">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">
                Debug: <span className="text-primary">{debugData.source_name}</span>
              </h1>
              <p className="text-sm text-muted-foreground">
                Raw RSS feed data and parsing analysis.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(debugData.rss_url, "_blank")}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open RSS Feed
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleDebugMode}
            >
              <Settings className="w-4 h-4 mr-2" />
              Debug {debugMode ? "On" : "Off"}
            </Button>
            <Button onClick={loadDebugData} size="sm">
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="space-y-6">
        <details open>
          <summary className="cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="w-5 h-5" />
                Feed Overview
              </CardTitle>
            </CardHeader>
          </summary>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold">{debugData.feed_status?.http_status || 'N/A'}</p>
                <p className="text-xs text-muted-foreground">HTTP Status</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{debugData.feed_status?.entries_count || 0}</p>
                <p className="text-xs text-muted-foreground">RSS Entries</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{debugData.cached_articles?.length || 0}</p>
                <p className="text-xs text-muted-foreground">Cached Articles</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{debugData.image_analysis?.entries_with_images || 0}</p>
                <p className="text-xs text-muted-foreground">With Images</p>
              </div>
            </div>
            {(debugData.feed_status?.bozo || debugData.error) && (
              <div className="mt-4 p-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-1" />
                  <div>
                    <h4 className="font-semibold text-yellow-800 dark:text-yellow-200">Feed Issue Detected</h4>
                    {debugData.feed_status?.bozo && (
                      <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                        <strong>Bozo Feed:</strong> {debugData.feed_status.bozo_exception}
                      </p>
                    )}
                    {debugData.error && (
                      <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                        <strong>Processing Error:</strong> {debugData.error}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </details>

        {debugData.source_statistics?.is_consolidated && debugData.source_statistics?.sub_feeds && debugData.source_statistics.sub_feeds.length > 0 && (
          <details open>
            <summary className="cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="w-5 h-5" />
                  Sub-Feeds ({debugData.source_statistics.sub_feeds.length})
                </CardTitle>
              </CardHeader>
            </summary>
            <CardContent>
              <div className="space-y-3">
                {debugData.source_statistics.sub_feeds.map((subFeed, idx) => (
                  <div key={idx} className="border border-muted rounded-lg p-3">
                    <div className="flex items-start justify-between mb-2">
                      <a
                        href={subFeed.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-mono text-blue-400 hover:underline truncate"
                      >
                        {subFeed.url}
                      </a>
                      <Badge
                        variant={subFeed.status === "success" ? "default" : "secondary"}
                      >
                        {subFeed.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {subFeed.article_count} articles
                      {subFeed.error && ` • Error: ${subFeed.error}`}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </details>
        )}

        {debugData.image_analysis && (
          <details>
            <summary className="cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Image className="w-5 h-5" />
                  Image Parsing Analysis
                </CardTitle>
              </CardHeader>
            </summary>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm">Images found in entries:</span>
                  <Badge>{debugData.image_analysis.entries_with_images || 0} / {debugData.image_analysis.total_entries || 0}</Badge>
                </div>
                <div className="w-full bg-muted rounded-full h-2.5">
                  <div 
                    className="bg-primary h-2.5 rounded-full" 
                    style={{
                      width: `${(debugData.image_analysis.total_entries || 0) > 0 
                        ? ((debugData.image_analysis.entries_with_images || 0) / (debugData.image_analysis.total_entries || 1)) * 100 
                        : 0}%` 
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  {Math.round(((debugData.image_analysis.entries_with_images || 0) / (debugData.image_analysis.total_entries || 1)) * 100)}% of entries have images.
                </p>
              </div>
            </CardContent>
          </details>
        )}

        {debugData.parsed_entries && debugData.parsed_entries.length > 0 && (
          <details>
            <summary className="cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Sample Parsed Entries (First 5)
                </CardTitle>
              </CardHeader>
            </summary>
            <CardContent>
              <div className="space-y-4">
                {debugData.parsed_entries.slice(0, 5).map((entry, index) => (
                  <div key={index} className="border border-muted rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-semibold text-base line-clamp-2">{entry.title}</h4>
                      <div className="flex gap-2 ml-2 flex-shrink-0">
                        {entry.has_images && <Badge variant="secondary" className="text-xs">Has Images</Badge>}
                        <Badge variant="outline" className="text-xs">#{entry.index + 1}</Badge>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-3">{entry.description}</p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Published: {entry.published}</span>
                      <span>Author: {entry.author || 'N/A'}</span>
                    </div>
                    {entry.has_images && (
                      <div className="mt-3 pt-3 border-t border-muted">
                        <div className="text-xs font-medium text-foreground mb-2">Images found in:</div>
                        <div className="flex flex-wrap gap-2">
                          {entry.content_images.length > 0 && <Badge variant="outline">Content ({entry.content_images.length})</Badge>}
                          {entry.description_images.length > 0 && <Badge variant="outline">Description ({entry.description_images.length})</Badge>}
                          {entry.image_sources.length > 0 && <Badge variant="outline">Metadata ({entry.image_sources.length})</Badge>}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </details>
        )}

        <details open>
          <summary className="cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Code className="w-5 h-5" />
                  Complete Debug JSON
                </span>
              </CardTitle>
            </CardHeader>
          </summary>
          <CardContent>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search JSON..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <JsonView 
              src={filteredDebugData() || {}} 
              collapsed={2}
              enableClipboard={true}
              theme="vscode"
            />
          </CardContent>
        </details>
      </main>
    </div>
  )
}
