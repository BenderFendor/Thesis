"use client"

import { useState, useEffect } from "react"
import { fetchSourceStats, SourceStats } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  AlertTriangle
} from "lucide-react"
import Link from "next/link"

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceStats[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [filter, setFilter] = useState<"all" | "success" | "warning" | "error">("all")

  const loadSourceStats = async () => {
    setLoading(true)
    try {
      const stats = await fetchSourceStats()
      setSources(stats)
      setLastUpdated(new Date())
    } catch (error) {
      console.error("Failed to load source statistics:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSourceStats()
  }, [])

  const filteredSources = sources.filter(source => {
    if (filter === "all") return true
    return source.status === filter
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
    return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
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
                <h1 className="text-2xl font-bold text-foreground">Source Monitor</h1>
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
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-500" />
                <div>
                  <p className="text-2xl font-bold">{sources.length}</p>
                  <p className="text-sm text-muted-foreground">Total Sources</p>
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
                            >
                              <ExternalLink className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                console.log("RSS URL:", source.url)
                                console.log("Full source data:", source)
                              }}
                            >
                              Log
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

        {/* Total Articles Summary */}
        <Card className="mt-6">
          <CardContent className="p-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-primary">{totalArticles}</p>
              <p className="text-muted-foreground">Total articles parsed across all sources</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
