"use client";

import { Network } from "lucide-react";
import { useCallback } from "react";
import { humanize } from "./atlas-inspector-display";
import type { AtlasConnection } from "./atlas-inspector-types";
import styles from "./atlas.module.css";

const AtlasConnections = ({
  connections,
  onSelectConnection,
}: Readonly<{
  connections: readonly AtlasConnection[];
  onSelectConnection: (entityId: string) => void;
}>) => (
  <section className={styles.inspectorSection}>
    <ConnectionsHeader count={connections.length} />
    <ConnectionsList connections={connections} onSelectConnection={onSelectConnection} />
  </section>
);

const ConnectionsHeader = ({ count }: Readonly<{ count: number }>) => (
  <div className="flex items-center justify-between gap-4">
    <div className="flex items-center gap-2">
      <Network className="h-4 w-4 text-[#88a9ff]" />
      <h3 className={styles.controlLabel}>Connections</h3>
    </div>
    <span className="font-mono text-[10px] text-[#77736a]">{count}</span>
  </div>
);

const ConnectionsList = ({
  connections,
  onSelectConnection,
}: Readonly<{
  connections: readonly AtlasConnection[];
  onSelectConnection: (entityId: string) => void;
}>) => {
  if (connections.length === 0) {
    return (
      <p className={`${styles.contextCopy} mt-2`}>
        This entity has no relationships in the current bounded graph.
      </p>
    );
  }
  return (
    <div className="mt-2">
      {connections.slice(0, 40).map(({ edge, entity }) => (
        <AtlasConnectionButton
          key={edge.id}
          edge={edge}
          entity={entity}
          onSelectConnection={onSelectConnection}
        />
      ))}
    </div>
  );
};

const AtlasConnectionButton = ({
  edge,
  entity,
  onSelectConnection,
}: Readonly<{
  edge: AtlasConnection["edge"];
  entity: AtlasConnection["entity"];
  onSelectConnection: (entityId: string) => void;
}>) => {
  const handleClick = useCallback(() => {
    onSelectConnection(entity.id);
  }, [entity.id, onSelectConnection]);
  return (
    <button
      type="button"
      className={styles.connectionButton}
      aria-label={`Open connection to ${entity.label}`}
      onClick={handleClick}
    >
      <ConnectionIdentity edge={edge} entity={entity} />
      <ConnectionMetrics edge={edge} />
    </button>
  );
};

const ConnectionIdentity = ({
  edge,
  entity,
}: Readonly<{
  edge: AtlasConnection["edge"];
  entity: AtlasConnection["entity"];
}>) => (
  <span>
    <span className="block text-sm text-[#f0ede4]">{entity.label}</span>
    <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.14em] text-[#77736a]">
      {humanize(edge.predicate || edge.relation_type)} · {humanize(edge.lifecycle_state)}
    </span>
  </span>
);

const ConnectionMetrics = ({ edge }: Readonly<{ edge: AtlasConnection["edge"] }>) => (
  <span className="text-right">
    <ConnectionConfidence value={edge.confidence} tier={edge.confidence_tier} />
    <span className="mt-1 block text-[10px] text-[#77736a]">{edge.evidence_count} evidence</span>
  </span>
);

const ConnectionConfidence = ({
  value,
  tier,
}: Readonly<{
  value?: number | null;
  tier?: string | null;
}>) => (
  <span className={styles.confidence} data-tier={tier ?? "unresolved"}>
    {confidenceLabel(value)}
  </span>
);

const confidenceLabel = (value?: number | null): string => {
  if (value === null || value === undefined) {
    return "Unrated";
  }
  return `${Math.round(value * 100)}%`;
};

export { AtlasConnections };
