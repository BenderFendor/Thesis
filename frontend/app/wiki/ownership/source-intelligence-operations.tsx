"use client";

import { OperationsContent } from "./source-intelligence-operations-tabs";
import { PANEL_CLASS } from "./source-intelligence-operations-helpers";
import { OperationsTabNav } from "./source-intelligence-operations-nav";
import { useOperationsState } from "./source-intelligence-operations-state";
import type { OperationsPanelProps } from "./source-intelligence-operations-types";

const SourceIntelligenceOperations = (props: Readonly<OperationsPanelProps>) => {
  const state = useOperationsState(props);
  return <OperationsPanel state={state} />;
};

const OperationsPanel = ({
  state,
}: Readonly<{
  state: ReturnType<typeof useOperationsState>;
}>) => {
  const handleTabChange = state.onTabChange;
  return (
    <section className={`${PANEL_CLASS} flex min-h-0 flex-col`}>
      <OperationsTabNav
        activeTab={state.activeTab}
        onTabChange={handleTabChange}
        tabs={state.tabs}
      />
      <div className="min-h-0 flex-1 overflow-hidden rounded-[1.2rem] border border-white/[0.08] bg-black/[0.15]">
        <OperationsContent content={state.content} />
      </div>
    </section>
  );
};

export { SourceIntelligenceOperations };
