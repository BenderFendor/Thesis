"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  Loader2,
  ExternalLink,
  Users,
  Building2,
  BarChart3,
  FileText,
  AlertTriangle,
  Megaphone,
  Eye,
  Scale,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  fetchWikiSource,
  triggerWikiIndex,
  type WikiSourceProfile,
  type WikiFilterScore,
} from "@/lib/api";

// ── Constants ────────────────────────────────────────────────────────

const FILTER_META: Record<string, { label: string; icon: React.ReactNode; description: string }> = {
  ownership: {
    label: "Ownership",
    icon: <Building2 className="w-4 h-4" />,
    description: "Corporate concentration and conglomerate ownership depth.",
  },
  advertising: {
    label: "Advertising",
    icon: <Megaphone className="w-4 h-4" />,
    description: "Dependency on advertising revenue and advertiser influence.",
  },
  sourcing: {
    label: "Sourcing",
    icon: <Users className="w-4 h-4" />,
    description: "Reliance on official/institutional vs grassroots/independent sources.",
  },
  flak: {
    label: "Flak",
    icon: <AlertTriangle className="w-4 h-4" />,
    description: "Vulnerability to organized pressure campaigns and criticism machinery.",
  },
  ideology: {
    label: "Ideology",
    icon: <Eye className="w-4 h-4" />,
    description: "Rigidity of ideological framing and narrative constraints.",
  },
  class_interest: {
    label: "Class Interest",
    icon: <Scale className="w-4 h-4" />,
    description: "Coverage patterns around labor, inequality, and corporate power (Parenti).",
  },
};

const FILTER_ORDER = ["ownership", "advertising", "sourcing", "flak", "ideology", "class_interest"];

// ── Helpers ──────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  return `hsl(${(5 - score) * 24}, 70%, 55%)`;
}

function confidenceBadge(confidence?: string): string {
  switch (confidence?.toLowerCase()) {
    case "high": return "bg-emerald-900/30 text-emerald-300 border-emerald-700/20";
    case "medium": return "bg-amber-900/30 text-amber-300 border-amber-700/20";
    case "low": return "bg-red-900/30 text-red-300 border-red-700/20";
    default: return "bg-zinc-800/30 text-zinc-400 border-zinc-700/20";
  }
}

function biasBadgeClass(bias?: string): string {
  switch (bias?.toLowerCase()) {
    case "left": return "bg-blue-900/40 text-blue-300 border-blue-700/30";
    case "left-center": return "bg-blue-900/20 text-blue-200 border-blue-700/20";
    case "center": return "bg-zinc-800/60 text-zinc-300 border-zinc-600/30";
    case "center-right":
    case "right-center": return "bg-red-900/20 text-red-200 border-red-700/20";
    case "right": return "bg-red-900/40 text-red-300 border-red-700/30";
    default: return "bg-zinc-800/40 text-zinc-400 border-zinc-700/20";
  }
}

function countryFlag(code?: string): string {
  if (!code || code.length !== 2) return "";
  return String.fromCodePoint(
    ...code.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

// ── Filter Score Card ────────────────────────────────────────────────

function FilterScoreCard({ score }: { score: WikiFilterScore }) {
  const [expanded, setExpanded] = useState(false);
  const meta = FILTER_META[score.filter_name] || {
    label: score.filter_name,
    icon: <FileText className="w-4 h-4" />,
    description: "",
  };

  return (
    <div className="border border-white/10 bg-zinc-950/50">
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 flex items-start gap-3 hover:bg-zinc-900/30 transition-colors"
      >
        <div className="mt-0.5 text-muted-foreground">{meta.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-mono text-sm uppercase tracking-wider font-medium">
              {meta.label}
            </h3>
            <div className="flex items-center gap-2 shrink-0">
              {score.confidence && (
                <span className={`px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider border ${confidenceBadge(score.confidence)}`}>
                  {score.confidence}
                </span>
              )}
              <span
                className="text-xl font-mono font-bold"
                style={{ color: scoreColor(score.score) }}
              >
                {score.score}/5
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{meta.description}</p>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-white/5 p-4 space-y-3">
          {/* Prose explanation */}
          {score.prose_explanation && (
            <div>
              <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-1">
                Analysis
              </h4>
              <p className="text-sm text-foreground/90 leading-relaxed">
                {score.prose_explanation}
              </p>
            </div>
          )}

          {/* Empirical basis */}
          {score.empirical_basis && (
            <div className="bg-zinc-900/40 border border-white/5 p-3">
              <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-amber-400/70 mb-1">
                Empirical Basis
              </h4>
              <p className="text-xs text-foreground/80 leading-relaxed">
                {score.empirical_basis}
              </p>
            </div>
          )}

          {/* Citations */}
          {score.citations && score.citations.length > 0 && (
            <div>
              <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-1">
                Citations
              </h4>
              <ul className="space-y-1">
                {score.citations.map((cite, i) => (
                  <li key={i} className="text-xs text-muted-foreground">
                    {cite.url ? (
                      <a
                        href={cite.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 underline underline-offset-2 inline-flex items-center gap-1"
                      >
                        {cite.title || cite.url}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span>{cite.title || cite.snippet}</span>
                    )}
                    {cite.snippet && cite.url && (
                      <span className="block text-muted-foreground/60 mt-0.5 ml-2">
                        {cite.snippet}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Scorer */}
          {score.scored_by && (
            <div className="text-[10px] text-muted-foreground font-mono">
              Scored by: {score.scored_by}
              {score.last_scored_at && (
                <span className="ml-2">
                  {new Date(score.last_scored_at).toLocaleDateString()}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export default function SourceWikiPage() {
  const params = useParams();
  const sourceName = decodeURIComponent(params.sourceName as string);

  const [data, setData] = useState<WikiSourceProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const result = await fetchWikiSource(sourceName);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [sourceName]);

  // Radar chart data
  const radarData = useMemo(() => {
    if (!data?.filter_scores) return [];
    return FILTER_ORDER.map((axis) => {
      const score = data.filter_scores.find((s) => s.filter_name === axis);
      return {
        axis: FILTER_META[axis]?.label || axis,
        value: score?.score || 0,
        fullMark: 5,
      };
    });
  }, [data]);

  const avgScore = useMemo(() => {
    if (!data?.filter_scores || data.filter_scores.length === 0) return null;
    return data.filter_scores.reduce((sum, s) => sum + s.score, 0) / data.filter_scores.length;
  }, [data]);

  async function handleTriggerIndex() {
    setIndexing(true);
    try {
      await triggerWikiIndex(sourceName);
      const result = await fetchWikiSource(sourceName);
      setData(result);
    } catch {
      // silent fail, user can retry
    } finally {
      setIndexing(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--news-bg-primary)] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[var(--news-bg-primary)]">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-white/10">
          <div className="container mx-auto px-4 py-3 flex items-center gap-3">
            <Link href="/wiki" className="text-muted-foreground hover:text-foreground">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <h1 className="font-serif text-xl font-semibold">{sourceName}</h1>
          </div>
        </header>
        <div className="container mx-auto px-4 py-20 text-center">
          <p className="text-red-400">{error || "Source not found"}</p>
          <Link href="/wiki" className="text-sm text-blue-400 hover:underline mt-2 inline-block">
            Back to wiki
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--news-bg-primary)]">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-white/10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/wiki" className="text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-serif text-xl font-semibold flex items-center gap-2">
                {data.country && <span>{countryFlag(data.country)}</span>}
                {data.name}
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                {data.bias_rating && (
                  <span className={`px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border ${biasBadgeClass(data.bias_rating)}`}>
                    {data.bias_rating}
                  </span>
                )}
                {data.funding_type && (
                  <span className="px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border bg-zinc-800/40 text-zinc-400 border-zinc-700/20">
                    {data.funding_type}
                  </span>
                )}
                {data.is_state_media && (
                  <span className="px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border bg-amber-900/30 text-amber-300 border-amber-700/20">
                    State Media
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {data.index_status !== "complete" && (
              <button
                onClick={handleTriggerIndex}
                disabled={indexing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-white/10 bg-zinc-900/50 hover:bg-zinc-800/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${indexing ? "animate-spin" : ""}`} />
                {indexing ? "Indexing..." : "Index Source"}
              </button>
            )}
            <div className="text-right text-xs text-muted-foreground font-mono">
              <div>{data.article_count} articles</div>
              <div>{data.index_status === "complete" ? "indexed" : data.index_status}</div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-8">
        {/* Top section: Radar + Quick Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Radar Chart */}
          <div className="border border-white/10 bg-zinc-950/50 p-6">
            <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground mb-4">
              Propaganda Filter Profile
            </h2>
            {radarData.length > 0 ? (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={320}>
                  <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                    <PolarGrid stroke="rgba(255,255,255,0.08)" />
                    <PolarAngleAxis
                      dataKey="axis"
                      tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11, fontFamily: "monospace" }}
                    />
                    <PolarRadiusAxis
                      angle={90}
                      domain={[0, 5]}
                      tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
                      tickCount={6}
                    />
                    <Radar
                      name="Score"
                      dataKey="value"
                      stroke="rgba(239,68,68,0.8)"
                      fill="rgba(239,68,68,0.25)"
                      strokeWidth={2}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#18181b",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 0,
                        fontSize: 12,
                        fontFamily: "monospace",
                      }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
                {avgScore != null && (
                  <div className="text-center mt-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      Avg Score:{" "}
                    </span>
                    <span
                      className="font-mono font-bold text-lg"
                      style={{ color: scoreColor(avgScore) }}
                    >
                      {avgScore.toFixed(1)}
                    </span>
                    <span className="text-muted-foreground text-sm"> / 5</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                Source not yet indexed. Click &quot;Index Source&quot; to generate scores.
              </div>
            )}
          </div>

          {/* Quick Stats + Org Data */}
          <div className="space-y-4">
            {/* Quick stats */}
            <div className="border border-white/10 bg-zinc-950/50 p-4">
              <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground mb-3">
                Source Profile
              </h2>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {data.parent_company && (
                  <>
                    <dt className="text-muted-foreground">Parent Company</dt>
                    <dd className="font-medium">{data.parent_company}</dd>
                  </>
                )}
                {data.category && (
                  <>
                    <dt className="text-muted-foreground">Category</dt>
                    <dd className="capitalize">{data.category}</dd>
                  </>
                )}
                {data.credibility_score != null && (
                  <>
                    <dt className="text-muted-foreground">Credibility</dt>
                    <dd className="font-mono">{data.credibility_score.toFixed(1)}</dd>
                  </>
                )}
                {data.source_type && (
                  <>
                    <dt className="text-muted-foreground">Type</dt>
                    <dd className="capitalize">{data.source_type}</dd>
                  </>
                )}
                <>
                  <dt className="text-muted-foreground">Articles</dt>
                  <dd className="font-mono">{data.article_count.toLocaleString()}</dd>
                </>
                {data.geographic_focus.length > 0 && (
                  <>
                    <dt className="text-muted-foreground">Geographic Focus</dt>
                    <dd>{data.geographic_focus.join(", ")}</dd>
                  </>
                )}
                {data.topic_focus.length > 0 && (
                  <>
                    <dt className="text-muted-foreground">Topic Focus</dt>
                    <dd>{data.topic_focus.join(", ")}</dd>
                  </>
                )}
              </dl>
            </div>

            {/* Organization data */}
            {data.organization && (
              <div className="border border-white/10 bg-zinc-950/50 p-4">
                <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground mb-3 flex items-center gap-2">
                  <Building2 className="w-3.5 h-3.5" />
                  Organization
                </h2>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <dt className="text-muted-foreground">Name</dt>
                  <dd className="font-medium">{data.organization.name as string}</dd>
                  {data.organization.org_type && (
                    <>
                      <dt className="text-muted-foreground">Type</dt>
                      <dd className="capitalize">{data.organization.org_type as string}</dd>
                    </>
                  )}
                  {data.organization.annual_revenue && (
                    <>
                      <dt className="text-muted-foreground">Annual Revenue</dt>
                      <dd className="font-mono">{data.organization.annual_revenue as string}</dd>
                    </>
                  )}
                  {data.organization.factual_reporting && (
                    <>
                      <dt className="text-muted-foreground">Factual Reporting</dt>
                      <dd className="capitalize">{data.organization.factual_reporting as string}</dd>
                    </>
                  )}
                  {data.organization.media_bias_rating && (
                    <>
                      <dt className="text-muted-foreground">MBFC Rating</dt>
                      <dd className="capitalize">{data.organization.media_bias_rating as string}</dd>
                    </>
                  )}
                </dl>
                {data.organization.funding_sources && (
                  <div className="mt-3">
                    <h3 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                      Funding Sources
                    </h3>
                    <div className="flex flex-wrap gap-1">
                      {(data.organization.funding_sources as string[]).map((s: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">{s}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {data.organization.major_advertisers && (
                  <div className="mt-3">
                    <h3 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                      Major Advertisers
                    </h3>
                    <div className="flex flex-wrap gap-1">
                      {(data.organization.major_advertisers as string[]).map((a: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">{a}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {data.organization.wikipedia_url && (
                  <a
                    href={data.organization.wikipedia_url as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-3"
                  >
                    Wikipedia <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Propaganda Filter Scores */}
        {data.filter_scores.length > 0 && (
          <section>
            <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Manufacturing Consent Filter Analysis
            </h2>
            <div className="space-y-2">
              {FILTER_ORDER.map((axis) => {
                const score = data.filter_scores.find((s) => s.filter_name === axis);
                if (!score) return null;
                return <FilterScoreCard key={axis} score={score} />;
              })}
            </div>
          </section>
        )}

        {/* Ownership Chain */}
        {data.ownership_chain.length > 0 && (
          <section>
            <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground mb-4 flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Ownership Chain
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              {data.ownership_chain.map((org, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="border border-white/10 bg-zinc-950/50 px-3 py-2 text-sm">
                    {org.name as string}
                    {org.ownership_percentage && (
                      <span className="text-muted-foreground ml-1 text-xs">
                        ({org.ownership_percentage as string}%)
                      </span>
                    )}
                  </div>
                  {i < data.ownership_chain.length - 1 && (
                    <span className="text-muted-foreground text-xs">&rarr;</span>
                  )}
                </div>
              ))}
            </div>
            <Link
              href="/wiki/ownership"
              className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-3"
            >
              View full ownership graph <ExternalLink className="w-3 h-3" />
            </Link>
          </section>
        )}

        {/* Reporters */}
        {data.reporters.length > 0 && (
          <section>
            <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground mb-4 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Reporters ({data.reporters.length})
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.reporters.map((r) => (
                <Link
                  key={r.id as number}
                  href={`/wiki/reporter/${r.id}`}
                  className="border border-white/10 bg-zinc-950/50 p-3 hover:bg-zinc-900/60 transition-colors"
                >
                  <div className="font-serif text-sm font-medium">{r.name as string}</div>
                  {(r.topics as string[] | undefined) && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(r.topics as string[]).slice(0, 3).map((t: string, i: number) => (
                        <span key={i} className="text-[10px] px-1 py-0.5 bg-zinc-800/50 text-muted-foreground">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-2 text-[10px] font-mono text-muted-foreground">
                    <span>{r.political_leaning as string || "unknown"}</span>
                    <span>{(r.article_count as number) || 0} articles</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Footer meta */}
        <footer className="border-t border-white/5 pt-4 text-[10px] text-muted-foreground font-mono">
          <div className="flex items-center gap-4">
            <span>Index status: {data.index_status}</span>
            {data.last_indexed_at && (
              <span>Last indexed: {new Date(data.last_indexed_at).toLocaleString()}</span>
            )}
          </div>
          <p className="mt-1">
            Scores based on Chomsky&apos;s 5 propaganda filters + Parenti&apos;s class interest analysis.
            Higher score = more susceptible. Click each filter to expand analysis.
          </p>
        </footer>
      </main>
    </div>
  );
}
