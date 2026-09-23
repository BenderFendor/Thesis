"use client";

import { AlertTriangle, CheckCircle2, CircleHelp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fetchClusterContradictions } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

interface ContradictionPanelProps {
  readonly clusterId: number;
}

interface ContradictionEvidenceView {
  readonly source: string;
  readonly article_url: string;
  readonly snippet: string;
}

interface ContradictionResponseData {
  readonly claims?: readonly {
    readonly claim: string;
    readonly evidence?: readonly ContradictionEvidenceView[];
  }[];
  readonly agreed_facts?: readonly { readonly claim: string }[];
  readonly unconfirmed_gaps?: readonly string[];
}

interface ContradictionClaimView {
  readonly claim: string;
  readonly evidence: readonly ContradictionEvidenceView[];
}

interface AgreedFactView {
  readonly claim: string;
}

const EMPTY_CLAIMS: readonly ContradictionClaimView[] = [];
const EMPTY_FACTS: readonly AgreedFactView[] = [];
const EMPTY_GAPS: readonly string[] = [];

const toContradictionView = (data: Readonly<ContradictionResponseData>) => ({
  agreedFacts: (data.agreed_facts ?? EMPTY_FACTS).map(({ claim }) => ({ claim })),
  claims: (data.claims ?? EMPTY_CLAIMS).map((claim) => ({
    claim: claim.claim,
    evidence: (claim.evidence ?? []).map(({ source, article_url, snippet }) => ({
      article_url,
      snippet,
      source,
    })),
  })),
  unconfirmedGaps: data.unconfirmed_gaps ?? EMPTY_GAPS,
});

interface ContradictionClaimsProps {
  readonly claims: readonly ContradictionClaimView[];
}

const ContradictionClaimHeader = (props: Readonly<{ readonly claim: string }>) => (
  <div className="flex items-center gap-2 text-sm text-foreground">
    <AlertTriangle className="h-4 w-4 text-red-300" />
    {props.claim}
  </div>
);

const ContradictionEvidenceCard = (props: Readonly<ContradictionEvidenceView>) => (
  <a
    href={props.article_url}
    target="_blank"
    rel="noreferrer"
    className="rounded border border-white/10 bg-black/20 p-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
  >
    <span className="mb-1 block font-mono uppercase tracking-widest text-foreground/80">
      {props.source}
    </span>
    {props.snippet}
  </a>
);

const ContradictionEvidenceGrid = (
  props: Readonly<{ readonly evidence: readonly ContradictionEvidenceView[] }>,
) => (
  <div className="mt-3 grid gap-2 md:grid-cols-2">
    {props.evidence.slice(0, 4).map((item) => (
      <ContradictionEvidenceCard
        key={`${item.source}-${item.article_url}-${item.snippet}`}
        article_url={item.article_url}
        snippet={item.snippet}
        source={item.source}
      />
    ))}
  </div>
);

const ContradictionClaims = (props: Readonly<ContradictionClaimsProps>) => {
  const { claims } = props;
  if (claims.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-black/15 p-3 text-sm text-muted-foreground">
        No direct contradiction was detected in the available snippets.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {claims.map((claim) => (
        <div key={claim.claim} className="rounded-md border border-red-400/20 bg-red-500/5 p-3">
          <ContradictionClaimHeader claim={claim.claim} />
          <ContradictionEvidenceGrid evidence={claim.evidence} />
        </div>
      ))}
    </div>
  );
};

interface ContradictionFactsProps {
  readonly agreedFacts: readonly AgreedFactView[];
  readonly unconfirmedGaps: readonly string[];
}

const AgreedFactsHeader = () => (
  <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
    <CheckCircle2 className="h-4 w-4" />
    What sources broadly agree on
  </div>
);

const ContradictionFacts = (props: Readonly<ContradictionFactsProps>) => {
  const { agreedFacts, unconfirmedGaps } = props;
  return (
    <>
      {agreedFacts.length > 0 && (
        <div className="space-y-2 border-t border-white/10 pt-4">
          <AgreedFactsHeader />
          {agreedFacts.map((fact) => (
            <div key={fact.claim} className="text-sm text-foreground/80">
              {fact.claim}
            </div>
          ))}
        </div>
      )}

      {unconfirmedGaps.length > 0 && (
        <div className="space-y-2 border-t border-white/10 pt-4">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Still unconfirmed
          </div>
          {unconfirmedGaps.map((gap) => (
            <div key={gap} className="text-sm text-muted-foreground">
              {gap}
            </div>
          ))}
        </div>
      )}
    </>
  );
};

interface ContradictionContentProps {
  readonly articleCount: number;
  readonly sourceCount: number;
  readonly claims: readonly ContradictionClaimView[];
  readonly agreedFacts: readonly AgreedFactView[];
  readonly unconfirmedGaps: readonly string[];
}

const ContradictionContentHeader = (
  props: Readonly<{ readonly articleCount: number; readonly sourceCount: number }>,
) => (
  <div className="flex flex-wrap items-center justify-between gap-2">
    <div>
      <h4 className="font-mono text-xs uppercase tracking-[0.25em] text-foreground">
        What Sources Disagree About
      </h4>
      <p className="mt-1 text-xs text-muted-foreground">
        {props.articleCount} articles across {props.sourceCount} sources
      </p>
    </div>
    <Badge
      variant="outline"
      className="border-white/10 bg-black/20 text-[10px] uppercase tracking-widest"
    >
      Evidence first
    </Badge>
  </div>
);

const ContradictionLoading = () => (
  <div className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-xs uppercase tracking-widest text-muted-foreground">
    Checking disagreement points...
  </div>
);

const ContradictionUnavailable = () => (
  <div className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-xs text-muted-foreground">
    Contradiction evidence is unavailable for this topic.
  </div>
);

interface InsufficientDiversityProps {
  readonly reason?: string | null;
}

const InsufficientDiversity = (props: Readonly<InsufficientDiversityProps>) => (
  <div className="rounded-md border border-white/10 bg-white/[0.03] p-4">
    <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
      <CircleHelp className="h-4 w-4" />
      Insufficient source diversity
    </div>
    <p className="mt-2 text-sm text-muted-foreground">{props.reason}</p>
  </div>
);

const useContradictionQuery = (clusterId: number) =>
  useQuery({
    queryFn: () => fetchClusterContradictions(clusterId),
    queryKey: ["cluster-contradictions", clusterId],
    staleTime: 60 * 1000,
  });

const ContradictionContent = (props: Readonly<ContradictionContentProps>) => {
  const { articleCount, sourceCount, claims, agreedFacts, unconfirmedGaps } = props;
  return (
    <div className="space-y-4 rounded-md border border-white/10 bg-white/[0.03] p-4">
      <ContradictionContentHeader articleCount={articleCount} sourceCount={sourceCount} />

      <ContradictionClaims claims={claims} />
      <ContradictionFacts agreedFacts={agreedFacts} unconfirmedGaps={unconfirmedGaps} />
    </div>
  );
};

export const ContradictionPanel = ({ clusterId }: ContradictionPanelProps) => {
  const { data, isLoading, error } = useContradictionQuery(clusterId);

  if (isLoading) {
    return <ContradictionLoading />;
  }

  if (error || !data) {
    return <ContradictionUnavailable />;
  }

  if (data.status !== "ok") {
    return <InsufficientDiversity reason={data.reason} />;
  }

  const display = toContradictionView(data);

  return (
    <ContradictionContent
      articleCount={data.article_count}
      sourceCount={data.source_count}
      claims={display.claims}
      agreedFacts={display.agreedFacts}
      unconfirmedGaps={display.unconfirmedGaps}
    />
  );
};
