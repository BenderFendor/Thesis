import { Compass, Network } from "lucide-react";
import { useCallback } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { AtlasEntityType, AtlasGraphResponse, AtlasNode } from "./lib/atlas-schema";
import type { AtlasPanel, AtlasView, ReadonlyAtlasQueryState } from "./lib/atlas-query-state";
import { AtlasEntityList } from "./atlas-entity-list";
import { AtlasInspector } from "./atlas-inspector";
import { AtlasStageShell } from "./atlas-stage-shell";
import { formatAtlasLastSuccess, VIEW_TABS } from "./intelligence-atlas-workspace-helpers";
import type {
  AtlasEntityRecord,
  AtlasIngestStatus,
  AtlasMediaMeasurements,
  AtlasStatsResponse,
  DirectoryFilterPatch,
  WriteState,
} from "./intelligence-atlas-workspace-helpers";
import styles from "./atlas.module.css";

interface ViewTabsProps {
  readonly view: AtlasView;
  readonly onChange: (view: AtlasView) => void;
}

interface ViewTabButtonProps {
  readonly label: string;
  readonly value: AtlasView;
  readonly view: AtlasView;
  readonly onChange: (view: AtlasView) => void;
}

const ViewTabButton = ({ label, value, view, onChange }: Readonly<ViewTabButtonProps>) => {
  const Icon = (() => {
    if (value === "directory") {
      return Compass;
    }
    return Network;
  })();
  const handleClick = useCallback(() => {
    onChange(value);
  }, [onChange, value]);
  return (
    <button
      type="button"
      className={styles.pillButton}
      data-active={view === value}
      aria-current={(() => {
        if (view === value) {
          return "page";
        }
        return void 0;
      })()}
      onClick={handleClick}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
};

const ViewTabs = ({ view, onChange }: Readonly<ViewTabsProps>) => (
  <nav
    className="flex items-center gap-2 border-b border-white/10 px-5 py-2"
    aria-label="Atlas view"
  >
    {VIEW_TABS.map(({ label, value }) => (
      <ViewTabButton key={value} label={label} value={value} view={view} onChange={onChange} />
    ))}
  </nav>
);

interface IngestStatusBarProps {
  readonly status: AtlasIngestStatus | undefined;
  readonly stats: AtlasStatsResponse | undefined;
}

const IngestStatusBar = ({ status, stats }: Readonly<IngestStatusBarProps>) => {
  if (status === undefined) {
    return null;
  }
  const lastSuccess = formatAtlasLastSuccess(status.last_success_at);

  return (
    <output className="flex flex-wrap items-center gap-3 border-b border-white/10 px-5 py-2 text-xs text-[#c9c3b6]">
      <span>Evidence ingestion: {status.freshness}</span>
      <span>Last success: {lastSuccess}</span>
      {stats !== undefined && (
        <span>
          Researched {stats.research_coverage.numerator.toLocaleString()} of{" "}
          {stats.research_coverage.denominator.toLocaleString()} entities
        </span>
      )}
      {status.has_retryable_failures && (
        <span className="text-amber-300">Retryable failures need attention</span>
      )}
      {status.missing_credentials.length > 0 && (
        <span className="text-amber-300">
          Missing credentials: {status.missing_credentials.join(", ")}
        </span>
      )}
    </output>
  );
};

interface WorkspaceSurfaceProps {
  readonly state: ReadonlyAtlasQueryState;
  readonly graph: AtlasGraphResponse | undefined;
  readonly graphLoading: boolean;
  readonly graphFetching: boolean;
  readonly graphError: Error | null;
  readonly selectedNode: AtlasNode | null;
  readonly dockNodes: readonly AtlasNode[];
  readonly totalStats: AtlasGraphResponse["stats"] | undefined;
  readonly ownershipCoverage: number;
  readonly onStateChange: WriteState;
  readonly onSelect: (nodeId: string, entityType?: AtlasEntityType) => void;
  readonly onOpenOperations: () => void;
  readonly onRetry: () => void;
  readonly onDirectorySelect: (node: AtlasNode) => void;
}

interface AtlasGraphSurfaceProps {
  readonly state: ReadonlyAtlasQueryState;
  readonly graph: AtlasGraphResponse | undefined;
  readonly graphLoading: boolean;
  readonly graphFetching: boolean;
  readonly graphError: Error | null;
  readonly selectedNode: AtlasNode | null;
  readonly dockNodes: readonly AtlasNode[];
  readonly totalStats: AtlasGraphResponse["stats"] | undefined;
  readonly ownershipCoverage: number;
  readonly onStateChange: WriteState;
  readonly onSelect: (nodeId: string, entityType?: AtlasEntityType) => void;
  readonly onOpenOperations: () => void;
  readonly onRetry: () => void;
}

const AtlasGraphSurface = ({
  state,
  graph,
  graphLoading,
  graphFetching,
  graphError,
  selectedNode,
  dockNodes,
  totalStats,
  ownershipCoverage,
  onStateChange,
  onSelect,
  onOpenOperations,
  onRetry,
}: Readonly<AtlasGraphSurfaceProps>) => {
  const handleOpenIndex = useCallback(() => {
    onStateChange({ view: "directory" });
  }, [onStateChange]);
  return (
    <AtlasStageShell
      state={state}
      graph={graph}
      graphVersion={graph?.graph_version ?? "loading"}
      loading={graphLoading}
      fetching={graphFetching}
      error={graphError}
      selectedNode={selectedNode}
      dockNodes={dockNodes}
      totalStats={totalStats}
      ownershipCoverage={ownershipCoverage}
      onStateChange={onStateChange}
      onSelect={onSelect}
      onOpenIndex={handleOpenIndex}
      onOpenOperations={onOpenOperations}
      onRetry={onRetry}
    />
  );
};

interface AtlasDirectorySurfaceProps {
  readonly state: ReadonlyAtlasQueryState;
  readonly onStateChange: WriteState;
  readonly onDirectorySelect: (node: AtlasNode) => void;
}

const AtlasDirectorySurface = ({
  state,
  onStateChange,
  onDirectorySelect,
}: Readonly<AtlasDirectorySurfaceProps>) => {
  const handleFiltersChange = useCallback(
    (filters: DirectoryFilterPatch) => {
      onStateChange(filters, "replace");
    },
    [onStateChange],
  );
  return (
    <AtlasEntityList
      entityTypes={state.entities}
      country={state.country}
      funding={state.funding}
      bias={state.bias}
      onFiltersChange={handleFiltersChange}
      onSelect={onDirectorySelect}
      variant="page"
      active
    />
  );
};

const WorkspaceSurface = ({
  state,
  graph,
  graphLoading,
  graphFetching,
  graphError,
  selectedNode,
  dockNodes,
  totalStats,
  ownershipCoverage,
  onStateChange,
  onSelect,
  onOpenOperations,
  onRetry,
  onDirectorySelect,
}: Readonly<WorkspaceSurfaceProps>) => {
  if (state.view === "graph") {
    return (
      <AtlasGraphSurface
        state={state}
        graph={graph}
        graphLoading={graphLoading}
        graphFetching={graphFetching}
        graphError={graphError}
        selectedNode={selectedNode}
        dockNodes={dockNodes}
        totalStats={totalStats}
        ownershipCoverage={ownershipCoverage}
        onStateChange={onStateChange}
        onSelect={onSelect}
        onOpenOperations={onOpenOperations}
        onRetry={onRetry}
      />
    );
  }

  return (
    <AtlasDirectorySurface
      state={state}
      onStateChange={onStateChange}
      onDirectorySelect={onDirectorySelect}
    />
  );
};

interface InspectorDialogProps {
  readonly state: ReadonlyAtlasQueryState;
  readonly record: AtlasEntityRecord | undefined;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly measurements: AtlasMediaMeasurements | undefined;
  readonly measurementsLoading: boolean;
  readonly nodesById: ReadonlyMap<string, AtlasNode>;
  readonly onPanelChange: (panel: AtlasPanel) => void;
  readonly onSelect: (entityId: string, entityType?: AtlasEntityType) => void;
}

const InspectorDialog = ({
  state,
  record,
  loading,
  error,
  measurements,
  measurementsLoading,
  nodesById,
  onPanelChange,
  onSelect,
}: Readonly<InspectorDialogProps>) => {
  const open = state.panel === "inspector" && state.selected !== null;
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        onPanelChange("inspector");
        return;
      }
      onPanelChange("none");
    },
    [onPanelChange],
  );
  const handleSelectConnection = useCallback(
    (entityId: string) => {
      onSelect(entityId, nodesById.get(entityId)?.entity_type);
    },
    [nodesById, onSelect],
  );
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="left-auto right-0 top-0 h-dvh w-[min(460px,100vw)] max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-r-0 border-white/10 bg-[#0d0f0c]/[0.98] p-0 text-[#f0ede4] shadow-2xl">
        <DialogTitle className="sr-only">Atlas entity inspector</DialogTitle>
        <DialogDescription className="sr-only">
          Evidence and relationships for the selected Atlas entity.
        </DialogDescription>
        <AtlasInspector
          record={record}
          loading={loading}
          error={error}
          measurements={measurements}
          measurementsLoading={measurementsLoading}
          onSelectConnection={handleSelectConnection}
        />
      </DialogContent>
    </Dialog>
  );
};

export { IngestStatusBar, InspectorDialog, ViewTabs, WorkspaceSurface };
