"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ExternalLink, MapPin, DollarSign, Globe, AlertCircle } from "lucide-react"
import { getSourceById, fetchSources, type NewsSource } from "@/lib/api"
import SourceDebug from "@/components/source-debug"

interface SourceInfoModalProps {
  sourceId: string
  children: React.ReactNode
}

export function SourceInfoModal({ sourceId, children }: SourceInfoModalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [source, setSource] = useState<NewsSource | null>(null)
  const [loading, setLoading] = useState(false)
  const [debugSource, setDebugSource] = useState<NewsSource | null>(null)
  const [showDebug, setShowDebug] = useState(false)

  useEffect(() => {
    const loadSource = async () => {
      if (!isOpen || !sourceId) return
      setLoading(true)
      try {
        const fetchedSource = await getSourceById(sourceId)
        setSource(fetchedSource || null)
      } catch (error) {
        console.error('Failed to load source:', error)
        setSource(null)
      } finally {
        setLoading(false)
      }
    }
    loadSource()
  }, [isOpen, sourceId])

  // Debug: fetch all sources and show the raw object for this sourceId
  const handleDebugView = async () => {
    setShowDebug(true)
    setLoading(true)
    try {
      const allSources = await fetchSources()
      const found = allSources.find((s) => s.id === sourceId)
      setDebugSource(found || null)
    } catch (e) {
      setDebugSource(null)
    } finally {
      setLoading(false)
    }
  }

  if (!source) return <>{children}</>

  const getBiasColor = (bias: string) => {
    switch (bias) {
      case "left":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
      case "right":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
      case "center":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
    }
  }

  const getCredibilityColor = (credibility: string) => {
    switch (credibility) {
      case "high":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
      case "medium":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
      case "low":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Source Information: {source?.name || 'Loading...'}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        )}

        {!loading && showDebug && (
          <div className="p-4">
            <SourceDebug data={debugSource} />
          </div>
        )}

        {!loading && !showDebug && !source && (
          <div className="text-center p-8">
            <p className="text-muted-foreground">Source information not available</p>
          </div>
        )}

        {!loading && !showDebug && source && (
          <div className="space-y-6">
            {/* ...existing info cards and actions... */}
            <Card>
              <CardContent className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Country:</span>
                      <span className="text-sm">{source.country}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Language:</span>
                      <span className="text-sm uppercase">{source.language}</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Credibility:</span>
                      <Badge className={getCredibilityColor(source.credibility)}>{source.credibility}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Bias:</span>
                      <Badge className={getBiasColor(source.bias)}>{source.bias}</Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            {/* ...other info cards... */}
            <div className="flex gap-2">
              <Button asChild className="flex-1">
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Visit Website
                </a>
              </Button>
              <Button variant="outline" className="flex-1 bg-transparent">
                Subscribe to RSS
              </Button>
              <Button variant="secondary" className="flex-1" onClick={handleDebugView}>
                View Detail (Debug)
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
