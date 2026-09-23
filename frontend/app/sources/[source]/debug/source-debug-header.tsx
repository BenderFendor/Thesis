"use client";

import { Button } from "@/components/ui/button";
import type { SourceDebugData } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { ArrowLeft, ExternalLink, RefreshCw, Settings } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";

interface SourceDebugHeaderProps {
  readonly debugData: ReadonlySourceDebugData;
  readonly debugMode: boolean;
  readonly onRefresh: () => void;
  readonly onToggleDebugMode: () => void;
}

type ReadonlySourceDebugData = DeepReadonly<SourceDebugData>;

const DebugBackLink = () => (
  <Link
    href="/debug?tab=sources"
    aria-label="Back to source debug dashboard"
    className="text-muted-foreground transition-colors hover:text-foreground"
  >
    <ArrowLeft className="h-5 w-5" />
  </Link>
);

const DebugHeaderText = ({
  debugData,
}: Readonly<{ readonly debugData: ReadonlySourceDebugData }>) => (
  <div>
    <h1 className="text-2xl font-bold">
      Debug: <span className="text-primary">{debugData.source_name}</span>
    </h1>
    <p className="text-sm text-muted-foreground">Raw RSS feed data and parsing analysis.</p>
  </div>
);

const DebugHeaderIdentity = ({
  debugData,
}: Readonly<{ readonly debugData: ReadonlySourceDebugData }>) => (
  <div className="flex items-center gap-4">
    <DebugBackLink />
    <DebugHeaderText debugData={debugData} />
  </div>
);

const DebugHeaderActions = ({
  debugData,
  debugMode,
  onRefresh,
  onToggleDebugMode,
}: Readonly<SourceDebugHeaderProps>) => {
  const openRssFeed = useCallback(() => {
    globalThis.open(debugData.rss_url, "_blank");
  }, [debugData.rss_url]);
  let debugLabel = "Off";
  if (debugMode) {
    debugLabel = "On";
  }
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={openRssFeed}>
        <ExternalLink className="mr-2 h-4 w-4" />
        Open RSS Feed
      </Button>
      <Button variant="outline" size="sm" onClick={onToggleDebugMode}>
        <Settings className="mr-2 h-4 w-4" />
        Debug {debugLabel}
      </Button>
      <Button onClick={onRefresh} size="sm">
        <RefreshCw className="mr-2 h-4 w-4" />
        Refresh
      </Button>
    </div>
  );
};

const SourceDebugHeader = ({
  debugData,
  debugMode,
  onRefresh,
  onToggleDebugMode,
}: Readonly<SourceDebugHeaderProps>) => (
  <header className="mb-6">
    <div className="flex items-center justify-between">
      <DebugHeaderIdentity debugData={debugData} />
      <DebugHeaderActions
        debugData={debugData}
        debugMode={debugMode}
        onRefresh={onRefresh}
        onToggleDebugMode={onToggleDebugMode}
      />
    </div>
  </header>
);

export { SourceDebugHeader };
