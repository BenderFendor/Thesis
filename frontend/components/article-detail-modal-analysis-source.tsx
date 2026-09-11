"use client";

import { Button } from "@/components/ui/button";
import { AlertTriangle, BookOpen, Bug, DollarSign } from "lucide-react";
import type { NewsArticle, NewsSource, SourceDebugData } from "../lib/article-detail-modal-data";
import { formatArticleDate } from "@/lib/date-formatters";
import Link from "next/link";
import { useCallback } from "react";

type PropagationClickEvent = Readonly<{
  currentTarget: Readonly<{
    dataset: Readonly<{ action?: string }>;
  }>;
  stopPropagation: () => void;
}>;

const ModalSourceContent = ({
  sourceLoading,
  source,
  article,
  reporterName,
  showSourceDetails,
  onOpenSourceWiki,
  onOpenReporterWiki,
  onClose,
}: Readonly<{
  sourceLoading: boolean;
  source: Readonly<Pick<NewsSource, "country" | "funding" | "name">> | undefined;
  article: Readonly<Pick<NewsArticle, "publishedAt">>;
  reporterName: string;
  showSourceDetails: boolean;
  onOpenSourceWiki: () => void;
  onOpenReporterWiki: () => void;
  onClose: () => void;
}>) => {
  if (sourceLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }
  if (source === undefined) {
    return <p className="text-gray-400 text-sm">Source info unavailable</p>;
  }
  return (
    <SourceTransparencyDetails
      source={source}
      article={article}
      reporterName={reporterName}
      showSourceDetails={showSourceDetails}
      onOpenSourceWiki={onOpenSourceWiki}
      onOpenReporterWiki={onOpenReporterWiki}
      onClose={onClose}
    />
  );
};

const ModalSourceDebug = ({
  debugMode,
  debugOpen,
  debugLoading,
  debugData,
  matchedEntryIndex,
  onToggleDebug,
}: Readonly<{
  debugMode: boolean;
  debugOpen: boolean;
  debugLoading: boolean;
  debugData: Readonly<Pick<SourceDebugData, "feed_status" | "image_analysis">> | undefined;
  matchedEntryIndex: number | undefined;
  onToggleDebug: () => void;
}>) => {
  if (!debugMode) {
    return null;
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={onToggleDebug} className="w-full mt-4">
        <Bug className="h-4 w-4 mr-1" />{" "}
        {(() => {
          if (debugOpen) {
            return "Hide";
          }
          return "Show";
        })()}{" "}
        Debug
      </Button>
      {debugOpen && (
        <SourceDebugPanel
          loading={debugLoading}
          data={debugData}
          matchedEntryIndex={matchedEntryIndex}
        />
      )}
    </>
  );
};

const getSourceDetailsLabel = (showSourceDetails: boolean): string => {
  if (showSourceDetails) {
    return "Hide";
  }
  return "Show";
};

const SourceTransparencyHeader = ({
  showSourceDetails,
  onToggleDetails,
}: Readonly<{ showSourceDetails: boolean; onToggleDetails: () => void }>) => (
  <div className="flex items-center justify-between mb-4">
    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
      <AlertTriangle className="h-5 w-5 text-yellow-400" />
      Source
    </h3>
    <Button variant="outline" size="sm" onClick={onToggleDetails}>
      {getSourceDetailsLabel(showSourceDetails)}
    </Button>
  </div>
);

const SourceFundingRow = ({
  source,
}: Readonly<{ source: SourceTransparencyDetailsProps["source"] }>) => (
  <div className="flex items-center gap-2 text-sm">
    <DollarSign className="h-4 w-4 text-green-400" />
    <span className="text-gray-400">Funding:</span>
    <span className="text-white text-xs">{source.funding?.join(", ") || "N/A"}</span>
  </div>
);

const SourcePublishedRow = ({
  article,
}: Readonly<{ article: SourceTransparencyDetailsProps["article"] }>) => (
  <div className="flex items-center gap-2 text-sm">
    <span className="text-gray-400">Published:</span>
    <span className="text-white text-xs">{formatArticleDate(article.publishedAt)}</span>
  </div>
);

const SourceReporterRow = ({
  reporterName,
  onAction,
}: Readonly<{ reporterName: string; onAction: (event: PropagationClickEvent) => void }>) => (
  <div className="flex items-center gap-2 text-sm">
    <span className="text-gray-400">Reporter:</span>
    <button
      type="button"
      className="text-white text-xs hover:text-primary hover:underline transition-colors"
      onClick={onAction}
      data-action="reporter"
    >
      {reporterName}
    </button>
    <Link
      href={`/wiki/reporters?search=${encodeURIComponent(reporterName)}`}
      className="text-muted-foreground hover:text-primary transition-colors"
      onClick={onAction}
      data-action="reporter-link"
      title="Open reporter wiki page"
    >
      <BookOpen className="h-3 w-3" />
    </Link>
  </div>
);

const SourcePublisherRow = ({
  source,
  onAction,
}: Readonly<{
  source: SourceTransparencyDetailsProps["source"];
  onAction: (event: PropagationClickEvent) => void;
}>) => (
  <div className="flex items-center gap-2">
    <span className="text-gray-400">Publisher:</span>
    <button
      type="button"
      className="text-white hover:text-primary hover:underline transition-colors"
      onClick={onAction}
      data-action="source"
    >
      {source.name}
    </button>
    <Link
      href={`/wiki/source/${encodeURIComponent(source.name)}`}
      className="text-muted-foreground hover:text-primary transition-colors"
      onClick={onAction}
      data-action="source-link"
      title="View wiki profile"
    >
      <BookOpen className="h-3 w-3" />
    </Link>
  </div>
);

const SourceCountryRow = ({
  source,
}: Readonly<{ source: SourceTransparencyDetailsProps["source"] }>) => (
  <div>
    <span className="text-gray-400">Country:</span>
    <span className="text-white ml-2">{source.country}</span>
  </div>
);

const SourceReporterDetails = ({
  reporterName,
  onAction,
}: Readonly<{ reporterName: string; onAction: (event: PropagationClickEvent) => void }>) => {
  if (reporterName === "") {
    return null;
  }
  return <SourceReporterRow reporterName={reporterName} onAction={onAction} />;
};

interface SourceTransparencyDetailsProps {
  readonly source: Readonly<Pick<NewsSource, "country" | "funding" | "name">>;
  readonly article: Readonly<Pick<NewsArticle, "publishedAt">>;
}

const SourcePublisherDetails = ({
  source,
  onAction,
}: Readonly<{
  source: SourceTransparencyDetailsProps["source"];
  onAction: (event: PropagationClickEvent) => void;
}>) => (
  <div className="space-y-3 pt-3 border-t border-gray-700 text-sm">
    <SourcePublisherRow source={source} onAction={onAction} />
    <SourceCountryRow source={source} />
  </div>
);

type ModalSourceTransparencyProps = Readonly<{
  sourceLoading: boolean;
  source: Readonly<Pick<NewsSource, "country" | "funding" | "name">> | undefined;
  article: Readonly<Pick<NewsArticle, "publishedAt">>;
  reporterName: string;
  showSourceDetails: boolean;
  onToggleDetails: () => void;
  debugMode: boolean;
  debugOpen: boolean;
  debugLoading: boolean;
  debugData: Readonly<Pick<SourceDebugData, "feed_status" | "image_analysis">> | undefined;
  matchedEntryIndex: number | undefined;
  onToggleDebug: () => void;
  onOpenSourceWiki: () => void;
  onOpenReporterWiki: () => void;
  onClose: () => void;
}>;

const ModalSourceTransparency = ({
  sourceLoading,
  source,
  article,
  reporterName,
  showSourceDetails,
  onToggleDetails,
  debugMode,
  debugOpen,
  debugLoading,
  debugData,
  matchedEntryIndex,
  onToggleDebug,
  onOpenSourceWiki,
  onOpenReporterWiki,
  onClose,
}: ModalSourceTransparencyProps) => (
  <div className="bg-gray-900/50 rounded-lg p-6 border border-gray-800">
    <SourceTransparencyHeader
      showSourceDetails={showSourceDetails}
      onToggleDetails={onToggleDetails}
    />

    <ModalSourceContent
      sourceLoading={sourceLoading}
      source={source}
      article={article}
      reporterName={reporterName}
      showSourceDetails={showSourceDetails}
      onOpenSourceWiki={onOpenSourceWiki}
      onOpenReporterWiki={onOpenReporterWiki}
      onClose={onClose}
    />
    <ModalSourceDebug
      debugMode={debugMode}
      debugOpen={debugOpen}
      debugLoading={debugLoading}
      debugData={debugData}
      matchedEntryIndex={matchedEntryIndex}
      onToggleDebug={onToggleDebug}
    />
  </div>
);

const SourceDebugPanel = ({
  loading,
  data,
  matchedEntryIndex,
}: Readonly<{
  loading: boolean;
  data: Readonly<Pick<SourceDebugData, "feed_status" | "image_analysis">> | undefined;
  matchedEntryIndex: number | undefined;
}>) => {
  let content = <div className="text-gray-400 text-xs">No debug data</div>;
  if (loading) {
    content = (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  } else if (data !== undefined) {
    content = (
      <div className="space-y-2 text-xs">
        <div className="text-gray-400">Entries: {data.feed_status?.entries_count}</div>
        <div className="text-gray-400">
          Has Images: {data.image_analysis?.entries_with_images}
          {data.image_analysis?.total_entries}
        </div>
        {matchedEntryIndex !== undefined && (
          <div className="text-primary">Matched at index: {matchedEntryIndex}</div>
        )}
      </div>
    );
  }
  return <div className="mt-4 p-4 bg-black/40 rounded border border-gray-800">{content}</div>;
};

const SourceTransparencyDetails = ({
  source,
  article,
  reporterName,
  showSourceDetails,
  onOpenSourceWiki,
  onOpenReporterWiki,
  onClose,
}: Readonly<{
  source: Readonly<Pick<NewsSource, "country" | "funding" | "name">>;
  article: Readonly<Pick<NewsArticle, "publishedAt">>;
  reporterName: string;
  showSourceDetails: boolean;
  onOpenSourceWiki: () => void;
  onOpenReporterWiki: () => void;
  onClose: () => void;
}>) => {
  const handleSourceAction = useCallback(
    (event: PropagationClickEvent): void => {
      event.stopPropagation();
      const action = event.currentTarget.dataset.action;
      if (action === "reporter") {
        onOpenReporterWiki();
        return;
      }
      if (action === "source") {
        onOpenSourceWiki();
        return;
      }
      if (action === "reporter-link" || action === "source-link") {
        onClose();
      }
    },
    [onClose, onOpenReporterWiki, onOpenSourceWiki],
  );
  return (
    <div className="space-y-3">
      <SourceFundingRow source={source} />
      <SourcePublishedRow article={article} />
      <SourceReporterDetails reporterName={reporterName} onAction={handleSourceAction} />
      {showSourceDetails && (
        <SourcePublisherDetails source={source} onAction={handleSourceAction} />
      )}
    </div>
  );
};

export { ModalSourceTransparency };
