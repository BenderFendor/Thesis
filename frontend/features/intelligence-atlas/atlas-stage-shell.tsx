"use client";

import { Activity, AlertTriangle, BookOpen, Layers3 } from "lucide-react";

import { AtlasGraph } from "./atlas-graph";
import type { AtlasLayoutMode, AtlasQueryState } from "./lib/atlas-query-state";
import type {
  AtlasEntityType,
  AtlasGraphResponse,
  AtlasNode,
  AtlasRelationType,
} from "./lib/atlas-schema";
import styles from "./atlas.module.css";

type AtlasGraphStats = AtlasGraphResponse["stats"];

const ENTITY_OPTIONS: Array<{ value: AtlasEntityType; label: string }> = [
  { value: "source", label: "Sources" },
  { value: "organization", label: "Organizations" },
  { value: "reporter", label: "Reporters" },
];
const RELATION_OPTIONS: Array<{ value: AtlasRelationType; label: string }> = [
  { value: "ownership", label: "Ownership" },
  { value: "publishes", label: "Publishing" },
  { value: "parent_org", label: "Parent" },
  { value: "part_of", label: "Part of" },
  { value: "employed_by", label: "Employment" },
  { value: "current_outlet", label: "Current outlet" },
  { value: "coauthor", label: "Coauthor" },
  { value: "shared_outlet", label: "Shared outlet" },
];
const LAYOUT_OPTIONS: Array<{ value: AtlasLayoutMode; label: string }> = [
  { value: "clustered", label: "Clustered" },
  { value: "ownership", label: "Ownership" },
  { value: "geography", label: "Geography" },
  { value: "radial", label: "Radial" },
];

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

interface AtlasStageShellProps {
  state: AtlasQueryState;
  graph?: AtlasGraphResponse;
  graphVersion: string;
  loading: boolean;
  fetching: boolean;
  error: Error | null;
  selectedNode: AtlasNode | null;
  dockNodes: AtlasNode[];
  totalStats?: AtlasGraphStats;
  ownershipCoverage: number;
  onStateChange: (patch: Partial<AtlasQueryState>) => void;
  onSelect: (nodeId: string, entityType?: AtlasEntityType) => void;
  onOpenIndex: () => void;
  onOpenOperations: () => void;
  onRetry: () => void;
}

export function AtlasStageShell({
  state,
  graph,
  graphVersion,
  loading,
  error,
  selectedNode,
  dockNodes,
  totalStats,
  ownershipCoverage,
  onStateChange,
  onSelect,
  onOpenIndex,
  onOpenOperations,
  onRetry,
}: AtlasStageShellProps) {
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const currentStats = graph?.stats;
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return (
    <>
      <div className={styles.stage}>
        <section className={styles.contextPanel} aria-label="Atlas context and coverage">
          <div className={styles.brandEyebrow}>{selectedNode ? `${humanize(selectedNode.entity_type)} selected` : "Traceable media context"}</div>
          <h2 className={styles.contextTitle}>{selectedNode?.label || "Follow publication, ownership, reporter, and evidence relationships."}</h2>
          <p className={styles.contextCopy}>
            {selectedNode
              ? "Direct connections remain visible while the inspector exposes confidence, provenance, verification dates, and unresolved claims."
              : "Every visible relationship is typed. Inferred and evidence-backed links remain distinguishable, and bounded results declare truncation."}
          </p>
          <div className={styles.metrics}>
            <Metric label="Sources" value={currentStats?.visible_sources ?? totalStats?.total_sources ?? 0} />
            <Metric label="Organizations" value={currentStats?.visible_organizations ?? totalStats?.total_organizations ?? 0} />
            <Metric label="Reporters" value={currentStats?.visible_reporters ?? totalStats?.total_reporters ?? 0} />
            <Metric label="Relationships" value={currentStats?.visible_relationships ?? 0} />
            <Metric label="Ownership coverage" value={`${ownershipCoverage}%`} />
          </div>
        </section>

        <div className={styles.toolbar} aria-label="Graph filters and layout">
          <div className={styles.toolbarGroup}>
            <span className={`${styles.controlLabel} px-2`}>Entities</span>
            {ENTITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={styles.pillButton}
                data-active={state.entities.includes(option.value)}
                onClick={() => {
                  const values = toggleValue(state.entities, option.value);
                  if (values.length > 0) onStateChange({ entities: values, selected: values.includes(selectedNode?.entity_type ?? "source") ? state.selected : null });
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className={styles.toolbarGroup}>
            <span className={`${styles.controlLabel} px-2`}>Relations</span>
            {RELATION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={styles.pillButton}
                data-active={state.relations.includes(option.value)}
                onClick={() => {
                  const values = toggleValue(state.relations, option.value);
                  if (values.length > 0) onStateChange({ relations: values });
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className={styles.toolbarGroup}>
            <Layers3 className="ml-2 h-3.5 w-3.5 text-[#77736a]" />
            <select
              value={state.layout}
              onChange={(event) => onStateChange({ layout: event.target.value as AtlasLayoutMode })}
              className="h-8 bg-transparent px-2 text-xs text-[#c9c3b6] outline-none"
              aria-label="Graph layout"
            >
              {LAYOUT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        <AtlasGraph
          nodes={nodes}
          edges={edges}
          graphVersion={graphVersion}
          layout={state.layout}
          selectedId={state.selected}
          focus={state.focus}
          loading={loading}
          onSelect={(nodeId) => onSelect(nodeId, nodesById.get(nodeId)?.entity_type)}
        />

        {graph?.truncated ? (
          <div className={styles.warningBanner} role="status">
            <span className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-[#d7b35f]" />
              This is a bounded graph. Hidden entities or edges reached the {graph.truncation_reason?.replaceAll("_", " ")}.
            </span>
            <button type="button" className={styles.pillButton} onClick={onOpenIndex}>Browse full index</button>
          </div>
        ) : null}
        {error ? (
          <div className={styles.errorBanner} role="alert">
            <span>{error.message}</span>
            <button type="button" className={styles.pillButton} onClick={onRetry}>Retry</button>
          </div>
        ) : null}
      </div>

      <footer className={styles.dock}>
        <div>
          <div className={styles.brandEyebrow}>Record dock</div>
          <div className="mt-1 text-xs text-[#77736a]">Selected, recent, and high-salience visible entities</div>
        </div>
        <div className={styles.dockList}>
          {dockNodes.map((node) => (
            <button key={node.id} type="button" className={styles.recordCard} data-selected={state.selected === node.id} onClick={() => onSelect(node.id, node.entity_type)}>
              <span className={styles.entityMark} data-type={node.entity_type} aria-hidden="true">{node.entity_type.slice(0, 2).toUpperCase()}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-[#f0ede4]">{node.label}</span>
                <span className="mt-1 block truncate font-mono text-[9px] uppercase tracking-[0.13em] text-[#77736a]">
                  {node.connection_count} links · {node.status || node.confidence_tier || "unresolved"}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={styles.actionButton} onClick={onOpenIndex}><BookOpen className="h-4 w-4" /> <span>Browse all</span></button>
          <button type="button" className={styles.actionButton} onClick={onOpenOperations}><Activity className="h-4 w-4" /> <span>Operations</span></button>
        </div>
      </footer>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.metric}>
      <div className={styles.microLabel}>{label}</div>
      <div className={styles.metricValue}>{typeof value === "number" ? value.toLocaleString() : value}</div>
    </div>
  );
}
