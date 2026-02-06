"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  Loader2,
  ExternalLink,
  Briefcase,
  GraduationCap,
  AlertTriangle,
  Building2,
  FileText,
  Users,
  BookOpen,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fetchWikiReporter, type WikiReporterDossier } from "@/lib/api";

// ── Helpers ──────────────────────────────────────────────────────────

function leaningBadgeClass(leaning?: string): string {
  switch (leaning?.toLowerCase()) {
    case "left": return "bg-blue-900/40 text-blue-300 border-blue-700/30";
    case "left-leaning":
    case "center-left": return "bg-blue-900/20 text-blue-200 border-blue-700/20";
    case "center":
    case "centrist": return "bg-zinc-800/60 text-zinc-300 border-zinc-600/30";
    case "center-right":
    case "right-leaning": return "bg-red-900/20 text-red-200 border-red-700/20";
    case "right": return "bg-red-900/40 text-red-300 border-red-700/30";
    default: return "bg-zinc-800/40 text-zinc-400 border-zinc-700/20";
  }
}

// ── Section Component ────────────────────────────────────────────────

function DossierSection({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-white/10 bg-zinc-950/50">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left p-4 flex items-center gap-2 hover:bg-zinc-900/30 transition-colors"
      >
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground flex-1">
          {title}
        </h3>
        <span className="text-muted-foreground text-xs">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="border-t border-white/5 p-4">
          {children}
        </div>
      )}
    </div>
  );
}

// ── JSON Section Renderer ────────────────────────────────────────────

function renderJsonSection(data: Record<string, unknown> | undefined): React.ReactNode {
  if (!data || Object.keys(data).length === 0) {
    return <p className="text-xs text-muted-foreground">No data available.</p>;
  }
  return (
    <dl className="space-y-2">
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <dt className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {key.replace(/_/g, " ")}
          </dt>
          <dd className="text-sm text-foreground/90 mt-0.5">
            {typeof value === "string"
              ? value
              : Array.isArray(value)
                ? value.join(", ")
                : JSON.stringify(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export default function ReporterProfilePage() {
  const params = useParams();
  const reporterId = parseInt(params.id as string, 10);

  const [data, setData] = useState<WikiReporterDossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const result = await fetchWikiReporter(reporterId);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load reporter");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (!isNaN(reporterId)) load();
    return () => { cancelled = true; };
  }, [reporterId]);

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
            <Link href="/wiki/reporters" className="text-muted-foreground hover:text-foreground">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <h1 className="font-serif text-xl font-semibold">Reporter</h1>
          </div>
        </header>
        <div className="container mx-auto px-4 py-20 text-center">
          <p className="text-red-400">{error || "Reporter not found"}</p>
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
            <Link href="/wiki/reporters" className="text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-serif text-xl font-semibold">{data.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                {data.political_leaning && (
                  <span className={`px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border ${leaningBadgeClass(data.political_leaning)}`}>
                    {data.political_leaning}
                  </span>
                )}
                {data.leaning_confidence && (
                  <span className="text-[10px] font-mono text-muted-foreground">
                    ({data.leaning_confidence} confidence)
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {data.twitter_handle && (
              <a
                href={`https://x.com/${data.twitter_handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                @{data.twitter_handle}
              </a>
            )}
            {data.wikipedia_url && (
              <a
                href={data.wikipedia_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
              >
                Wikipedia <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {data.linkedin_url && (
              <a
                href={data.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
              >
                LinkedIn <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-4 max-w-4xl">
        {/* Bio */}
        {data.bio && (
          <div className="border border-white/10 bg-zinc-950/50 p-4">
            <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground mb-2">
              Biography
            </h2>
            <p className="text-sm text-foreground/90 leading-relaxed">{data.bio}</p>
          </div>
        )}

        {/* Quick stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="border border-white/10 bg-zinc-950/50 p-3 text-center">
            <div className="text-lg font-mono font-bold">{data.article_count}</div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Articles</div>
          </div>
          <div className="border border-white/10 bg-zinc-950/50 p-3 text-center">
            <div className="text-lg font-mono font-bold">{data.topics?.length || 0}</div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Topics</div>
          </div>
          <div className="border border-white/10 bg-zinc-950/50 p-3 text-center">
            <div className="text-lg font-mono font-bold capitalize">{data.political_leaning || "Unknown"}</div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Leaning</div>
          </div>
          <div className="border border-white/10 bg-zinc-950/50 p-3 text-center">
            <div className="text-lg font-mono font-bold capitalize">{data.research_confidence || "N/A"}</div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Confidence</div>
          </div>
        </div>

        {/* Topics */}
        {data.topics && data.topics.length > 0 && (
          <div className="border border-white/10 bg-zinc-950/50 p-4">
            <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground mb-2">
              Topics Covered
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {data.topics.map((topic, i) => (
                <Badge key={i} variant="secondary" className="text-xs">{topic}</Badge>
              ))}
            </div>
          </div>
        )}

        {/* Career History */}
        {data.career_history && data.career_history.length > 0 && (
          <DossierSection title="Career History" icon={<Briefcase className="w-4 h-4" />} defaultOpen>
            <div className="space-y-3">
              {data.career_history.map((entry, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 shrink-0" />
                  <div>
                    <div className="text-sm font-medium">{entry.role || "Reporter"}</div>
                    <div className="text-xs text-muted-foreground">{entry.organization}</div>
                    {entry.source && (
                      <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                        Source: {entry.source}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </DossierSection>
        )}

        {/* Education */}
        {data.education && data.education.length > 0 && (
          <DossierSection title="Education" icon={<GraduationCap className="w-4 h-4" />}>
            <div className="space-y-2">
              {data.education.map((entry, i) => (
                <div key={i} className="text-sm">
                  {Object.values(entry).filter(Boolean).join(" - ")}
                </div>
              ))}
            </div>
          </DossierSection>
        )}

        {/* Manufacturing Consent Analysis Sections */}
        <div className="pt-4">
          <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground mb-4 flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            Manufacturing Consent Dossier
          </h2>
        </div>

        {/* Source Patterns */}
        {data.source_patterns && Object.keys(data.source_patterns).length > 0 && (
          <DossierSection title="Sourcing Patterns" icon={<Users className="w-4 h-4" />} defaultOpen>
            {renderJsonSection(data.source_patterns)}
          </DossierSection>
        )}

        {/* Topics Avoided */}
        {data.topics_avoided && Object.keys(data.topics_avoided).length > 0 && (
          <DossierSection title="Topics Avoided / Under-covered" icon={<FileText className="w-4 h-4" />}>
            {renderJsonSection(data.topics_avoided)}
          </DossierSection>
        )}

        {/* Advertiser Alignment */}
        {data.advertiser_alignment && Object.keys(data.advertiser_alignment).length > 0 && (
          <DossierSection title="Advertiser / Owner Alignment" icon={<Building2 className="w-4 h-4" />}>
            {renderJsonSection(data.advertiser_alignment)}
          </DossierSection>
        )}

        {/* Revolving Door */}
        {data.revolving_door && Object.keys(data.revolving_door).length > 0 && (
          <DossierSection title="Revolving Door" icon={<Briefcase className="w-4 h-4" />}>
            {renderJsonSection(data.revolving_door)}
          </DossierSection>
        )}

        {/* Controversies */}
        {data.controversies && data.controversies.length > 0 && (
          <DossierSection title="Controversies" icon={<AlertTriangle className="w-4 h-4" />}>
            <div className="space-y-3">
              {data.controversies.map((c, i) => (
                <div key={i} className="border-l-2 border-red-800/40 pl-3">
                  {renderJsonSection(c as Record<string, unknown>)}
                </div>
              ))}
            </div>
          </DossierSection>
        )}

        {/* Institutional Affiliations */}
        {data.institutional_affiliations && data.institutional_affiliations.length > 0 && (
          <DossierSection title="Institutional Affiliations" icon={<Building2 className="w-4 h-4" />}>
            <div className="space-y-2">
              {data.institutional_affiliations.map((a, i) => (
                <div key={i} className="text-sm border border-white/5 p-2">
                  {renderJsonSection(a as Record<string, unknown>)}
                </div>
              ))}
            </div>
          </DossierSection>
        )}

        {/* Coverage Comparison */}
        {data.coverage_comparison && Object.keys(data.coverage_comparison).length > 0 && (
          <DossierSection title="Coverage Comparison Across Outlets" icon={<FileText className="w-4 h-4" />}>
            {renderJsonSection(data.coverage_comparison)}
          </DossierSection>
        )}

        {/* Recent Articles */}
        {data.recent_articles && data.recent_articles.length > 0 && (
          <section>
            <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Recent Articles ({data.recent_articles.length})
            </h2>
            <div className="space-y-1">
              {data.recent_articles.map((article, i) => (
                <a
                  key={i}
                  href={article.url as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 p-2 border border-white/5 hover:bg-zinc-900/40 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{article.title as string}</div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                      {article.source as string}
                      {article.published_at && (
                        <span className="ml-2">
                          {new Date(article.published_at as string).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Research sources */}
        {data.research_sources && data.research_sources.length > 0 && (
          <footer className="border-t border-white/5 pt-4 mt-6">
            <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-1">
              Research Sources
            </h3>
            <div className="flex flex-wrap gap-1">
              {data.research_sources.map((src, i) => (
                <Badge key={i} variant="outline" className="text-[10px]">{src}</Badge>
              ))}
            </div>
          </footer>
        )}
      </main>
    </div>
  );
}
