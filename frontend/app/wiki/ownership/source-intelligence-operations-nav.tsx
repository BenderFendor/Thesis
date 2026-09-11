import { useMemo } from "react";
import type { WorkspaceTab } from "./source-intelligence-operations-types";

const OperationsTabNav = ({
  activeTab,
  onTabChange,
  tabs,
}: Readonly<{
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  tabs: readonly { readonly id: WorkspaceTab; readonly label: string }[];
}>) => {
  const tabHandlers = useMemo(
    () =>
      new Map(
        tabs.map((tab): [WorkspaceTab, () => void] => [
          tab.id,
          () => {
            onTabChange(tab.id);
          },
        ]),
      ),
    [onTabChange, tabs],
  );

  return (
    <div className="mb-4 flex shrink-0 items-center gap-6 overflow-x-auto border-b border-white/[0.08] pb-0">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={tabHandlers.get(tab.id)}
          className={tabClassName(activeTab, tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

const tabClassName = (activeTab: WorkspaceTab, tab: WorkspaceTab): string => {
  if (activeTab === tab) {
    return "whitespace-nowrap border-b-2 border-primary px-1 py-2 text-[11px] font-mono uppercase tracking-[0.18em] text-foreground";
  }
  return "whitespace-nowrap border-b-2 border-transparent px-1 py-2 text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground hover:border-white/20";
};

export { OperationsTabNav };
