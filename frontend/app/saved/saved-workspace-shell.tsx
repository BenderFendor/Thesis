import { ArrowLeft, Loader2 } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import type { ControllerProps } from "@/app/saved/saved-workspace-types";

const LoadIssuesContent = (props: Readonly<{ issues: readonly string[] }>): ReactElement => (
  <div>
    <h2 className="font-semibold text-amber-100">Some saved data is unavailable</h2>
    <p className="mt-1 text-sm text-amber-50/80">{props.issues.join(" ")}</p>
  </div>
);

const RetryButton = (props: Readonly<{ onClick: () => void }>): ReactElement => (
  <Button variant="outline" size="sm" onClick={props.onClick}>
    Retry
  </Button>
);

const LoadIssuesCard = (props: Readonly<ControllerProps>): ReactElement | null => {
  const { controller } = props;
  const handleRetry = useCallback(() => {
    void controller.reload();
  }, [controller]);
  if (controller.loadIssues.length === 0) {
    return null;
  }
  return (
    <Card className="mb-6 border-amber-500/30 bg-amber-500/10">
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <LoadIssuesContent issues={controller.loadIssues} />
        <RetryButton onClick={handleRetry} />
      </CardContent>
    </Card>
  );
};

const WorkspaceTitle = (): ReactElement => (
  <div>
    <h1 className="font-serif text-2xl font-bold text-foreground">Reader Workspace</h1>
    <p className="text-sm text-muted-foreground">
      Bookmarks, queue, highlights, and reading context in one place
    </p>
  </div>
);

const WorkspaceHeaderLeft = (): ReactElement => (
  <div className="flex items-center gap-3">
    <Link href="/" className={buttonVariants({ size: "sm", variant: "ghost" })} data-slot="button">
      <ArrowLeft className="mr-2 h-4 w-4" />
      Back to News
    </Link>
    <WorkspaceTitle />
  </div>
);

const getRefreshIconClassName = (loading: boolean): string => {
  if (loading) {
    return "mr-2 h-4 w-4 animate-spin";
  }
  return "mr-2 h-4 w-4";
};

const WorkspaceRefreshButton = (
  props: Readonly<{ disabled: boolean; loading: boolean; onClick: () => void }>,
): ReactElement => (
  <Button onClick={props.onClick} disabled={props.disabled} variant="outline" size="sm">
    <Loader2 className={getRefreshIconClassName(props.loading)} />
    Refresh
  </Button>
);

const WorkspaceHeaderContent = (props: Readonly<ControllerProps>): ReactElement => {
  const { controller } = props;
  const handleReload = useCallback(() => {
    void controller.reload();
  }, [controller]);
  return (
    <div className="flex items-center justify-between">
      <WorkspaceHeaderLeft />
      <WorkspaceRefreshButton
        onClick={handleReload}
        disabled={controller.loading}
        loading={controller.loading}
      />
    </div>
  );
};

const WorkspaceHeaderContainer = (props: Readonly<ControllerProps>): ReactElement => (
  <div className="container mx-auto px-4 py-4">
    <WorkspaceHeaderContent controller={props.controller} />
  </div>
);

const WorkspaceHeader = (props: Readonly<ControllerProps>): ReactElement => (
  <header className="sticky top-0 z-50 border-b border-white/10 bg-[var(--news-bg-secondary)]/60 backdrop-blur-sm">
    <WorkspaceHeaderContainer controller={props.controller} />
  </header>
);

export { LoadIssuesCard, WorkspaceHeader };
