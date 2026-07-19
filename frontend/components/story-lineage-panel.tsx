"use client";

import { useQuery } from "@tanstack/react-query";
import { GitBranch, Link2, ShieldAlert, Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fetchClusterLineage } from "@/lib/api";

interface StoryLineagePanelProps {
  clusterId: number;
}

const relationLabels: Record<string, string> = {
  same_wire_story: "Wire reuse",
  likely_source: "Likely source",
  later_variant: "Later variant",
  updates: "Update",
};

export function StoryLineagePanel({ clusterId }: StoryLineagePanelProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["cluster-lineage", clusterId],
    queryFn: () => fetchClusterLineage(clusterId),
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-xs uppercase tracking-widest text-muted-foreground">
        Building story lineage...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-xs text-muted-foreground">
        Story lineage is unavailable for this topic.
      </div>
    );
  }

  if (data.status !== "ok" || !data.story) {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <GitBranch className="h-4 w-4" />
          Lineage not ready
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{data.reason}</p>
      </div>
    );
  }

  const relationCounts = data.article_edges.reduce<Record<string, number>>((counts, edge) => {
    counts[edge.relation] = (counts[edge.relation] ?? 0) + 1;
    return counts;
  }, {});

  return (
    <div className="space-y-4 rounded-md border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-foreground">
            <GitBranch className="h-4 w-4 text-primary" />
            Story Lineage
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Who appeared first, which outlets followed, and which checkable claims are now tracked.
          </p>
        </div>
        <Badge variant="outline" className="border-white/10 bg-black/20 text-[10px] uppercase tracking-widest">
          {data.article_edges.length} edges
        </Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded border border-white/10 bg-black/20 p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Earliest detected</div>
          <div className="mt-1 text-sm text-foreground">
            Article {data.story.earliest_article_id ?? "unknown"}
          </div>
        </div>
        <div className="rounded border border-white/10 bg-black/20 p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Claims tracked</div>
          <div className="mt-1 text-sm text-foreground">{data.claims.length}</div>
        </div>
        <div className="rounded border border-white/10 bg-black/20 p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Corrections matched</div>
          <div className="mt-1 text-sm text-foreground">{data.corrections.length}</div>
        </div>
      </div>

      {Object.keys(relationCounts).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(relationCounts).map(([relation, count]) => (
            <Badge
              key={relation}
              variant="outline"
              className="border-white/10 bg-black/20 text-[10px] uppercase tracking-widest"
            >
              {relationLabels[relation] ?? relation}: {count}
            </Badge>
          ))}
        </div>
      )}

      {data.article_edges.length > 0 && (
        <div className="space-y-2">
          {data.article_edges.slice(0, 4).map((edge) => (
            <div
              key={`${edge.from_article_id}-${edge.to_article_id}-${edge.relation}`}
              className="rounded border border-white/10 bg-black/20 p-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" />
                {relationLabels[edge.relation] ?? edge.relation}
                {typeof edge.confidence === "number" && (
                  <span>{Math.round(edge.confidence * 100)}%</span>
                )}
              </div>
              <div className="mt-2 grid gap-2 text-sm md:grid-cols-[1fr_auto_1fr] md:items-center">
                <div className="line-clamp-2 text-foreground/80">{edge.from_title}</div>
                <div className="hidden text-muted-foreground md:block">to</div>
                <div className="line-clamp-2 text-foreground/80">{edge.to_title}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.claims.length > 0 && (
        <div className="border-t border-white/10 pt-4">
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Tags className="h-4 w-4" />
            Claim chain seeds
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {data.claims.slice(0, 4).map((claim) => (
              <div key={claim.id ?? `${claim.article_id}-${claim.claim_text}`} className="rounded border border-white/10 bg-black/15 p-2">
                <div className="mb-1 flex flex-wrap gap-2">
                  <Badge variant="outline" className="border-white/10 text-[10px] uppercase tracking-widest">
                    {claim.claim_type}
                  </Badge>
                  <Badge variant="outline" className="border-white/10 text-[10px] uppercase tracking-widest">
                    {claim.checkability}
                  </Badge>
                </div>
                <div className="line-clamp-3 text-xs text-muted-foreground">{claim.claim_text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.corrections.length > 0 && (
        <div className="border-t border-white/10 pt-4">
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <ShieldAlert className="h-4 w-4" />
            Correction watch
          </div>
          {data.corrections.slice(0, 3).map((correction) => (
            <a
              key={correction.id}
              href={correction.correction_url ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="block rounded border border-amber-300/20 bg-amber-500/5 p-3 text-sm text-foreground/80"
            >
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                {correction.source}
              </span>
              {correction.correction_text}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
