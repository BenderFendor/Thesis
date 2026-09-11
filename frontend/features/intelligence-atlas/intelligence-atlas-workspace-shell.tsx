import type { ReadonlyAtlasQueryState } from "./lib/atlas-query-state";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { AtlasOperationsSheet } from "./atlas-operations-sheet";
import { AtlasTopbar } from "./atlas-topbar";
import { GlobalNavigation } from "@/components/global-navigation";
import {
  IngestStatusBar,
  InspectorDialog,
  ViewTabs,
  WorkspaceSurface,
} from "./intelligence-atlas-workspace-view";
import type {
  AtlasWorkspaceViewData,
  SearchController,
} from "./intelligence-atlas-workspace-hooks";
import type { AtlasWorkspaceController } from "./intelligence-atlas-workspace-actions";
import type { WriteState } from "./intelligence-atlas-workspace-helpers";
import styles from "./atlas.module.css";

interface IntelligenceAtlasWorkspaceViewProps<TInput extends HTMLInputElement = HTMLInputElement> {
  readonly state: ReadonlyAtlasQueryState;
  readonly writeState: WriteState;
  readonly search: SearchController<TInput>;
  readonly atlas: AtlasWorkspaceViewData;
  readonly controller: AtlasWorkspaceController;
}

type WorkspaceShellProps<TInput extends HTMLInputElement> =
  IntelligenceAtlasWorkspaceViewProps<TInput>;

type WorkspaceHeaderProps<TInput extends HTMLInputElement> = Pick<
  IntelligenceAtlasWorkspaceViewProps<TInput>,
  "atlas" | "controller" | "search" | "state"
>;

const WorkspaceHeader = <TInput extends HTMLInputElement>({
  state,
  search,
  atlas,
  controller,
}: DeepReadonly<WorkspaceHeaderProps<TInput>>) => (
  <AtlasTopbar
    inputRef={search.searchInputRef}
    searchText={search.searchText}
    searchOpen={search.searchOpen}
    searchItems={search.searchItems}
    activeSearchIndex={search.activeSearchIndex}
    searching={search.searching}
    focus={state.focus}
    exporting={controller.exporting}
    refreshing={atlas.graphFetching}
    indexing={atlas.stats?.indexing_active === true}
    lastIndexed={atlas.stats?.last_indexed_at}
    onSearchChange={controller.handleSearchChange}
    onSearchFocus={controller.handleSearchFocus}
    onSearchKeyDown={search.handleSearchKeyboard}
    onSearchHover={controller.handleSearchHover}
    onChooseSearchResult={controller.handleChooseSearchResult}
    onToggleFocus={controller.handleToggleFocus}
    onCopy={controller.handleCopy}
    onExport={controller.handleExportClick}
    onRefresh={controller.handleRefresh}
  />
);

const WorkspaceShell = <TInput extends HTMLInputElement>({
  state,
  writeState,
  search,
  atlas,
  controller,
}: DeepReadonly<WorkspaceShellProps<TInput>>) => (
  <div className={styles.shell}>
    <GlobalNavigation />
    <section className={styles.workspace} aria-label="SCOOP Intelligence Atlas workspace">
      <WorkspaceHeader state={state} search={search} atlas={atlas} controller={controller} />
      <ViewTabs view={state.view} onChange={controller.handleViewChange} />
      <IngestStatusBar status={atlas.ingestStatus} stats={atlas.stats} />
      <WorkspaceSurface
        state={state}
        graph={atlas.graph}
        graphLoading={atlas.graphLoading}
        graphFetching={atlas.graphFetching}
        graphError={atlas.graphError}
        selectedNode={atlas.selectedNode}
        dockNodes={controller.dockNodes}
        totalStats={atlas.totalStats}
        ownershipCoverage={controller.ownershipCoverage}
        onStateChange={writeState}
        onSelect={controller.handleSelectEntity}
        onOpenOperations={controller.handleOpenOperations}
        onRetry={controller.handleRetry}
        onDirectorySelect={controller.handleOpenDirectoryRow}
      />
    </section>
  </div>
);

export const IntelligenceAtlasWorkspaceView = <TInput extends HTMLInputElement>({
  state,
  writeState,
  search,
  atlas,
  controller,
}: DeepReadonly<IntelligenceAtlasWorkspaceViewProps<TInput>>) => (
  <main className={styles.atlas}>
    <WorkspaceShell
      state={state}
      writeState={writeState}
      search={search}
      atlas={atlas}
      controller={controller}
    />
    <InspectorDialog
      state={state}
      record={atlas.entity}
      loading={atlas.entityLoading}
      error={atlas.entityError}
      measurements={atlas.measurements}
      measurementsLoading={atlas.measurementsLoading}
      nodesById={atlas.nodesById}
      onPanelChange={controller.handleSetPanel}
      onSelect={controller.handleSelectEntity}
    />
    <AtlasOperationsSheet
      open={state.panel === "operations"}
      onOpenChange={controller.handleOperationsOpenChange}
      activeTab={controller.operationsTab}
      onTabChange={controller.handleOperationsTabChange}
      selectedSourceName={atlas.selectedSourceName}
    />
  </main>
);
