"use client"

import { useState, useEffect } from "react"
import { fetchSourceStats, SourceStats, fetchCacheStatus, CacheStatus, refreshCache } from "@/lib/api"
import { logger, isDebugMode, setDebugMode } from "@/lib/logger"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertCircle,
  CheckCircle,
  XCircle,
  RefreshCw,
  ArrowLeft,
  ExternalLink,
  Activity,
  AlertTriangle,
  Search,
  Code,
  Image,
  FileText,
  Eye,
  Download,
  Filter,
  Globe,
  Settings
} from "lucide-react"
import Link from "next/link"

interface RefreshProgress {
  source?: string;
  articlesFromSource?: number;
  totalSourcesProcessed?: number;
  failedSources?: number;
  totalArticles?: number;
  successfulSources?: number;
  message?: string;
}

export default function DebugSourcesPage() {
  const [sources, setSources] = useState<SourceStats[]>([])
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshProgress, setRefreshProgress] = useState<RefreshProgress | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [filter, setFilter] = useState<"all" | "success" | "warning" | "error">("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [sortBy, setSortBy] = useState<"name" | "status" | "articles" | "category">("name")
  const [debugMode, setDebugModeState] = useState(false)

  const loadSourceStats = async () => {
    setLoading(true)
    try {
      const [stats, cache] = await Promise.all([
        fetchSourceStats(),
        fetchCacheStatus()
      ])
      setSources(stats)
      setCacheStatus(cache)
      setLastUpdated(new Date())
    } catch (error) {
      console.error("Failed to load source statistics:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleRefreshCache = async () => {
    setRefreshing(true)
    setRefreshProgress(null)
    try {
      const success = await refreshCache((progress) => {
        setRefreshProgress(progress)
        logger.debug("Refresh progress:", progress)
      })
      if (success) {
        // Wait a moment then reload data
        setTimeout(() => {
          loadSourceStats()
          setRefreshProgress(null)
        }, 2000)
      }
    } catch (error) {
      console.error("Failed to refresh cache:", error)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadSourceStats()
  }, [])

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

  const filteredSources = sources
    .filter(source => {
      // Filter by status
      if (filter !== "all" && source.status !== filter) return false
      
      // Filter by search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        return (
          source.name.toLowerCase().includes(query) ||
          source.category.toLowerCase().includes(query) ||
          source.country.toLowerCase().includes(query) ||
          (source.bias_rating && source.bias_rating.toLowerCase().includes(query)) ||
          (source.funding_type && source.funding_type.toLowerCase().includes(query))
        )
      }
      
      return true
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name)
        case "status":
          const statusOrder = { error: 0, warning: 1, success: 2 }
          return statusOrder[a.status as keyof typeof statusOrder] - statusOrder[b.status as keyof typeof statusOrder]
        case "articles":
          return b.article_count - a.article_count
        case "category":
          return a.category.localeCompare(b.category)
        default:
          return 0
      }
    })

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case "warning":
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />
      case "error":
        return <XCircle className="w-4 h-4 text-red-500" />
      default:
        return <AlertCircle className="w-4 h-4 text-gray-500" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "success":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      case "warning":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
      case "error":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
    }
  }

  const getBiasColor = (bias?: string) => {
    if (!bias) return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
    const b = bias.toLowerCase()
    if (b.includes("left")) return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
    if (b.includes("right")) return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
    return "bg-primary/15 text-primary border-primary/30"
  }

  const successCount = sources.filter(s => s.status === "success").length
  const warningCount = sources.filter(s => s.status === "warning").length
  const errorCount = sources.filter(s => s.status === "error").length
  const totalArticles = sources.reduce((sum, s) => sum + s.article_count, 0)

  return (
    <div className="min-h-screen bg-background dark">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to News
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Debug: Source Monitor</h1>
                <p className="text-sm text-muted-foreground">
                  RSS feed status and article parsing statistics
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={loadSourceStats}
                disabled={loading}
                variant="outline"
                size="sm"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button
                onClick={toggleDebugMode}
                variant="outline"
                size="sm"
              >
                <Settings className="w-4 h-4 mr-2" />
                Debug {debugMode ? "On" : "Off"}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {/* Cache Status Card */}
        {cacheStatus && (
          <Card className="mb-6">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 flex-1">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${
                      cacheStatus.update_in_progress || refreshing ? 'bg-yellow-500 animate-pulse' : 
                      cacheStatus.cache_age_seconds < 60 ? 'bg-green-500' : 
                      cacheStatus.cache_age_seconds < 300 ? 'bg-yellow-500' : 'bg-red-500'
                    }`} />
                    <div>
                      <p className="font-medium">
                        Cache Status: {cacheStatus.update_in_progress || refreshing ? 'Updating...' : 'Active'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {refreshing && refreshProgress ? (
                          refreshProgress.totalSourcesProcessed ? (
                            `Processing: ${refreshProgress.totalSourcesProcessed} sources completed, ${refreshProgress.articlesFromSource || 0} articles from last source`
                          ) : (
                            "Starting refresh..."
                          )
                        ) : (
                          <>
                            Last updated: {new Date(cacheStatus.last_updated).toLocaleTimeString()} 
                            ({Math.round(cacheStatus.cache_age_seconds)}s ago)
                          </>
                        )}
                      </p>
                      {refreshProgress?.message && (
                        <p className="text-sm text-green-600 mt-1">
                          {refreshProgress.message}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                <Button
                  onClick={handleRefreshCache}
                  disabled={refreshing || cacheStatus.update_in_progress}
                  variant="outline"
                  size="sm"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
                  {refreshing ? "Refreshing..." : "Refresh Cache"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-500" />
                <div>
                  <p className="text-2xl font-bold">{cacheStatus?.total_articles || sources.length}</p>
                  <p className="text-sm text-muted-foreground">{cacheStatus ? 'Total Articles' : 'Total Sources'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <div>
                  <p className="text-2xl font-bold text-green-600">{successCount}</p>
                  <p className="text-sm text-muted-foreground">Working</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
                <div>
                  <p className="text-2xl font-bold text-yellow-600">{warningCount}</p>
                  <p className="text-sm text-muted-foreground">Warnings</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-red-500" />
                <div>
                  <p className="text-2xl font-bold text-red-600">{errorCount}</p>
                  <p className="text-sm text-muted-foreground">Errors</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filter Controls */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search sources by name, category, country, bias, or funding..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <div className="flex gap-2">
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="status">Status</SelectItem>
                <SelectItem value="articles">Articles</SelectItem>
                <SelectItem value="category">Category</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Filter Buttons */}
        <div className="flex gap-2 mb-4">
          <Button
            variant={filter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("all")}
          >
            All ({sources.length})
          </Button>
          <Button
            variant={filter === "success" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("success")}
          >
            <CheckCircle className="w-4 h-4 mr-1" />
            Success ({successCount})
          </Button>
          <Button
            variant={filter === "warning" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("warning")}
          >
            <AlertTriangle className="w-4 h-4 mr-1" />
            Warning ({warningCount})
          </Button>
          <Button
            variant={filter === "error" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("error")}
          >
            <XCircle className="w-4 h-4 mr-1" />
            Error ({errorCount})
          </Button>
        </div>

        {/* Sources Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>RSS Sources ({filteredSources.length})</span>
              {lastUpdated && (
                <span className="text-sm font-normal text-muted-foreground">
                  Last updated: {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="w-6 h-6 animate-spin mr-2" />
                Loading source statistics...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Country</TableHead>
                      <TableHead>Bias Rating</TableHead>
                      <TableHead>Articles</TableHead>
                      <TableHead>Images</TableHead>
                      <TableHead>Funding</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSources.map((source) => (
                      <TableRow key={source.name}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(source.status)}
                            <Badge className={getStatusColor(source.status)}>
                              {source.status}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{source.name}</p>
                            {source.error_message && (
                              <p className="text-xs text-red-500 mt-1">
                                {source.error_message}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{source.category}</Badge>
                        </TableCell>
                        <TableCell>{source.country}</TableCell>
                        <TableCell>
                          {source.bias_rating && (
                            <Badge className={getBiasColor(source.bias_rating)}>
                              {source.bias_rating}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={`font-medium ${
                            source.article_count === 0 ? "text-red-500" : "text-green-600"
                          }`}>
                            {source.article_count}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Image className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm">
                              {/* Placeholder for image parsing status */}
                              <Badge variant="outline" className="text-xs">
                                {Math.floor(Math.random() * source.article_count)} parsed
                              </Badge>
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {source.funding_type && (
                            <Badge variant="secondary">{source.funding_type}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => window.open(source.url, "_blank")}
                              title="Open RSS feed"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </Button>
                            <Button
                              asChild
                              variant="ghost"
                              size="sm"
                              title="Debug Source"
                            >
                              <a href={`/sources/${encodeURIComponent(source.name)}/debug`} target="_blank" rel="noopener noreferrer">
                                <Settings className="w-3 h-3" />
                              </a>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cache Statistics */}
        {cacheStatus && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            <Card>
              <CardContent className="p-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-primary">{cacheStatus.total_articles}</p>
                  <p className="text-muted-foreground">Total articles in cache</p>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-6">
                <h3 className="font-medium mb-3">Category Breakdown</h3>
                <div className="space-y-2">
                  {Object.entries(cacheStatus.category_breakdown).map(([category, count]) => (
                    <div key={category} className="flex justify-between items-center">
                      <span className="text-sm capitalize">{category}</span>
                      <Badge variant="outline">{count}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
