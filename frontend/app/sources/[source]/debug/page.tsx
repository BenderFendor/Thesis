"use client";

import { SourceDebugView } from "@/app/sources/[source]/debug/source-debug-view";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { use, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchSourceDebugData } from "@/lib/api";
import type { SourceDebugData } from "@/lib/api";
import { useDebugMode, useDebugModeToggle } from "@/hooks/use-debug-mode";
import { useQuery } from "@tanstack/react-query";

const DEFAULT_ERROR_MESSAGE =
  "Failed to load debug data. The source might be unavailable or the backend service is down.";
const QUERY_RETRY_COUNT = 1;

interface SourceDebugPageProps {
  readonly params: Promise<Readonly<{ source: string }>>;
}

interface SourceDebugPageState {
  readonly data: SourceDebugData | undefined;
  readonly debugMode: boolean;
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly refresh: () => void;
  readonly searchQuery: string;
  readonly setSearchQuery: (value: string) => void;
  readonly sourceName: string;
  readonly toggleDebugMode: () => void;
}

const getErrorMessage = (error: Error): string => {
  if (error.message.length > 0) {
    return error.message;
  }
  return DEFAULT_ERROR_MESSAGE;
};

const LoadingState = ({ sourceName }: Readonly<{ readonly sourceName: string }>) => (
  <div className="flex min-h-screen items-center justify-center bg-background dark">
    <div className="flex items-center gap-3 text-lg">
      <RefreshCw className="h-6 w-6 animate-spin" />
      <span>Loading debug data for {sourceName}...</span>
    </div>
  </div>
);

const ErrorState = ({
  error,
  onRetry,
}: Readonly<{ readonly error: Error; readonly onRetry: () => void }>) => (
  <div className="flex min-h-screen flex-col items-center justify-center bg-background text-red-500 dark">
    <AlertTriangle className="mb-4 h-12 w-12" />
    <h1 className="mb-2 text-2xl font-bold">Error</h1>
    <p className="max-w-md text-center">{getErrorMessage(error)}</p>
    <Button onClick={onRetry} className="mt-6">
      <RefreshCw className="mr-2 h-4 w-4" />
      Retry
    </Button>
  </div>
);

const EmptyState = ({ sourceName }: Readonly<{ readonly sourceName: string }>) => (
  <div className="flex min-h-screen items-center justify-center bg-background dark">
    <p>No debug data available for {sourceName}.</p>
  </div>
);

const useSourceDebugQuery = (sourceName: string) =>
  useQuery<SourceDebugData>({
    queryFn: () => fetchSourceDebugData(sourceName),
    queryKey: ["source-debug", sourceName],
    retry: QUERY_RETRY_COUNT,
  });

const useSourceDebugPageState = (
  paramsPromise: Promise<Readonly<{ source: string }>>,
): SourceDebugPageState => {
  const params = use(paramsPromise);
  const sourceName = decodeURIComponent(params.source);
  const [searchQuery, setSearchQuery] = useState("");
  const debugMode = useDebugMode();
  const { toggleDebugMode } = useDebugModeToggle();
  const { data, error, isLoading, refetch } = useSourceDebugQuery(sourceName);
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  return {
    data,
    debugMode,
    error,
    isLoading,
    refresh,
    searchQuery,
    setSearchQuery,
    sourceName,
    toggleDebugMode,
  };
};

const SourceDebugPage = ({ params: paramsPromise }: Readonly<SourceDebugPageProps>) => {
  const {
    data: debugData,
    debugMode,
    error,
    isLoading,
    refresh,
    searchQuery,
    setSearchQuery,
    sourceName,
    toggleDebugMode,
  } = useSourceDebugPageState(paramsPromise);

  if (isLoading) {
    return <LoadingState sourceName={sourceName} />;
  }
  if (error !== null) {
    return <ErrorState error={error} onRetry={refresh} />;
  }
  if (debugData === undefined) {
    return <EmptyState sourceName={sourceName} />;
  }

  return (
    <SourceDebugView
      debugData={debugData}
      debugMode={debugMode}
      onRefresh={refresh}
      onSearchQueryChange={setSearchQuery}
      onToggleDebugMode={toggleDebugMode}
      searchQuery={searchQuery}
    />
  );
};

export default SourceDebugPage;
