"use client"

import type {
  LanguageDiagnosticExample,
  LanguageDiagnosticMetric,
  LanguageDiagnostics,
  LanguageExampleCardProps,
  LanguageForensicsCardProps,
  LanguageMetricCardProps,
  LanguageMetricKey,
  LanguageStatus,
} from "../lib/article-detail-modal-data"
import { Badge } from "@/components/ui/badge"
import { ScanText } from "lucide-react"
import { isNonEmptyString } from "../lib/article-detail-modal-data"

const EMPTY_COUNT = 0,
  LANGUAGE_EXAMPLE_KEYS = ["passive_voice", "actor_omission", "euphemisms", "sanitized_language"] as const,
  LANGUAGE_METRIC_LABELS: readonly Readonly<{ key: LanguageMetricKey; label: string }>[] = [
    { key: "passive_voice", label: "Passive voice" },
    { key: "actor_omission", label: "Actor omission" },
    { key: "euphemisms", label: "Euphemisms" },
  ],
  LANGUAGE_STATUS_STYLE = {
    high: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    medium: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  } satisfies Record<LanguageStatus, string>,
  LanguageExampleCard = ({ example }: Readonly<LanguageExampleCardProps>) => (
    <div className="rounded-md border border-border/50 bg-background/35 px-3 py-2">
      <div className="mb-1 flex items-center gap-2">
        <Badge variant="outline" className="text-xs uppercase tracking-widest">
          {getExampleLabel(example)}
        </Badge>
        <LanguageExampleTerm term={example.term} />
      </div>
      <p className="line-clamp-3 text-xs leading-relaxed text-foreground/75">{example.sentence}</p>
    </div>
  ),

  LanguageExampleTerm = ({ term }: Readonly<{ term?: string | null }>) =>
    isNonEmptyString(term) && <span className="text-xs text-muted-foreground">{term}</span>,

  LanguageForensicsCard = ({ diagnostics, loading, error }: Readonly<LanguageForensicsCardProps>) => {
    const { examples, metrics, status } = getLanguageForensicsState(diagnostics)
    return (
      <div className="rounded-lg border border-border/60 bg-secondary/70 p-5">
        <LanguageForensicsHeader status={status} loading={loading} />
        <LanguageForensicsError error={error} />
        <LanguageForensicsMetrics metrics={metrics} />
        <LanguageForensicsSummary summary={diagnostics?.overall?.summary} loading={loading} />
        <LanguageForensicsExamples examples={examples} />
      </div>
    )
  },

  LanguageForensicsError = ({ error }: Readonly<{ error?: string | null }>) =>
    isNonEmptyString(error) && (
      <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
        {error}
      </div>
    ),

  LanguageForensicsExamples = ({ examples }: Readonly<{ examples: readonly LanguageDiagnosticExample[] }>) =>
    examples.length > EMPTY_COUNT && (
      <div className="mt-4 space-y-2">
        {examples.map((example) => <LanguageExampleCard key={example.sentence} example={example} />)}
      </div>
    ),

  LanguageForensicsHeader = ({ status, loading }: Readonly<{ status: LanguageStatus; loading: boolean }>) => (
    <div className="mb-4 flex items-start justify-between gap-3">
      <LanguageForensicsHeading />
      <Badge className={`${LANGUAGE_STATUS_STYLE[status]} uppercase tracking-wide`}>
        {getLanguageStatusLabel(status, loading)}
      </Badge>
    </div>
  ),

  LanguageForensicsHeading = () => (
    <div>
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Language Forensics</p>
      <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-foreground">
        <ScanText className="h-5 w-5 text-primary" />
        Framing diagnostics
      </h3>
    </div>
  ),

  LanguageForensicsMetrics = ({
    metrics,
  }: Readonly<{
    metrics: readonly Readonly<{ key: LanguageMetricKey; label: string; metric: LanguageDiagnosticMetric | undefined }>[]
  }>) => (
    <div className="grid grid-cols-3 gap-2">
      {metrics.map(({ key, label, metric }) => <LanguageMetricCard key={key} label={label} metric={metric} />)}
    </div>
  ),

  LanguageForensicsSummary = ({ summary, loading }: Readonly<{ summary?: string; loading: boolean }>) => {
    if (isNonEmptyString(summary)) {
      return <p className="mt-4 text-sm leading-relaxed text-foreground/80">{summary}</p>
    }
    if (loading) {
      return <p className="mt-4 text-sm text-muted-foreground">Scanning article language.</p>
    }
    return <p className="mt-4 text-sm text-muted-foreground">No diagnostic result available for this article.</p>
  },

  LanguageMetricCard = ({ label, metric }: Readonly<LanguageMetricCardProps>) => (
    <div className="rounded-md border border-border/50 bg-background/45 px-3 py-2">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-lg font-semibold text-foreground">{metric?.count ?? EMPTY_COUNT}</span>
        <span className="text-xs text-muted-foreground">
          {Math.round((metric?.rate ?? EMPTY_COUNT) * PERCENTAGE_MULTIPLIER)}%
        </span>
      </div>
    </div>
  ),

  MAX_LANGUAGE_EXAMPLES = 4,
  PERCENTAGE_MULTIPLIER = 100,

  getExampleLabel = (example: Readonly<LanguageDiagnosticExample>): string => {
    if (isNonEmptyString(example.category)) {return example.category}
    if (isNonEmptyString(example.pattern)) {return example.pattern}
    return "example"
  },

  getLanguageExamples = (diagnostics: Readonly<LanguageDiagnostics> | null | undefined) =>
    LANGUAGE_EXAMPLE_KEYS.flatMap((key) => diagnostics?.[key]?.examples ?? []).slice(EMPTY_COUNT, MAX_LANGUAGE_EXAMPLES),

  getLanguageForensicsState = (diagnostics: Readonly<LanguageDiagnostics> | null | undefined) => ({
    examples: getLanguageExamples(diagnostics),
    metrics: getLanguageMetrics(diagnostics),
    status: diagnostics?.overall?.status ?? "low",
  }),

  getLanguageMetrics = (diagnostics: Readonly<LanguageDiagnostics> | null | undefined) =>
    LANGUAGE_METRIC_LABELS.map(({ key, label }) => ({
      key,
      label,
      metric: diagnostics?.[key] ?? undefined,
    })),

  getLanguageStatusLabel = (status: LanguageStatus, loading: boolean): string => {
    if (loading) {return "Scanning"}
    return status
  }

export { LanguageForensicsCard }
