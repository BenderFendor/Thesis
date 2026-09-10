"use client";

import {
  ActiveFilterBadge,
  CoverageSection,
  LensSection,
  SourceSearch,
  SourceSidebarHeader,
  WikiSection,
} from "./source-sidebar-controls";
import { SidebarContent } from "./source-sidebar-content";
import { useSourceSidebarState } from "./source-sidebar-state";
import type { SourceSidebarProps, SourceSidebarState } from "./source-sidebar-state";

interface SourceSidebarFrameProps {
  readonly onClose: () => void;
  readonly state: SourceSidebarState;
}

const SourceSidebarPanel = ({ onClose, state }: Readonly<SourceSidebarFrameProps>) => (
  <aside className="relative flex w-full max-w-[22rem] flex-col overflow-hidden border-r border-white/10 bg-[var(--news-bg-secondary)] sm:w-80">
    <SourceSidebarHeader onClose={onClose} onSourceAdded={state.handleRetry} />
    <ActiveFilterBadge
      active={state.filterActive}
      label={state.filterLabel}
      onClear={state.handleClearFilters}
    />
    <CoverageSection
      selectedSourceIds={state.selectedSourceIds}
      sourceNameLookup={state.sourceNameLookup}
    />
    <SourceSearch onChange={state.handleSearchChange} searchQuery={state.searchQuery} />
    <LensSection lens={state.lens} onSetLens={state.handleSetLens} />
    <WikiSection onClose={onClose} />
    <div className="flex-1 overflow-y-auto">
      <SidebarContent onClose={onClose} state={state} />
    </div>
  </aside>
);

const SourceSidebarFrame = ({ onClose, state }: Readonly<SourceSidebarFrameProps>) => (
  <div className="fixed inset-0 z-50 flex">
    <button
      type="button"
      aria-label="Close source sidebar"
      className="absolute inset-0 bg-black/50"
      onClick={onClose}
    />
    <SourceSidebarPanel onClose={onClose} state={state} />
  </div>
);

export const SourceSidebar = (props: Readonly<SourceSidebarProps>) => {
  const state = useSourceSidebarState(props);
  if (!props.isOpen) {
    return null;
  }
  return <SourceSidebarFrame onClose={props.onClose} state={state} />;
};
