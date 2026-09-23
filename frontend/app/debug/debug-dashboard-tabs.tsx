import { Tabs } from "@/components/ui/tabs";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { DebugTabNavigation } from "./debug-tab-navigation";
import { DebugDashboardTabPanels } from "./debug-dashboard-tab-panels";
import type { DebugDashboardContentProps } from "./debug-dashboard-types";

const DebugDashboardTabs = (
  props: DeepReadonly<{ dashboard: DebugDashboardContentProps }>,
) => {
  const dashboard = props.dashboard;
  const handleTabChange = dashboard.onTabChange;
  return (
    <Tabs value={dashboard.activeTab} onValueChange={handleTabChange}>
      <DebugTabNavigation />
      <DebugDashboardTabPanels dashboard={dashboard} />
    </Tabs>
  );
};

export { DebugDashboardTabs };
