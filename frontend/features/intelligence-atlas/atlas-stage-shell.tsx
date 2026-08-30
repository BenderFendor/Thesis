"use client"

import { Activity, AlertTriangle, BookOpen, Layers3 } from "lucide-react"

import { AtlasGraph } from "./atlas-graph"
import type { AtlasLayoutMode, AtlasQueryState } from "./lib/atlas-query-state"
import type {
  AtlasEntityType,
  AtlasGraphResponse,
  AtlasNode,
  AtlasRelationType,
} from "./lib/atlas-schema"
import styles from "./atlas.module.css"

type AtlasGraphStats = AtlasGraphResponse["stats"]

type FilterOption<T extends string> = Readonly<{
  label: string
  value: T
}>

const ENTITY_OPTIONS: readonly FilterOption<AtlasEntityType>[] = [
  { label: "Outlets", value: "outlet" },
  { label: "Organizations", value: "organization" },
  { label: "People", value: "person" },
  { label: "Reporters", value: "reporter" },
]

const RELATION_OPTIONS: readonly FilterOption<AtlasRelationType>[] = [
  { label: "Ownership", value: "ownership" },
  { label: "Publishing", value: "publishes" },
  { label: "Parent", value: "parent_org" },
  { label: "Part of", value: "part_of" },
  { label: "Employment", value: "employed_by" },
  { label: "Current outlet", value: "current_outlet" },
  { label: "Coauthor", value: "coauthor" },
  { label: "Shared outlet", value: "shared_outlet" },
  { label: "Founded by", value: "founded_by" },
  { label: "Common ownership", value: "sibling_via_owner" },
]

const LAYOUT_OPTIONS: readonly FilterOption<AtlasLayoutMode>[] = [
  { label: "Clustered", value: "clustered" },
  { label: "Ownership", value: "ownership" },
  { label: "Geography", value: "geography" },
  { label: "Radial", value: "radial" },
]

const toggleValue = <T extends string>(values: readonly T[], value: T): T[] => (
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
)

const humanize = (value: string): string => (
  value.replaceAll("_", " ").replaceAll(/\b\w/gu, (letter) => letter.toUpperCase())
)

const findLayout = (value: string, fallback: AtlasLayoutMode): AtlasLayoutMode => (
  LAYOUT_OPTIONS.find((option) => option.value === value)?.value ?? fallback
)

interface AtlasStageShellProps {
  readonly state: AtlasQueryState
  readonly graph?: AtlasGraphResponse
  readonly graphVersion: string
  readonly loading: boolean
  readonly fetching: boolean
  readonly error: Error | null
  readonly selectedNode: AtlasNode | null
  readonly dockNodes: readonly AtlasNode[]
  readonly totalStats?: AtlasGraphStats
  readonly ownershipCoverage: number
  readonly onStateChange: (patch: Partial<AtlasQueryState>) => void
  readonly onSelect: (nodeId: string, entityType?: AtlasEntityType) => void
  readonly onOpenIndex: () => void
  readonly onOpenOperations: () => void
  readonly onRetry: () => void
}

interface ContextPanelProps {
  readonly selectedNode: AtlasNode | null
  readonly currentStats?: AtlasGraphStats
  readonly totalStats?: AtlasGraphStats
  readonly ownershipCoverage: number
}

type VisibleCountKey = "visible_outlets" | "visible_organizations" | "visible_people" | "visible_reporters"
type TotalCountKey = "total_outlets" | "total_organizations" | "total_people" | "total_reporters"

const resolveEntityCount = (
  currentStats: AtlasGraphStats | undefined,
  currentKey: VisibleCountKey,
  totalStats: AtlasGraphStats | undefined,
  totalKey: TotalCountKey,
): number => currentStats?.[currentKey] ?? totalStats?.[totalKey] ?? 0

const resolveRelationshipCount = (currentStats: AtlasGraphStats | undefined): number => (
  currentStats?.visible_relationships ?? 0
)

const AtlasContextPanel = ({
  selectedNode,
  currentStats,
  totalStats,
  ownershipCoverage,
}: ContextPanelProps) => {
  const eyebrow = selectedNode === null
    ? "Traceable media context"
    : `${humanize(selectedNode.entity_type)} selected`
  const title = selectedNode?.label ?? "Follow publication, ownership, reporter, and evidence relationships."
  const copy = selectedNode === null
    ? "Every visible relationship is typed. Inferred and evidence-backed links remain distinguishable, and bounded results declare truncation."
    : "Direct connections remain visible while the inspector exposes confidence, provenance, verification dates, and unresolved claims."

  return (
    <section className={styles.contextPanel} aria-label="Atlas context and coverage">
      <div className={styles.brandEyebrow}>{eyebrow}</div>
      <h2 className={styles.contextTitle}>{title}</h2>
      <p className={styles.contextCopy}>{copy}</p>
      <div className={styles.metrics}>
        <Metric label="Outlets" value={resolveEntityCount(currentStats, "visible_outlets", totalStats, "total_outlets")} />
        <Metric label="Organizations" value={resolveEntityCount(currentStats, "visible_organizations", totalStats, "total_organizations")} />
        <Metric label="People" value={resolveEntityCount(currentStats, "visible_people", totalStats, "total_people")} />
        <Metric label="Reporters" value={resolveEntityCount(currentStats, "visible_reporters", totalStats, "total_reporters")} />
        <Metric label="Relationships" value={resolveRelationshipCount(currentStats)} />
        <Metric label="Ownership coverage" value={`${ownershipCoverage}%`} />
      </div>
    </section>
  )
}

interface EntityFiltersProps {
  readonly state: AtlasQueryState
  readonly selectedNode: AtlasNode | null
  readonly onStateChange: (patch: Partial<AtlasQueryState>) => void
}

const EntityFilters = ({ state, selectedNode, onStateChange }: EntityFiltersProps) => {
  const updateEntities = (value: AtlasEntityType) => {
    const entities = toggleValue(state.entities, value)
    if (entities.length === 0) return

    const selectedType = selectedNode?.entity_type
    const selected = selectedType !== undefined && entities.includes(selectedType)
      ? state.selected
      : null
    onStateChange({ entities, selected })
  }

  return (
    <div className={styles.toolbarGroup}>
      <span className={`${styles.controlLabel} px-2`}>Entities</span>
      {ENTITY_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.pillButton}
          data-active={state.entities.includes(option.value)}
          onClick={() => updateEntities(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

interface RelationFiltersProps {
  readonly state: AtlasQueryState
  readonly onStateChange: (patch: Partial<AtlasQueryState>) => void
}

const RelationFilters = ({ state, onStateChange }: RelationFiltersProps) => {
  const updateRelations = (value: AtlasRelationType) => {
    const relations = toggleValue(state.relations, value)
    if (relations.length > 0) onStateChange({ relations })
  }

  return (
    <div className={styles.toolbarGroup}>
      <span className={`${styles.controlLabel} px-2`}>Relations</span>
      {RELATION_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.pillButton}
          data-active={state.relations.includes(option.value)}
          onClick={() => updateRelations(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

interface LayoutControlProps {
  readonly layout: AtlasLayoutMode
  readonly onStateChange: (patch: Partial<AtlasQueryState>) => void
}

const LayoutControl = ({ layout, onStateChange }: LayoutControlProps) => (
  <label className={styles.toolbarGroup}>
    <Layers3 className="ml-2 h-3.5 w-3.5 text-[#77736a]" />
    <select
      id="atlas-layout"
      name="atlas-layout"
      value={layout}
      onChange={(event) => onStateChange({ layout: findLayout(event.target.value, layout) })}
      className="h-8 bg-transparent px-2 text-xs text-[#c9c3b6] outline-none"
      aria-label="Graph layout"
    >
      {LAYOUT_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  </label>
)

interface AtlasToolbarProps {
  readonly state: AtlasQueryState
  readonly selectedNode: AtlasNode | null
  readonly onStateChange: (patch: Partial<AtlasQueryState>) => void
}

const AtlasToolbar = ({ state, selectedNode, onStateChange }: AtlasToolbarProps) => (
  <div className={styles.toolbar} aria-label="Graph filters and layout">
    <EntityFilters state={state} selectedNode={selectedNode} onStateChange={onStateChange} />
    <RelationFilters state={state} onStateChange={onStateChange} />
    <LayoutControl layout={state.layout} onStateChange={onStateChange} />
  </div>
)

interface GraphBannersProps {
  readonly graph?: AtlasGraphResponse
  readonly error: Error | null
  readonly onOpenIndex: () => void
  readonly onRetry: () => void
}

const GraphBanners = ({ graph, error, onOpenIndex, onRetry }: GraphBannersProps) => (
  <>
    {graph?.truncated === true && (
      <div className={styles.warningBanner} role="status">
        <span className="flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-[#d7b35f]" />
          This is a bounded graph. Hidden entities or edges reached the {graph.truncation_reason?.replaceAll("_", " ")}.
        </span>
        <button type="button" className={styles.pillButton} onClick={onOpenIndex}>Browse full index</button>
      </div>
    )}
    {error !== null && (
      <div className={styles.errorBanner} role="alert">
        <span>{error.message}</span>
        <button type="button" className={styles.pillButton} onClick={onRetry}>Retry</button>
      </div>
    )}
  </>
)

interface RecordDockProps {
  readonly state: AtlasQueryState
  readonly dockNodes: readonly AtlasNode[]
  readonly onSelect: (nodeId: string, entityType?: AtlasEntityType) => void
  readonly onOpenIndex: () => void
  readonly onOpenOperations: () => void
}

const RecordDock = ({ state, dockNodes, onSelect, onOpenIndex, onOpenOperations }: RecordDockProps) => (
  <footer className={styles.dock}>
    <div>
      <div className={styles.brandEyebrow}>Record dock</div>
      <div className="mt-1 text-xs text-[#77736a]">Selected, recent, and high-salience visible entities</div>
    </div>
    <div className={styles.dockList}>
      {dockNodes.map((node) => (
        <button
          key={node.id}
          type="button"
          className={styles.recordCard}
          data-selected={state.selected === node.id}
          onClick={() => onSelect(node.id, node.entity_type)}
        >
          <span className={styles.entityMark} data-type={node.entity_type} aria-hidden="true">
            {node.entity_type.slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm text-[#f0ede4]">{node.label}</span>
            <span className="mt-1 block truncate font-mono text-[9px] uppercase tracking-[0.13em] text-[#77736a]">
              {node.connection_count} links · {node.status ?? node.confidence_tier ?? "unresolved"}
            </span>
          </span>
        </button>
      ))}
    </div>
    <div className="flex items-center gap-2">
      <button type="button" className={styles.actionButton} aria-label="Browse all Atlas entities" onClick={onOpenIndex}>
        <BookOpen className="h-4 w-4" /> <span>Browse all</span>
      </button>
      <button type="button" className={styles.actionButton} aria-label="Open Atlas operations" onClick={onOpenOperations}>
        <Activity className="h-4 w-4" /> <span>Operations</span>
      </button>
    </div>
  </footer>
)

export const AtlasStageShell = ({
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
}: AtlasStageShellProps) => {
  const nodes = graph?.nodes ?? []
  const edges = graph?.edges ?? []
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const selectNode = (nodeId: string) => onSelect(nodeId, nodesById.get(nodeId)?.entity_type)

  return (
    <>
      <div className={styles.stage}>
        <AtlasContextPanel
          selectedNode={selectedNode}
          currentStats={graph?.stats}
          totalStats={totalStats}
          ownershipCoverage={ownershipCoverage}
        />
        <AtlasToolbar state={state} selectedNode={selectedNode} onStateChange={onStateChange} />
        <AtlasGraph
          nodes={nodes}
          edges={edges}
          graphVersion={graphVersion}
          layout={state.layout}
          selectedId={state.selected}
          focus={state.focus}
          loading={loading}
          onSelect={selectNode}
        />
        <GraphBanners graph={graph} error={error} onOpenIndex={onOpenIndex} onRetry={onRetry} />
      </div>
      <RecordDock
        state={state}
        dockNodes={dockNodes}
        onSelect={onSelect}
        onOpenIndex={onOpenIndex}
        onOpenOperations={onOpenOperations}
      />
    </>
  )
}

interface MetricProps {
  readonly label: string
  readonly value: string | number
}

const Metric = ({ label, value }: MetricProps) => (
  <div className={styles.metric}>
    <div className={styles.microLabel}>{label}</div>
    <div className={styles.metricValue}>{typeof value === "number" ? value.toLocaleString() : value}</div>
  </div>
)
