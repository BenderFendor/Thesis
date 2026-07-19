"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleHelp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fetchClusterContradictions } from "@/lib/api";

interface ContradictionPanelProps {
  clusterId: number;
}

export function ContradictionPanel({ clusterId }: ContradictionPanelProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["cluster-contradictions", clusterId],
    queryFn: () => fetchClusterContradictions(clusterId),
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-xs uppercase tracking-widest text-muted-foreground">
        Checking disagreement points...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-xs text-muted-foreground">
        Contradiction evidence is unavailable for this topic.
      </div>
    );
  }

  if (data.status !== "ok") {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <CircleHelp className="h-4 w-4" />
          Insufficient source diversity
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{data.reason}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-md border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-mono text-xs uppercase tracking-[0.25em] text-foreground">
            What Sources Disagree About
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.article_count} articles across {data.source_count} sources
          </p>
        </div>
        <Badge variant="outline" className="border-white/10 bg-black/20 text-[10px] uppercase tracking-widest">
          Evidence first
        </Badge>
      </div>

      {data.claims.length > 0 ? (
        <div className="space-y-3">
          {data.claims.map((claim) => (
            <div key={claim.claim} className="rounded-md border border-red-400/20 bg-red-500/5 p-3">
              <div className="flex items-center gap-2 text-sm text-foreground">
                <AlertTriangle className="h-4 w-4 text-red-300" />
                {claim.claim}
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {claim.evidence.slice(0, 4).map((item) => (
                  <a
                    key={`${item.source}-${item.article_url}-${item.snippet}`}
                    href={item.article_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border border-white/10 bg-black/20 p-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span className="mb-1 block font-mono uppercase tracking-widest text-foreground/80">
                      {item.source}
                    </span>
                    {item.snippet}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-white/10 bg-black/15 p-3 text-sm text-muted-foreground">
          No direct contradiction was detected in the available snippets.
        </div>
      )}

      {data.agreed_facts.length > 0 && (
        <div className="space-y-2 border-t border-white/10 pt-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <CheckCircle2 className="h-4 w-4" />
            What sources broadly agree on
          </div>
          {data.agreed_facts.map((fact) => (
            <div key={fact.claim} className="text-sm text-foreground/80">
              {fact.claim}
            </div>
          ))}
        </div>
      )}

      {data.unconfirmed_gaps.length > 0 && (
        <div className="space-y-2 border-t border-white/10 pt-4">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Still unconfirmed
          </div>
          {data.unconfirmed_gaps.map((gap) => (
            <div key={gap} className="text-sm text-muted-foreground">
              {gap}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
