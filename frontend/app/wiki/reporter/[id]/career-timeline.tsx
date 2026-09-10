"use client";
import { hasText } from "@/lib/utils";

import { ExternalLink, Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import type { ReporterCareerTimeline } from "@/lib/api";
import { formatMonthYear } from "@/lib/date-formatters";

type SharedOwnerFinding = ReporterCareerTimeline["shared_owner_findings"][number];
type ReporterTimelineEntry = ReporterCareerTimeline["timeline"][number];

const formatTimelineDate = (value?: string | null): string | null => {
  if (!hasText(value)) {
    return null;
  }
  const formatted = formatMonthYear(value);
  return formatted || null;
};

const getOutletSeparator = (index: number, outletCount: number): string => {
  if (index === 0) {
    return "";
  }
  if (index === outletCount - 1) {
    return " and ";
  }
  return ", ";
};

const getTimelineRange = (start: string | null, end: string | null): string => {
  if (hasText(start) && hasText(end)) {
    if (start === end) {
      return start;
    }
    return `${start} – ${end}`;
  }
  return start ?? end ?? "Undated";
};

const getTimelineEntryLabel = (source: string): string => {
  if (source === "byline") {
    return "Byline";
  }
  return "Affiliation";
};

const OutletLabel = ({ outlet }: Readonly<{ outlet: SharedOwnerFinding["outlets"][number] }>) => {
  if (hasText(outlet.profile_path)) {
    return (
      <Link
        href={outlet.profile_path}
        className="underline decoration-white/20 underline-offset-2 hover:text-white"
      >
        {outlet.label}
      </Link>
    );
  }
  return outlet.label;
};

const OwnerLabel = ({ owner }: Readonly<{ owner: SharedOwnerFinding["owner"] }>) => {
  if (hasText(owner.profile_path)) {
    return (
      <Link
        href={owner.profile_path}
        className="underline decoration-white/20 underline-offset-2 hover:text-white"
      >
        {owner.label}
      </Link>
    );
  }
  return owner.label;
};

const SharedOwnerFindingText = ({ finding }: Readonly<{ finding: SharedOwnerFinding }>) => (
  <p className="leading-6 text-foreground/90">
    Reported for{" "}
    {finding.outlets.map((outlet, outletIndex) => (
      <span key={outlet.entity_id}>
        {getOutletSeparator(outletIndex, finding.outlets.length)}
        <OutletLabel outlet={outlet} />
      </span>
    ))}{" "}
    — both ultimately owned by <OwnerLabel owner={finding.owner} />.
  </p>
);

const SharedOwnerFindingEvidence = ({ finding }: Readonly<{ finding: SharedOwnerFinding }>) => (
  <div className="mt-2">
    <Link
      href={finding.owner.profile_path ?? "#"}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground transition-colors hover:text-white"
    >
      {finding.evidence_count} evidence · view ownership chain
    </Link>
  </div>
);

const SharedOwnerFindingCard = ({ finding }: Readonly<{ finding: SharedOwnerFinding }>) => (
  <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm">
    <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
    <div className="min-w-0">
      <SharedOwnerFindingText finding={finding} />
      <SharedOwnerFindingEvidence finding={finding} />
    </div>
  </div>
);

const TimelineSourceRow = ({ entry }: Readonly<{ entry: ReporterTimelineEntry }>) => (
  <div className="mt-1 flex items-center gap-2">
    <Link
      href={`/wiki/source/${encodeURIComponent(entry.outlet)}`}
      className="truncate font-serif text-sm transition-colors hover:text-white"
    >
      {entry.outlet}
    </Link>
    <Badge variant="outline" className="shrink-0 text-[9px] font-mono uppercase tracking-widest">
      {getTimelineEntryLabel(entry.source)}
    </Badge>
  </div>
);

const TimelineRole = ({ role }: Readonly<{ role?: string | null }>) => {
  if (!hasText(role)) {
    return null;
  }
  return (
    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {role}
    </div>
  );
};

const TimelineArticleCount = ({ entry }: Readonly<{ entry: ReporterTimelineEntry }>) => {
  if (entry.article_count === null || entry.article_count === undefined) {
    return null;
  }
  return (
    <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground">
      {entry.article_count} articles
    </span>
  );
};

const TimelineEvidenceLink = ({ entry }: Readonly<{ entry: ReporterTimelineEntry }>) => {
  if (!hasText(entry.evidence_url)) {
    return null;
  }
  return (
    <a
      href={entry.evidence_url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground transition-colors hover:text-white"
    >
      <ExternalLink className="h-3 w-3" />
      Evidence
    </a>
  );
};

const TimelineEntryDetails = ({
  entry,
  range,
}: Readonly<{ entry: ReporterTimelineEntry; range: string }>) => (
  <div className="min-w-0">
    <div className="font-mono text-[10px] uppercase tracking-widest text-primary/80">{range}</div>
    <TimelineSourceRow entry={entry} />
    <TimelineRole role={entry.role} />
  </div>
);

const TimelineEntryActions = ({ entry }: Readonly<{ entry: ReporterTimelineEntry }>) => (
  <div className="flex shrink-0 items-center gap-2">
    <TimelineArticleCount entry={entry} />
    <TimelineEvidenceLink entry={entry} />
  </div>
);

const TimelineEntry = ({ entry }: Readonly<{ entry: ReporterTimelineEntry }>) => {
  const start = formatTimelineDate(entry.start_date);
  const end = formatTimelineDate(entry.end_date);
  const range = getTimelineRange(start, end);
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="absolute -left-[29px] top-4 h-2.5 w-2.5 rounded-full border-2 border-primary/70 bg-background"
      />
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-black/20 px-4 py-3 transition-all hover:bg-white/[0.03]">
        <TimelineEntryDetails entry={entry} range={range} />
        <TimelineEntryActions entry={entry} />
      </div>
    </div>
  );
};

/**
 * Reporter career timeline (Atlas Phase 4): chronological byline + affiliation
 * history, plus a neutral shared-ultimate-owner annotation when two or more
 * of the reporter's outlets resolve to the same accepted owner. Replaces the
 * deleted synthetic coauthor/shared_outlet reporter-graph edges.
 *
 * @param {Readonly<{ data: ReporterCareerTimeline }>} data Parsed reporter career timeline data.
 * @returns {JSX.Element | null} The career timeline or null when no timeline entries exist.
 */
export const CareerTimeline = ({ data }: Readonly<{ data: ReporterCareerTimeline }>) => {
  if (data.timeline.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {data.shared_owner_findings.map((finding) => (
        <SharedOwnerFindingCard
          key={`${finding.owner.entity_id}-${finding.claim_ids.join("|")}`}
          finding={finding}
        />
      ))}
      <div className="relative space-y-4 border-l border-white/10 pl-6">
        {data.timeline.map((entry) => (
          <TimelineEntry
            key={`${entry.outlet}-${entry.source}-${entry.start_date ?? ""}-${entry.end_date ?? ""}`}
            entry={entry}
          />
        ))}
      </div>
    </div>
  );
};
