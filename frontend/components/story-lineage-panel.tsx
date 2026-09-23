"use client";

import { GitBranch, Link2, ShieldAlert, Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fetchClusterLineage } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

interface StoryLineagePanelProps {
  clusterId: number;
}

const relationLabel = (relation: string) => {
  switch (relation) {
    case "later_variant": {
      return "Later variant";
    }
    case "likely_source": {
      return "Likely source";
    }
    case "same_wire_story": {
      return "Wire reuse";
    }
    case "updates": {
      return "Update";
    }
    default: {
      return relation;
    }
  }
};

interface LineageArticleEdge {
  readonly from_article_id: number;
  readonly to_article_id: number;
  readonly from_title: string;
  readonly to_title: string;
  readonly relation: string;
  readonly confidence?: number | null;
}

interface LineageClaim {
  readonly id?: number | null;
  readonly article_id: number;
  readonly claim_text: string;
  readonly claim_type: string;
  readonly checkability: string;
}

interface LineageCorrection {
  readonly id: number;
  readonly source: string;
  readonly correction_url?: string | null;
  readonly correction_text: string;
}
const EMPTY_ARTICLE_EDGES: readonly LineageArticleEdge[] = [];
const EMPTY_CLAIMS: readonly LineageClaim[] = [];
const EMPTY_CORRECTIONS: readonly LineageCorrection[] = [];

const LineageEdgeCard = (props: Readonly<{ readonly edge: LineageArticleEdge }>) => {
  const { edge } = props;
  return (
    <div
      key={`${edge.from_article_id}-${edge.to_article_id}-${edge.relation}`}
      className="rounded border border-white/10 bg-black/20 p-3"
    >
      <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
        <Link2 className="h-3.5 w-3.5" />
        {relationLabel(edge.relation)}
        {edge.confidence !== null && edge.confidence !== undefined && (
          <span>{Math.round(edge.confidence * 100)}%</span>
        )}
      </div>
      <div className="mt-2 grid gap-2 text-sm md:grid-cols-[1fr_auto_1fr] md:items-center">
        <div className="line-clamp-2 text-foreground/80">{edge.from_title}</div>
        <div className="hidden text-muted-foreground md:block">to</div>
        <div className="line-clamp-2 text-foreground/80">{edge.to_title}</div>
      </div>
    </div>
  );
};

const LineageClaimCard = (props: Readonly<{ readonly claim: LineageClaim }>) => {
  const { claim } = props;
  return (
    <div
      key={claim.id ?? `${claim.article_id}-${claim.claim_text}`}
      className="rounded border border-white/10 bg-black/15 p-2"
    >
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
  );
};

const LineageArticleEdges = (
  props: Readonly<{ readonly edges: readonly LineageArticleEdge[] }>,
) => {
  if (props.edges.length === 0) {
    return null;
  }
  return (
    <div className="space-y-2">
      {props.edges.slice(0, 4).map((edge) => (
        <LineageEdgeCard
          key={`${edge.from_article_id}-${edge.to_article_id}-${edge.relation}`}
          edge={edge}
        />
      ))}
    </div>
  );
};

const LineageClaims = (props: Readonly<{ readonly claims: readonly LineageClaim[] }>) => {
  if (props.claims.length === 0) {
    return null;
  }
  return (
    <div className="border-t border-white/10 pt-4">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        <Tags className="h-4 w-4" />
        Claim chain seeds
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {props.claims.slice(0, 4).map((claim) => (
          <LineageClaimCard
            key={claim.id ?? `${claim.article_id}-${claim.claim_text}`}
            claim={claim}
          />
        ))}
      </div>
    </div>
  );
};

const LineageCorrections = (
  props: Readonly<{ readonly corrections: readonly LineageCorrection[] }>,
) => {
  if (props.corrections.length === 0) {
    return null;
  }
  return (
    <div className="border-t border-white/10 pt-4">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        <ShieldAlert className="h-4 w-4" />
        Correction watch
      </div>
      {props.corrections.slice(0, 3).map((correction) => (
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
  );
};

const LineageRelationBadges = (
  props: Readonly<{ readonly counts: Readonly<Record<string, number>> }>,
) => {
  if (Object.keys(props.counts).length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(props.counts).map(([relation, count]) => (
        <Badge
          key={relation}
          variant="outline"
          className="border-white/10 bg-black/20 text-[10px] uppercase tracking-widest"
        >
          {relationLabel(relation)}: {count}
        </Badge>
      ))}
    </div>
  );
};

const LineageLoading = () => (
  <div className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-xs uppercase tracking-widest text-muted-foreground">
    Building story lineage...
  </div>
);

const LineageUnavailable = () => (
  <div className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-xs text-muted-foreground">
    Story lineage is unavailable for this topic.
  </div>
);

const LineageNotReady = (props: Readonly<{ readonly reason?: string | null }>) => (
  <div className="rounded-md border border-white/10 bg-white/[0.03] p-4">
    <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
      <GitBranch className="h-4 w-4" />
      Lineage not ready
    </div>
    <p className="mt-2 text-sm text-muted-foreground">{props.reason}</p>
  </div>
);

const useLineageQuery = (clusterId: number) =>
  useQuery({
    queryFn: () => fetchClusterLineage(clusterId),
    queryKey: ["cluster-lineage", clusterId],
    staleTime: 60 * 1000,
  });

const countRelations = (edges: readonly LineageArticleEdge[]) =>
  edges.reduce<Record<string, number>>((counts, edge) => {
    counts[edge.relation] = (counts[edge.relation] ?? 0) + 1;
    return counts;
  }, {});

const prepareLineage = (
  data: Readonly<{
    readonly article_edges?: readonly LineageArticleEdge[];
    readonly claims?: readonly LineageClaim[];
    readonly corrections?: readonly LineageCorrection[];
  }>,
) => {
  const articleEdges = data.article_edges ?? EMPTY_ARTICLE_EDGES;
  const claims = data.claims ?? EMPTY_CLAIMS;
  const corrections = data.corrections ?? EMPTY_CORRECTIONS;
  return {
    articleEdges,
    claims,
    corrections,
    relationCounts: countRelations(articleEdges),
  };
};

interface StoryLineageContentProps {
  readonly articleEdges: readonly LineageArticleEdge[];
  readonly relationCounts: Readonly<Record<string, number>>;
  readonly earliestArticleId: number | null | undefined;
  readonly claimCount: number;
  readonly correctionCount: number;
  readonly claims: readonly LineageClaim[];
  readonly corrections: readonly LineageCorrection[];
}

const StoryLineageContent = (props: Readonly<StoryLineageContentProps>) => (
  <div className="space-y-4 rounded-md border border-white/10 bg-white/[0.03] p-4">
    <StoryLineageHeader edgeCount={props.articleEdges.length} />

    <div className="grid gap-3 md:grid-cols-3">
      <LineageSummaryCard label="Earliest detected">
        {`Article ${props.earliestArticleId ?? "unknown"}`}
      </LineageSummaryCard>
      <LineageSummaryCard label="Claims tracked">{props.claimCount}</LineageSummaryCard>
      <LineageSummaryCard label="Corrections matched">{props.correctionCount}</LineageSummaryCard>
    </div>

    <LineageRelationBadges counts={props.relationCounts} />
    <LineageArticleEdges edges={props.articleEdges} />
    <LineageClaims claims={props.claims} />
    <LineageCorrections corrections={props.corrections} />
  </div>
);

const StoryLineageHeader = (props: Readonly<{ readonly edgeCount: number }>) => (
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <StoryLineageTitle />
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Who appeared first, which outlets followed, and which checkable claims are now tracked.
      </p>
    </div>
    <Badge
      variant="outline"
      className="border-white/10 bg-black/20 text-[10px] uppercase tracking-widest"
    >
      {props.edgeCount} edges
    </Badge>
  </div>
);

const StoryLineageTitle = () => (
  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-foreground">
    <GitBranch className="h-4 w-4 text-primary" />
    Story Lineage
  </div>
);

interface LineageSummaryCardProps {
  readonly label: string;
  readonly children: string | number;
}

const LineageSummaryCard = (props: Readonly<LineageSummaryCardProps>) => (
  <div className="rounded border border-white/10 bg-black/20 p-3">
    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{props.label}</div>
    <div className="mt-1 text-sm text-foreground">{props.children}</div>
  </div>
);

export const StoryLineagePanel = (props: Readonly<StoryLineagePanelProps>) => {
  const { clusterId } = props;
  const { data, isLoading, error } = useLineageQuery(clusterId);

  if (isLoading) {
    return <LineageLoading />;
  }

  if (error || !data) {
    return <LineageUnavailable />;
  }

  if (data.status !== "ok" || !data.story) {
    return <LineageNotReady reason={data.reason} />;
  }

  const { articleEdges, claims, corrections, relationCounts } = prepareLineage(data);
  return (
    <StoryLineageContent
      articleEdges={articleEdges}
      claimCount={claims.length}
      claims={claims}
      correctionCount={corrections.length}
      corrections={corrections}
      earliestArticleId={data.story.earliest_article_id}
      relationCounts={relationCounts}
    />
  );
};
