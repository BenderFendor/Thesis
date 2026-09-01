"use client"

import { Activity, AlertTriangle, BookOpen, Layers3 } from "lucide-react"
import type {
  AtlasEdge,
  AtlasEntityType,
  AtlasGraphResponse,
  AtlasNode,
  AtlasRelationType,
} from "./lib/atlas-schema"
import type {
  AtlasLayoutMode,
  AtlasQueryState,
  ReadonlyAtlasQueryState,
} from "./lib/atlas-query-state"
import { useCallback, useMemo } from "react"
import { DEFAULT_ATLAS_QUERY_STATE } from "./lib/atlas-query-state"
import { AtlasContextPanel } from "./atlas-context-panel"
import { AtlasGraph } from "./atlas-graph"
import styles from "./atlas.module.css"

type AtlasGraphStats = AtlasGraphResponse["stats"]

type FilterOption<Value extends string> = Readonly<{
  label: string
  value: Value
}>

interface AtlasStatePatch {
  readonly bias?: readonly string[]
  readonly country?: readonly string[]
  readonly entities?: readonly AtlasEntityType[]
  readonly focus?: boolean
  readonly funding?: readonly string[]
  readonly layout?: AtlasLayoutMode
  readonly minConfidence?: number
  readonly neighbors?: AtlasQueryState["neighbors"]
  readonly panel?: AtlasQueryState["panel"]
  readonly "q"?: ReadonlyAtlasQueryState["q"]
  readonly relations?: readonly AtlasRelationType[]
  readonly selected?: string | null
  readonly tab?: string
  readonly view?: AtlasQueryState["view"]
}

interface AtlasButtonClickEvent {
  readonly currentTarget: AtlasButtonClickTarget
}

interface AtlasButtonClickTarget {
  readonly dataset: AtlasDataset
  readonly value: string
}

interface AtlasDataset {
  readonly entityType?: string
  readonly nodeId?: string
}

interface AtlasSelectChangeEvent {
  readonly target: Readonly<{
    readonly value: string
  }>
}

type ReadonlyButtonClickHandler = (event: Readonly<AtlasButtonClickEvent>) => void
type ReadonlySelectChangeHandler = (event: Readonly<AtlasSelectChangeEvent>) => void
type AtlasSelectionHandler = (nodeId: string, entityType?: AtlasEntityType) => void

interface AtlasStageShellProps {
  readonly state: ReadonlyAtlasQueryState
  readonly graph?: Readonly<AtlasGraphResponse>
  readonly graphVersion: string
  readonly loading: boolean
  readonly fetching: boolean
  readonly error: Error | null
  readonly selectedNode: AtlasNode | null
  readonly dockNodes: readonly AtlasNode[]
  readonly totalStats?: AtlasGraphStats
  readonly ownershipCoverage: number
  readonly onStateChange: (patch: Readonly<AtlasStatePatch>) => void
  readonly onSelect: AtlasSelectionHandler
  readonly onOpenIndex: () => void
  readonly onOpenOperations: () => void
  readonly onRetry: () => void
}

interface EntityFiltersProps {
  readonly state: ReadonlyAtlasQueryState
  readonly selectedNode: AtlasNode | null
  readonly onStateChange: (patch: Readonly<AtlasStatePatch>) => void
}

interface RelationFiltersProps {
  readonly state: ReadonlyAtlasQueryState
  readonly onStateChange: (patch: Readonly<AtlasStatePatch>) => void
}

interface LayoutControlProps {
  readonly layout: AtlasLayoutMode
  readonly onStateChange: (patch: Readonly<AtlasStatePatch>) => void
}

interface AtlasToolbarProps {
  readonly state: ReadonlyAtlasQueryState
  readonly selectedNode: AtlasNode | null
  readonly onStateChange: (patch: Readonly<AtlasStatePatch>) => void
}

interface GraphBannersProps {
  readonly graph?: AtlasGraphResponse
  readonly error: Error | null
  readonly onOpenIndex: () => void
  readonly onRetry: () => void
}

interface RecordDockProps {
  readonly state: ReadonlyAtlasQueryState
  readonly dockNodes: readonly AtlasNode[]
  readonly onSelect: ReadonlyButtonClickHandler
  readonly onOpenIndex: () => void
  readonly onOpenOperations: () => void
}

interface FilterButtonProps {
  readonly active: boolean
  readonly label: string
  readonly onClick: ReadonlyButtonClickHandler
  readonly value: string
}

interface RecordCardProps {
  readonly node: AtlasNode
  readonly onClick: ReadonlyButtonClickHandler
  readonly selected: boolean
}

interface RecordCardTextProps {
  readonly node: AtlasNode
}

interface DockActionButtonProps {
  readonly action: "browse" | "operations"
  readonly label: string
  readonly onClick: ReadonlyButtonClickHandler
}

const AtlasStageShell = (props: Readonly<AtlasStageShellProps>) => {
  const {
    dockNodes,
    error,
    graph,
    graphVersion,
    loading,
    onOpenIndex,
    onOpenOperations,
    onRetry,
    onSelect,
    onStateChange,
    ownershipCoverage,
    selectedNode,
    state,
    totalStats,
  } = props
  const edges = graph?.edges ?? EMPTY_EDGES,
    nodes = graph?.nodes ?? EMPTY_NODES,
    nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]),
    selectDockNode = useCallback<ReadonlyButtonClickHandler>((event) => {
      selectDockEntity(event, onSelect)
    }, [onSelect]),
    selectGraphNode = useCallback((nodeId: string) => {
      selectGraphEntity(nodeId, nodesById, onSelect)
    }, [nodesById, onSelect])

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
          onSelect={selectGraphNode}
        />
        <GraphBanners graph={graph} error={error} onOpenIndex={onOpenIndex} onRetry={onRetry} />
      </div>
      <RecordDock
        state={state}
        dockNodes={dockNodes}
        onSelect={selectDockNode}
        onOpenIndex={onOpenIndex}
        onOpenOperations={onOpenOperations}
      />
    </>
  )
  },
  AtlasToolbar = (props: Readonly<AtlasToolbarProps>) => (
    <div className={styles.toolbar} aria-label="Graph filters and layout">
      <EntityFilters state={props.state} selectedNode={props.selectedNode} onStateChange={props.onStateChange} />
      <RelationFilters state={props.state} onStateChange={props.onStateChange} />
      <LayoutControl layout={props.state.layout} onStateChange={props.onStateChange} />
    </div>
  ),
  DockActionButton = ({ action, label, onClick }: Readonly<DockActionButtonProps>) => {
    let icon = <BookOpen className="h-4 w-4" />
    if (action === "operations") {
      icon = <Activity className="h-4 w-4" />
    }
    return (
      <button type="button" className={styles.actionButton} onClick={onClick}>
        {icon} <span>{label}</span>
      </button>
    )
  },
  EMPTY_COLLECTION_SIZE = 0,
  EMPTY_EDGES: AtlasEdge[] = [],
  EMPTY_NODES: AtlasNode[] = [],
  ENTITY_OPTIONS: readonly FilterOption<AtlasEntityType>[] = [
    { label: "Outlets", value: "outlet" },
    { label: "Organizations", value: "organization" },
    { label: "People", value: "person" },
    { label: "Reporters", value: "reporter" },
  ],
  EntityFilters = (props: Readonly<EntityFiltersProps>) => {
    const updateEntities = useCallback<ReadonlyButtonClickHandler>((event) => {
      const { currentTarget } = event,
        candidate = ENTITY_OPTIONS.find((option) => option.value === currentTarget.value),
        entities = toggleValue(props.state.entities, candidate?.value),
        selected = resolveSelectedEntity(props.state.selected, props.selectedNode, entities)
      if (candidate === undefined || entities.length === EMPTY_COLLECTION_SIZE) {
        return
      }
      props.onStateChange({ entities, selected })
    }, [props])

    return (
      <div className={styles.toolbarGroup}>
        <span className={`${styles.controlLabel} px-2`}>Entities</span>
        {ENTITY_OPTIONS.map((option) => (
          <FilterButton
            key={option.value}
            active={props.state.entities.includes(option.value)}
            label={option.label}
            onClick={updateEntities}
            value={option.value}
          />
        ))}
      </div>
    )
  },
  FilterButton = (props: Readonly<FilterButtonProps>) => (
    <button
      type="button"
      className={styles.pillButton}
      data-active={props.active}
      value={props.value}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  ),
  GraphBanners = (props: Readonly<GraphBannersProps>) => (
    <>
      {props.graph?.truncated === true && (
        <output className={styles.warningBanner}>
          <AlertTriangle className="h-4 w-4 text-[#d7b35f]" />
          This is a bounded graph. Hidden entities or edges reached the {props.graph.truncation_reason?.replaceAll("_", " ")}.
          <button type="button" className={styles.pillButton} onClick={props.onOpenIndex}>Browse full index</button>
        </output>
      )}
      {props.error !== null && (
        <div className={styles.errorBanner} role="alert">
          <span>{props.error.message}</span>
          <button type="button" className={styles.pillButton} onClick={props.onRetry}>Retry</button>
        </div>
      )}
    </>
  ),
  LAYOUT_OPTIONS: readonly FilterOption<AtlasLayoutMode>[] = [
    { label: "Clustered", value: "clustered" },
    { label: "Ownership", value: "ownership" },
    { label: "Geography", value: "geography" },
    { label: "Radial", value: "radial" },
  ],
  LayoutControl = (props: Readonly<LayoutControlProps>) => {
    const handleChange = useCallback<ReadonlySelectChangeHandler>((event) => {
      props.onStateChange({ layout: findLayout(event.target.value, props.layout) })
    }, [props])

    return (
      <label className={styles.toolbarGroup}>
        <Layers3 className="ml-2 h-3.5 w-3.5 text-[#77736a]" />
        <select
          id="atlas-layout"
          name="atlas-layout"
          value={props.layout}
          onChange={handleChange}
          className="h-8 bg-transparent px-2 text-xs text-[#c9c3b6] outline-none"
          aria-label="Graph layout"
        >
          {LAYOUT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    )
  },
  NODE_LABEL_PREFIX_LENGTH = 2,
  RELATION_OPTIONS: readonly FilterOption<AtlasRelationType>[] = [
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
  ],
  RecordCard = (props: Readonly<RecordCardProps>) => (
    <button
      type="button"
      className={styles.recordCard}
      data-entity-type={props.node.entity_type}
      data-node-id={props.node.id}
      data-selected={props.selected}
      onClick={props.onClick}
    >
      <span className={styles.entityMark} data-type={props.node.entity_type} aria-hidden="true">
        {props.node.entity_type.slice(EMPTY_COLLECTION_SIZE, NODE_LABEL_PREFIX_LENGTH).toUpperCase()}
      </span>
      <RecordCardText node={props.node} />
    </button>
  ),
  RecordCardText = (props: Readonly<RecordCardTextProps>) => (
    <span className="min-w-0">
      <span className="block truncate text-sm text-[#f0ede4]">{props.node.label}</span>
      <span className="mt-1 block truncate font-mono text-[9px] uppercase tracking-[0.13em] text-[#77736a]">
        {props.node.connection_count} links · {props.node.status ?? props.node.confidence_tier ?? "unresolved"}
      </span>
    </span>
  ),
  RecordDock = (props: Readonly<RecordDockProps>) => (
    <footer className={styles.dock}>
      <div>
        <div className={styles.brandEyebrow}>Record dock</div>
        <div className="mt-1 text-xs text-[#77736a]">Selected, recent, and high-salience visible entities</div>
      </div>
      <div className={styles.dockList}>
        {props.dockNodes.map((node) => (
          <RecordCard key={node.id} node={node} onClick={props.onSelect} selected={props.state.selected === node.id} />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <DockActionButton
          action="browse"
          label="Browse all"
          onClick={props.onOpenIndex}
        />
        <DockActionButton
          action="operations"
          label="Operations"
          onClick={props.onOpenOperations}
        />
      </div>
    </footer>
  ),
  RelationFilters = (props: Readonly<RelationFiltersProps>) => {
    const updateRelations = useCallback<ReadonlyButtonClickHandler>((event) => {
      const { currentTarget } = event,
        candidate = RELATION_OPTIONS.find((option) => option.value === currentTarget.value),
        relations = toggleValue(props.state.relations, candidate?.value)
      if (candidate === undefined || relations.length === EMPTY_COLLECTION_SIZE) {
        return
      }
      props.onStateChange({ relations })
    }, [props])

    return (
      <div className={styles.toolbarGroup}>
        <span className={`${styles.controlLabel} px-2`}>Relations</span>
        {RELATION_OPTIONS.map((option) => (
          <FilterButton
            key={option.value}
            active={props.state.relations.includes(option.value)}
            label={option.label}
            onClick={updateRelations}
            value={option.value}
          />
        ))}
      </div>
    )
  },
  findLayout = (value: string, fallback: AtlasLayoutMode): AtlasLayoutMode => (
    LAYOUT_OPTIONS.find((option) => option.value === value)?.value ?? fallback
  ),
  resolveSelectedEntity = (
    selected: AtlasQueryState["selected"],
    selectedNode: Readonly<AtlasNode> | null,
    entities: readonly AtlasEntityType[],
  ): AtlasQueryState["selected"] => {
    if (selectedNode?.entity_type === undefined || !entities.includes(selectedNode.entity_type)) {
      return DEFAULT_ATLAS_QUERY_STATE.selected
    }
    return selected
  },
  selectDockEntity = (
    event: Readonly<AtlasButtonClickEvent>,
    onSelect: AtlasSelectionHandler,
  ): void => {
    const { currentTarget } = event,
      { dataset } = currentTarget,
      { entityType: rawEntityType, nodeId } = dataset,
      entityType = ENTITY_OPTIONS.find((option) => option.value === rawEntityType)?.value
    if (nodeId === undefined) {
      return
    }
    onSelect(nodeId, entityType)
  },
  selectGraphEntity = (
    nodeId: string,
    nodesById: ReadonlyMap<string, Readonly<AtlasNode>>,
    onSelect: AtlasSelectionHandler,
  ): void => {
    onSelect(nodeId, nodesById.get(nodeId)?.entity_type)
  },
  toggleValue = <Value extends string>(values: readonly Value[], value: Value | undefined): Value[] => {
    if (value === undefined) {
      return [...values]
    }
    if (values.includes(value)) {
      return values.filter((item) => item !== value)
    }
    return [...values, value]
  }

export { AtlasStageShell }
