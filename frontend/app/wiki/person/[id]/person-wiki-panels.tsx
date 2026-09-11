import type { ReactElement } from "react";
import { ExternalLink, Network } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { OwnershipChain } from "@/features/intelligence-atlas/ownership-chain";
import { Panel } from "@/features/wiki/ui/wiki-primitives";
import { formatArticleDate } from "@/lib/date-formatters";
import { hasText } from "@/lib/utils";
import type {
  DeepReadonly,
  PersonWikiPanelsProps,
  ReadonlyControls,
  ReadonlyPersonEntity,
} from "./person-wiki-types";

const PersonWikiPanels = (props: DeepReadonly<PersonWikiPanelsProps>): ReactElement => (
  <section className="space-y-5">
    <OwnershipPanel chain={props.chain} entityId={props.data.id} />
    <ControlsPanel controls={props.controls} />
    <ConnectionsPanel data={props.data} />
    <EvidencePanel data={props.data} />
  </section>
);

const OwnershipPanel = (
  props: DeepReadonly<{ chain: PersonWikiPanelsProps["chain"]; entityId: string }>,
): ReactElement => (
  <Panel
    title="Ownership Chain"
    eyebrow="Entities this person owns equity in, up through any further owner"
  >
    <OwnershipContent chain={props.chain} entityId={props.entityId} />
  </Panel>
);

const OwnershipContent = (
  props: DeepReadonly<{ chain: PersonWikiPanelsProps["chain"]; entityId: string }>,
): ReactElement => {
  if (props.chain.length <= 1) {
    return (
      <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
        No accepted ownership chain recorded above this person.
      </p>
    );
  }
  return (
    <div className="rounded-2xl border border-white/5 bg-black/20 p-5">
      <OwnershipChain chain={props.chain} currentEntityId={props.entityId} />
    </div>
  );
};

type ControlEntryData = ReadonlyControls[number];

const ControlsPanel = (props: DeepReadonly<{ controls: ReadonlyControls }>): ReactElement => (
  <Panel
    title="Controls"
    eyebrow="Everything this person reaches through accepted ownership/control edges"
  >
    <ControlsContent controls={props.controls} />
  </Panel>
);

const ControlsContent = (props: DeepReadonly<{ controls: ReadonlyControls }>): ReactElement => {
  if (props.controls.length === 0) {
    return (
      <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
        No downstream entities recorded under this person.
      </p>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {props.controls.map((entry) => (
        <ControlEntry entry={entry} key={entry.entity_id} />
      ))}
    </div>
  );
};

const ControlEntryHeader = (props: DeepReadonly<{ entry: ControlEntryData }>): ReactElement => (
  <div className="flex flex-wrap items-center gap-2 relative z-10">
    <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">
      {props.entry.entity_type}
    </Badge>
    {props.entry.percentage !== null && props.entry.percentage !== undefined && (
      <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
        {props.entry.percentage.toFixed(1)}%
      </span>
    )}
  </div>
);

const ControlEntryCard = (props: DeepReadonly<{ entry: ControlEntryData }>): ReactElement => (
  <div className="group rounded-2xl border border-white/5 bg-black/20 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-4 relative overflow-hidden">
    <div className="absolute inset-0 bg-gradient-to-tr from-primary/0 to-primary/5 opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none" />
    <div className="font-serif text-base relative z-10">{props.entry.label}</div>
    <ControlEntryHeader entry={props.entry} />
    <div className="mt-2 font-mono text-[10px] tracking-widest text-muted-foreground relative z-10">
      {props.entry.evidence_count} evidence
    </div>
  </div>
);

const ControlEntry = (props: DeepReadonly<{ entry: ControlEntryData }>): ReactElement => {
  const card = <ControlEntryCard entry={props.entry} />;
  if (hasText(props.entry.profile_path)) {
    return <Link href={props.entry.profile_path}>{card}</Link>;
  }
  return <div>{card}</div>;
};

type Connection = ReadonlyPersonEntity["connections"][number];

const ConnectionsPanel = (props: DeepReadonly<{ data: ReadonlyPersonEntity }>): ReactElement => (
  <Panel title="Connections" eyebrow="Every relationship in the bounded evidence graph">
    <ConnectionsContent data={props.data} />
  </Panel>
);

const ConnectionTarget = (props: DeepReadonly<{ connection: Connection }>): ReactElement => (
  <div className="min-w-0">
    <div className="truncate font-serif group-hover:text-white transition-colors">
      {props.connection.entity.label}
    </div>
    <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {props.connection.edge.relation_type.replaceAll("_", " ")} · {props.connection.edge.direction}
    </div>
  </div>
);

const ConnectionStatus = (props: DeepReadonly<{ edge: Connection["edge"] }>): ReactElement => (
  <div className="text-right">
    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {props.edge.fact_status}
    </div>
    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
      {props.edge.evidence_count} evidence
    </div>
  </div>
);

const ConnectionRow = (props: DeepReadonly<{ connection: Connection }>): ReactElement => (
  <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-sm transition-all hover:bg-white/[0.03] hover:-translate-y-px group">
    <ConnectionTarget connection={props.connection} />
    <ConnectionStatus edge={props.connection.edge} />
  </div>
);

const ConnectionEntry = (props: DeepReadonly<{ connection: Connection }>): ReactElement => {
  if (hasText(props.connection.entity.profile_path)) {
    return (
      <Link href={props.connection.entity.profile_path}>
        <ConnectionRow connection={props.connection} />
      </Link>
    );
  }
  return (
    <div>
      <ConnectionRow connection={props.connection} />
    </div>
  );
};

const ConnectionsContent = (props: DeepReadonly<{ data: ReadonlyPersonEntity }>): ReactElement => {
  if (props.data.connections.length === 0) {
    return (
      <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
        No relationships in the current bounded graph.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {props.data.connections.map((connection) => (
        <ConnectionEntry key={connection.edge.id} connection={connection} />
      ))}
    </div>
  );
};

type Evidence = ReadonlyPersonEntity["evidence"][number];

const EvidenceSource = (props: DeepReadonly<{ item: Evidence }>): ReactElement => (
  <div className="text-sm font-serif">{props.item.source_name ?? props.item.source_type}</div>
);

const EvidenceRetrieved = (props: DeepReadonly<{ item: Evidence }>): ReactElement => {
  let retrievedText = "Not recorded";
  if (hasText(props.item.retrieved_at)) {
    retrievedText = formatArticleDate(props.item.retrieved_at);
  }
  return (
    <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {retrievedText}
    </div>
  );
};

const EvidenceItemLink = (props: DeepReadonly<{ item: Evidence }>): ReactElement | null => {
  if (!hasText(props.item.source_url)) {
    return null;
  }
  return (
    <a
      href={props.item.source_url}
      target="_blank"
      rel="noreferrer"
      className="text-muted-foreground hover:text-white transition-colors shrink-0"
    >
      <ExternalLink className="h-4 w-4" />
    </a>
  );
};

const EvidenceItemBody = (props: DeepReadonly<{ item: Evidence }>): ReactElement => (
  <div className="min-w-0">
    <EvidenceSource item={props.item} />
    {hasText(props.item.excerpt) && (
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{props.item.excerpt}</p>
    )}
    <EvidenceRetrieved item={props.item} />
  </div>
);

const EvidenceItem = (props: DeepReadonly<{ item: Evidence }>): ReactElement => (
  <div className="rounded-2xl border border-white/5 bg-black/20 p-4 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
    <div className="flex items-start justify-between gap-3">
      <EvidenceItemBody item={props.item} />
      <EvidenceItemLink item={props.item} />
    </div>
  </div>
);

const EvidenceContent = (props: DeepReadonly<{ data: ReadonlyPersonEntity }>): ReactElement => {
  if (props.data.evidence.length === 0) {
    return (
      <div className="flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
        <Network className="h-3.5 w-3.5" />
        No evidence rows attached to the visible relationships.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {props.data.evidence.map((item) => (
        <EvidenceItem key={item.id} item={item} />
      ))}
    </div>
  );
};

const EvidencePanel = (props: DeepReadonly<{ data: ReadonlyPersonEntity }>): ReactElement => (
  <Panel title="Evidence Trail" eyebrow="Citations backing the relationships above">
    <EvidenceContent data={props.data} />
  </Panel>
);

export { PersonWikiPanels };
