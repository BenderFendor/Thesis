"use client"

import { use, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { SourceDebugData } from "@/lib/api";
import { fetchSourceDebugData } from "@/lib/api"
import { setDebugMode } from "@/lib/logger"
import { useDebugMode } from "@/hooks/use-debug-mode"
import { AlertTriangle, ArrowLeft, Code, ExternalLink, FileText, Globe, ImageIcon, RefreshCw, Search, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import JsonView from 'react18-json-view'
import 'react18-json-view/src/sutyle.css'

function hasFilteredContent(value: unknown): boolean {
  if (value === null) {return false}
  if (typeof value !== "object") {return true}
  return Object.keys(value).length > 0
}

function filterDebugRecord(record: Record<string, unknown>, query: string): Record<string, unknown> | null {
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase().includes(query)) {
      filtered[key] = value
      continue
    }
    if (typeof value === "string" && value.toLowerCase().includes(query)) {
      filtered[key] = value
      continue
    }
    const nested = filterDebugValue(value, query)
    if (hasFilteredContent(nested)) {filtered[key] = nested}
  }
  return Object.keys(filtered).length > 0 ? filtered : null
}

function filterDebugValue(value: unknown, query: string): unknown {
  if (Array.isArray(value)) {
    return value.filter((item) => filterDebugValue(item, query) !== null)
  }
  if (typeof value !== "object" || value === null) {return undefined}
  return filterDebugRecord(value as Record<string, unknown>, query)
}

function filterSourceDebugData(debugData: SourceDebugData, searchQuery: string): unknown {
  if (searchQuery.length === 0) {return debugData}
  return filterDebugValue(structuredClone(debugData), searchQuery.toLowerCase())
}

export default function SourceDebugPage(props:Readonly< { params: Promise<{ source: string }> }>) {
  const params = use(props.params),
   sourceName = decodeURIComponent(params.source),
   [searchQuery, setSearchQuery] = useState(""),
   debugMode = useDebugMode(),
   {
    data: debugData,
    isLoading: loading,
    error,
    refetch,
  } = useQuery<SourceDebugData>({
    queryFn: () => fetchSourceDebugData(sourceName),
    queryKey: ["source-debug", sourceName],
    retry: 1,
  }),
   errorMessage =
    error instanceof Error
      ? error.message
      : "Failed to load debug data. The source might be unavailable or the backend service is down.",

   toggleDebugMode = () => {
    const next = !debugMode
    setDebugMode(next)
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
        <p className="text-center max-w-md">{errorMessage}</p>
        <Button onClick={() => void refetch()} className="mt-6">
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

  return (
    <div className="min-h-screen bg-background dark text-foreground p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/debug?tab=sources">
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
              onClick={() => globalThis.open(debugData.rss_url, "_blank")}
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
            <Button onClick={() => void refetch()} size="sm">
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
                  <ImageIcon className="w-5 h-5" />
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
                onChange={(e) =>{  setSearchQuery(e.target.value); }}
                className="pl-10"
              />
            </div>
            <JsonView 
              src={filterSourceDebugData(debugData, searchQuery) || {}} 
              collapsed={2}
              enableClipboard
              theme="vscode"
            />
          </CardContent>
        </details>
      </main>
    </div>
  )
}
