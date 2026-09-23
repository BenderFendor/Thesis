import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GlobalNavigation } from "@/components/global-navigation";
import type { DeepReadonly } from "@/lib/deep-readonly";
import Link from "next/link";
import { DebugDashboardTabs } from "./debug-dashboard-tabs";
import type { DebugDashboardContentProps } from "./debug-dashboard-types";

type DashboardHeaderProps = Readonly<Pick<DebugDashboardContentProps, "loading">> & {
  readonly handleRefresh: () => void;
};

const WikiLinkButton = () => (
  <Button asChild variant="outline">
    <Link href="/wiki/ownership">Open Wiki</Link>
  </Button>
);

const DashboardHeader = (props: DashboardHeaderProps) => (
  <div className="flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 className="text-2xl font-semibold font-serif">Debug Console</h1>
      <p className="text-sm text-muted-foreground">
        System status, source operations, storage inspection, parser testing, and runtime controls.
      </p>
    </div>
    <div className="flex items-center gap-2">
      {props.loading && <span className="text-sm text-muted-foreground">Refreshing...</span>}
      <WikiLinkButton />
      <Button onClick={props.handleRefresh} variant="default">
        Refresh data
      </Button>
    </div>
  </div>
);

const DashboardError = (props: Readonly<{ message: string }>) => (
  <Card className="border-red-500/30 bg-red-500/10 bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
    <CardContent className="py-4 text-sm text-red-600 dark:text-red-400">
      {props.message}
    </CardContent>
  </Card>
);

const dashboardPadding = (embedded: boolean): string => {
  if (embedded) {
    return "p-4";
  }
  return "p-6";
};

const DashboardPanel = (props: DeepReadonly<{ dashboard: DebugDashboardContentProps }>) => {
  const dashboard = props.dashboard;
  return (
    <div
      className={`flex-1 overflow-y-auto relative z-10 custom-scrollbar ${dashboardPadding(dashboard.embedded)}`}
    >
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
      <div className="space-y-6">
        {!dashboard.embedded && (
          <DashboardHeader loading={dashboard.loading} handleRefresh={dashboard.onRefresh} />
        )}
        {dashboard.error !== undefined && dashboard.error !== "" && (
          <DashboardError message={dashboard.error} />
        )}
        <DebugDashboardTabs dashboard={dashboard} />
      </div>
    </div>
  );
};

const DebugDashboardContent = (props: DeepReadonly<{ dashboard: DebugDashboardContentProps }>) => {
  const dashboard = props.dashboard;
  return (
    <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
      {!dashboard.embedded && <GlobalNavigation />}
      <DashboardPanel dashboard={dashboard} />
    </div>
  );
};

export { DebugDashboardContent };
