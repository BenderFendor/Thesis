"use client";

import Link from "next/link";
import { ExternalLink, Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ReporterCareerTimeline } from "@/lib/api";

function formatTimelineDate(value?: string | null): string | null {
  if (!value) {return null;}
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {return null;}
  return parsed.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/**
 * Reporter career timeline (Atlas Phase 4): chronological byline + affiliation
 * history, plus a neutral shared-ultimate-owner annotation when two or more
 * of the reporter's outlets resolve to the same accepted owner. Replaces the
 * deleted synthetic coauthor/shared_outlet reporter-graph edges.
 */
export function CareerTimeline({ data }:Readonly< { data: ReporterCareerTimeline }>) {
  if (data.timeline.length === 0) {return;}

  return (
    <div className="space-y-3">
      {data.shared_owner_findings.map((finding, index) => (
        <div
          key={`${finding.owner.entity_id}-${index}`}
          className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm"
        >
          <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="leading-6 text-foreground/90">
              Reported for{" "}
              {finding.outlets.map((outlet, outletIndex) => (
                <span key={outlet.entity_id}>
                  {outletIndex > 0 ? (outletIndex === finding.outlets.length - 1 ? " and " : ", ") : ""}
                  {outlet.profile_path ? (
                    <Link
                      href={outlet.profile_path}
                      className="underline decoration-white/20 underline-offset-2 hover:text-white"
                    >
                      {outlet.label}
                    </Link>
                  ) : (
                    outlet.label
                  )}
                </span>
              ))}
              {" "}— both ultimately owned by{" "}
              {finding.owner.profile_path ? (
                <Link
                  href={finding.owner.profile_path}
                  className="underline decoration-white/20 underline-offset-2 hover:text-white"
                >
                  {finding.owner.label}
                </Link>
              ) : (
                finding.owner.label
              )}
              .
            </p>
            <div className="mt-2">
              <Link
                href={finding.owner.profile_path || "#"}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground transition-colors hover:text-white"
              >
                {finding.evidence_count} evidence · view ownership chain
              </Link>
            </div>
          </div>
        </div>
      ))}

      <div className="relative space-y-4 border-l border-white/10 pl-6">
        {data.timeline.map((entry, index) => {
          const start = formatTimelineDate(entry.start_date),
           end = formatTimelineDate(entry.end_date),
           range =
            start && end ? (start === end ? start : `${start} – ${end}`) : start || end || "Undated";
          return (
            <div key={`${entry.outlet}-${entry.source}-${index}`} className="relative">
              <span
                aria-hidden="true"
                className="absolute -left-[29px] top-4 h-2.5 w-2.5 rounded-full border-2 border-primary/70 bg-background"
              />
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-black/20 px-4 py-3 transition-all hover:bg-white/[0.03]">
                <div className="min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-primary/80">{range}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <Link
                      href={`/wiki/source/${encodeURIComponent(entry.outlet)}`}
                      className="truncate font-serif text-sm hover:text-white transition-colors"
                    >
                      {entry.outlet}
                    </Link>
                    <Badge variant="outline" className="shrink-0 text-[9px] font-mono tracking-widest uppercase">
                      {entry.source === "byline" ? "Byline" : "Affiliation"}
                    </Badge>
                  </div>
                  {entry.role ? (
                    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {entry.role}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {entry.article_count == null ? null : (
                    <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground">
                      {entry.article_count} articles
                    </span>
                  )}
                  {entry.evidence_url ? (
                    <a
                      href={entry.evidence_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground transition-colors hover:text-white"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Evidence
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
