"use client"

import { useState } from "react"
import { Sparkles, User, Building2, Scale, CheckCircle, AlertCircle, ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { type ArticleAnalysis } from "@/lib/api"

interface ArticleAnalysisDisplayProps {
  analysis: ArticleAnalysis
}

export function ArticleAnalysisDisplay({ analysis }: ArticleAnalysisDisplayProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    fullText: false,
    sourceAnalysis: true,
    reporterAnalysis: true,
    biasAnalysis: true,
    factCheck: true
  })

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
  }

  const getBiasColor = (score: string) => {
    const numScore = parseInt(score)
    if (numScore <= 3) return "text-blue-400"
    if (numScore >= 7) return "text-red-400"
    return "text-gray-400"
  }

  if (!analysis.success) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-lg">
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle className="h-5 w-5" />
          <span className="font-medium">Analysis Failed</span>
        </div>
        <p className="text-sm text-gray-400 mt-2">{analysis.error || "Unknown error occurred"}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* AI Summary */}
      {analysis.summary && (
        <div className="p-4 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20 rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-5 w-5 text-purple-400" />
            <h3 className="text-lg font-semibold text-white">AI Summary</h3>
          </div>
          <p className="text-gray-300 leading-relaxed">{analysis.summary}</p>
        </div>
      )}

      {/* Full Article Text */}
      {analysis.full_text && (
        <div className="border border-gray-800 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('fullText')}
            className="w-full p-4 bg-gray-900/50 hover:bg-gray-900/70 transition-colors flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-white">Full Article Text</h3>
              <Badge variant="outline" className="text-xs">
                {analysis.full_text.split(' ').length} words
              </Badge>
            </div>
            {expandedSections.fullText ? (
              <ChevronUp className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            )}
          </button>
          {expandedSections.fullText && (
            <div className="p-4 bg-black/20">
              <div className="prose prose-invert max-w-none">
                <p className="text-gray-300 leading-relaxed whitespace-pre-wrap">{analysis.full_text}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Source Analysis */}
      {analysis.source_analysis && (
        <div className="border border-gray-800 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('sourceAnalysis')}
            className="w-full p-4 bg-gray-900/50 hover:bg-gray-900/70 transition-colors flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-emerald-400" />
              <h3 className="text-lg font-semibold text-white">Source Analysis</h3>
            </div>
            {expandedSections.sourceAnalysis ? (
              <ChevronUp className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            )}
          </button>
          {expandedSections.sourceAnalysis && (
            <div className="p-4 bg-black/20 space-y-3">
              <div>
                <span className="text-sm text-gray-400">Credibility:</span>
                <p className="text-white mt-1">{analysis.source_analysis.credibility_assessment}</p>
              </div>
              <div>
                <span className="text-sm text-gray-400">Ownership:</span>
                <p className="text-white mt-1">{analysis.source_analysis.ownership}</p>
              </div>
              <div>
                <span className="text-sm text-gray-400">Funding Model:</span>
                <p className="text-white mt-1">{analysis.source_analysis.funding_model}</p>
              </div>
              <div>
                <span className="text-sm text-gray-400">Political Leaning:</span>
                <p className="text-white mt-1">{analysis.source_analysis.political_leaning}</p>
              </div>
              <div>
                <span className="text-sm text-gray-400">Reputation:</span>
                <p className="text-white mt-1">{analysis.source_analysis.reputation}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reporter Analysis */}
      {analysis.reporter_analysis && (
        <div className="border border-gray-800 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('reporterAnalysis')}
            className="w-full p-4 bg-gray-900/50 hover:bg-gray-900/70 transition-colors flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-blue-400" />
              <h3 className="text-lg font-semibold text-white">Reporter Analysis</h3>
            </div>
            {expandedSections.reporterAnalysis ? (
              <ChevronUp className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            )}
          </button>
          {expandedSections.reporterAnalysis && (
            <div className="p-4 bg-black/20 space-y-3">
              {analysis.authors && analysis.authors.length > 0 && (
                <div>
                  <span className="text-sm text-gray-400">Authors:</span>
                  <p className="text-white mt-1">{analysis.authors.join(', ')}</p>
                </div>
              )}
              <div>
                <span className="text-sm text-gray-400">Background:</span>
                <p className="text-white mt-1">{analysis.reporter_analysis.background}</p>
              </div>
              <div>
                <span className="text-sm text-gray-400">Expertise:</span>
                <p className="text-white mt-1">{analysis.reporter_analysis.expertise}</p>
              </div>
              <div>
                <span className="text-sm text-gray-400">Known Biases:</span>
                <p className="text-white mt-1">{analysis.reporter_analysis.known_biases}</p>
              </div>
              <div>
                <span className="text-sm text-gray-400">Track Record:</span>
                <p className="text-white mt-1">{analysis.reporter_analysis.track_record}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bias Analysis */}
      {analysis.bias_analysis && (
        <div className="border border-gray-800 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('biasAnalysis')}
            className="w-full p-4 bg-gray-900/50 hover:bg-gray-900/70 transition-colors flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-yellow-400" />
              <h3 className="text-lg font-semibold text-white">Bias Analysis</h3>
              {analysis.bias_analysis.overall_bias_score && (
                <Badge className={getBiasColor(analysis.bias_analysis.overall_bias_score)}>
                  Score: {analysis.bias_analysis.overall_bias_score}/10
                </Badge>
              )}
            </div>
            {expandedSections.biasAnalysis ? (
              <ChevronUp className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            )}
          </button>
          {expandedSections.biasAnalysis && (
            <div className="p-4 bg-black/20 space-y-3">
              <div>
                <span className="text-sm text-gray-400">Tone Bias:</span>
                <p className="text-white mt-1">{analysis.bias_analysis.tone_bias}</p>
              </div>
              <div>
                <span className="text-sm text-gray-400">Framing Bias:</span>
                <p className="text-white mt-1">{analysis.bias_analysis.framing_bias}</p>
              </div>
              <div>
                <span className="text-sm text-gray-400">Selection Bias:</span>
                <p className="text-white mt-1">{analysis.bias_analysis.selection_bias}</p>
              </div>
              <div>
                <span className="text-sm text-gray-400">Source Diversity:</span>
                <p className="text-white mt-1">{analysis.bias_analysis.source_diversity}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fact Check Suggestions */}
      {analysis.fact_check_suggestions && analysis.fact_check_suggestions.length > 0 && (
        <div className="border border-gray-800 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('factCheck')}
            className="w-full p-4 bg-gray-900/50 hover:bg-gray-900/70 transition-colors flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-cyan-400" />
              <h3 className="text-lg font-semibold text-white">Fact Check Suggestions</h3>
              <Badge variant="outline" className="text-xs">
                {analysis.fact_check_suggestions.length} claims
              </Badge>
            </div>
            {expandedSections.factCheck ? (
              <ChevronUp className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            )}
          </button>
          {expandedSections.factCheck && (
            <div className="p-4 bg-black/20">
              <ul className="space-y-2">
                {analysis.fact_check_suggestions.map((suggestion, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-cyan-400 mt-1">•</span>
                    <span className="text-gray-300">{suggestion}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
