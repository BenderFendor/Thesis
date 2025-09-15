"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ExternalLink, MapPin, DollarSign, Globe, AlertCircle } from "lucide-react"
import { getSourceById, type NewsSource } from "@/lib/api"

interface SourceInfoModalProps {
  sourceId: string
  children: React.ReactNode
}

export function SourceInfoModal({ sourceId, children }: SourceInfoModalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [source, setSource] = useState<NewsSource | null>(null)
  const [loading, setLoading] = useState(false)

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

        {!loading && !source && (
          <div className="text-center p-8">
            <p className="text-muted-foreground">Source information not available</p>
          </div>
        )}

        {!loading && source && (

        <div className="space-y-6">
          {/* Basic Info */}
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

          {/* Categories */}
          <Card>
            <CardContent className="p-4">
              <h4 className="font-semibold text-sm mb-3">Coverage Areas</h4>
              <div className="flex flex-wrap gap-2">
                {source.category.map((cat) => (
                  <Badge key={cat} variant="outline" className="text-xs">
                    {cat}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Funding */}
          <Card>
            <CardContent className="p-4">
              <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Funding Sources
              </h4>
              <div className="space-y-2">
                {source.funding.map((fund, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-primary rounded-full" />
                    <span className="text-sm">{fund}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* RSS Feed Info */}
          <Card>
            <CardContent className="p-4">
              <h4 className="font-semibold text-sm mb-3">RSS Feed Information</h4>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">Website:</span>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {source.url}
                  </a>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">RSS URL:</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded">{source.rssUrl}</code>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Disclaimer */}
          <Card className="border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950">
            <CardContent className="p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5" />
                <div className="text-sm text-yellow-800 dark:text-yellow-200">
                  <p className="font-medium mb-1">Source Analysis Disclaimer</p>
                  <p>
                    Credibility and bias ratings are based on third-party analysis and may not reflect all perspectives.
                    We encourage readers to consume news from multiple sources and form their own opinions.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
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
          </div>
        </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
