"use client";

import { Badge } from "@/components/ui/badge";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SourceDebugData } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { AlertTriangle, Code, FileText, Globe, ImageIcon } from "lucide-react";
import type { ComponentProps, CSSProperties, ReactElement, ReactNode } from "react";
import { getImagePercentage } from "./source-debug-data";

type ReadonlySourceDebugData = DeepReadonly<SourceDebugData>;
type SourceDebugEntry = ReadonlySourceDebugData["parsed_entries"][number];
type SourceStatistics = NonNullable<ReadonlySourceDebugData["source_statistics"]>;
type SourceSubFeed = NonNullable<SourceStatistics["sub_feeds"]>[number];

type SectionKind = "code" | "entries" | "globe" | "image";

interface SectionProps {
  readonly kind: SectionKind;
  readonly title: string;
}

interface SectionBodyProps {
  readonly children: Readonly<ReactElement> | readonly Readonly<ReactElement>[];
}

const SectionHeading = ({
  kind,
  title,
}: SectionProps) => (
  <CardTitle className="flex items-center gap-2">
    <SectionIcon kind={kind} />
    {title}
  </CardTitle>
);

const SectionIcon = ({ kind }: Readonly<{ readonly kind: SectionKind }>) => {
  if (kind === "code") {
    return <Code className="h-5 w-5" />;
  }
  if (kind === "entries") {
    return <FileText className="h-5 w-5" />;
  }
  if (kind === "image") {
    return <ImageIcon className="h-5 w-5" />;
  }
  return <Globe className="h-5 w-5" />;
};

const SectionHeader = ({
  kind,
  title,
}: SectionProps) => (
  <CardHeader>
    <SectionHeading kind={kind} title={title} />
  </CardHeader>
);

const SectionSummary = ({
  kind,
  title,
}: SectionProps) => (
  <summary aria-label={title} className="cursor-pointer">
    <SectionHeader kind={kind} title={title} />
  </summary>
);

const SectionBody = ({ children }: Readonly<Pick<SectionBodyProps, "children">>) => (
  <CardContent>{children}</CardContent>
);

const FeedIssueText = ({
  bozoException,
  processingError,
}: Readonly<{ readonly bozoException: string; readonly processingError?: string }>) => {
  let bozoMessage: ReactNode = null;
  if (bozoException.length > 0) {
    bozoMessage = (
      <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-300">
        <strong>Bozo Feed:</strong> {bozoException}
      </p>
    );
  }
  let processingMessage: ReactNode = null;
  if (processingError !== undefined && processingError.length > 0) {
    processingMessage = (
      <p className="mt-1 text-sm text-red-700 dark:text-red-300">
        <strong>Processing Error:</strong> {processingError}
      </p>
    );
  }
  return (
    <div>
      <h4 className="font-semibold text-yellow-800 dark:text-yellow-200">Feed Issue Detected</h4>
      {bozoMessage}
      {processingMessage}
    </div>
  );
};

const FeedIssue = ({ debugData }: Readonly<{ readonly debugData: ReadonlySourceDebugData }>) => {
  const hasBozoError = debugData.feed_status.bozo;
  const processingError = debugData.error;
  if (!hasBozoError && (processingError === undefined || processingError.length === 0)) {
    return null;
  }
  return (
    <div className="mt-4 rounded-md border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-900/20">
      <AlertTriangle className="mt-1 h-5 w-5 text-yellow-600 dark:text-yellow-400" />
      <FeedIssueText
        bozoException={debugData.feed_status.bozo_exception}
        processingError={processingError}
      />
    </div>
  );
};

const FeedMetric = ({ label, value }: Readonly<{ readonly label: string; readonly value: number | string }>) => (
  <div>
    <p className="text-2xl font-bold">{value}</p>
    <p className="text-xs text-muted-foreground">{label}</p>
  </div>
);

const FeedMetrics = ({ debugData }: Readonly<{ readonly debugData: ReadonlySourceDebugData }>) => (
  <div className="grid grid-cols-2 gap-4 text-center md:grid-cols-4">
    <FeedMetric label="HTTP Status" value={debugData.feed_status.http_status} />
    <FeedMetric label="RSS Entries" value={debugData.feed_status.entries_count} />
    <FeedMetric label="Cached Articles" value={debugData.cached_articles.length} />
    <FeedMetric label="With Images" value={debugData.image_analysis.entries_with_images} />
  </div>
);

const FeedOverviewContent = ({
  debugData,
}: Readonly<{ readonly debugData: ReadonlySourceDebugData }>) => (
  <>
    <FeedMetrics debugData={debugData} />
    <FeedIssue debugData={debugData} />
  </>
);

const FeedOverviewSection = ({
  debugData,
}: Readonly<{ readonly debugData: ReadonlySourceDebugData }>) => (
  <details open>
    <SectionSummary kind="globe" title="Feed Overview" />
    <SectionBody>
      <FeedOverviewContent debugData={debugData} />
    </SectionBody>
  </details>
);

const getSubFeedBadgeVariant = (
  status: "success" | "warning" | "error",
): ComponentProps<typeof Badge>["variant"] => {
  if (status === "success") {
    return "default";
  }
  return "secondary";
};

const SubFeedHeader = ({
  status,
  url,
}: Readonly<{ readonly status: "success" | "warning" | "error"; readonly url: string }>) => (
  <div className="mb-2 flex items-start justify-between">
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="truncate font-mono text-sm text-blue-400 hover:underline"
    >
      {url}
    </a>
    <Badge variant={getSubFeedBadgeVariant(status)}>{status}</Badge>
  </div>
);

const SubFeedCard = ({
  subFeed,
}: Readonly<{ readonly subFeed: SourceSubFeed }>) => {
  let errorMessage: ReactNode = null;
  if (subFeed.error !== undefined && subFeed.error.length > 0) {
    errorMessage = <span> · Error: {subFeed.error}</span>;
  }
  return (
    <div className="rounded-lg border border-muted p-3">
      <SubFeedHeader status={subFeed.status} url={subFeed.url} />
      <p className="text-xs text-muted-foreground">
        {subFeed.article_count} articles
        {errorMessage}
      </p>
    </div>
  );
};

const SubFeedList = ({
  subFeeds,
}: Readonly<{ readonly subFeeds: NonNullable<SourceStatistics["sub_feeds"]> }>) => (
  <div className="space-y-3">
    {subFeeds.map((subFeed) => (
      <SubFeedCard key={`${subFeed.url}-${subFeed.article_count}`} subFeed={subFeed} />
    ))}
  </div>
);

const SubFeedsSection = ({
  debugData,
}: Readonly<{ readonly debugData: ReadonlySourceDebugData }>) => {
  const statistics = debugData.source_statistics;
  if (
    statistics === null ||
    statistics === undefined ||
    statistics.is_consolidated !== true ||
    statistics.sub_feeds === undefined ||
    statistics.sub_feeds.length === 0
  ) {
    return null;
  }
  return (
    <details open>
      <SectionSummary kind="globe" title={`Sub-Feeds (${statistics.sub_feeds.length})`} />
      <SectionBody>
        <SubFeedList subFeeds={statistics.sub_feeds} />
      </SectionBody>
    </details>
  );
};

const getProgressStyle = (percentage: number): CSSProperties => ({ width: `${percentage}%` });

const ImageAnalysisContent = ({
  debugData,
}: Readonly<{ readonly debugData: ReadonlySourceDebugData }>) => {
  const percentage = getImagePercentage(debugData);
  const analysis = debugData.image_analysis;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm">Images found in entries:</span>
        <Badge>
          {analysis.entries_with_images} / {analysis.total_entries}
        </Badge>
      </div>
      <div className="h-2.5 w-full rounded-full bg-muted">
        <div className="h-2.5 rounded-full bg-primary" style={getProgressStyle(percentage)} />
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {percentage}% of entries have images.
      </p>
    </div>
  );
};

const ImageAnalysisSection = ({
  debugData,
}: Readonly<{ readonly debugData: ReadonlySourceDebugData }>) => (
  <details>
    <SectionSummary kind="image" title="Image Parsing Analysis" />
    <SectionBody>
      <ImageAnalysisContent debugData={debugData} />
    </SectionBody>
  </details>
);

const EntryImageBadges = ({
  entry,
}: Readonly<{ readonly entry: SourceDebugEntry }>) => {
  if (!entry.has_images) {
    return null;
  }
  return (
    <div className="mt-3 border-t border-muted pt-3">
      <div className="mb-2 text-xs font-medium text-foreground">Images found in:</div>
      <EntryImageBadgeList entry={entry} />
    </div>
  );
};

const EntryImageBadgeList = ({
  entry,
}: Readonly<{ readonly entry: SourceDebugEntry }>) => {
  let contentBadge: ReactNode = null;
  if (entry.content_images.length > 0) {
    contentBadge = <Badge variant="outline">Content ({entry.content_images.length})</Badge>;
  }
  let descriptionBadge: ReactNode = null;
  if (entry.description_images.length > 0) {
    descriptionBadge = <Badge variant="outline">Description ({entry.description_images.length})</Badge>;
  }
  let metadataBadge: ReactNode = null;
  if (entry.image_sources.length > 0) {
    metadataBadge = <Badge variant="outline">Metadata ({entry.image_sources.length})</Badge>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {contentBadge}
      {descriptionBadge}
      {metadataBadge}
    </div>
  );
};

const ParsedEntryList = ({
  entries,
}: Readonly<{ readonly entries: ReadonlySourceDebugData["parsed_entries"] }>) => (
  <div className="space-y-4">
    {entries.slice(0, 5).map((entry) => (
      <ParsedEntryCard key={`entry-${entry.index}-${entry.link}`} entry={entry} />
    ))}
  </div>
);

const getAuthorLabel = (author: string): string => {
  if (author.length > 0) {
    return author;
  }
  return "N/A";
};

const ParsedEntryHeader = ({
  entry,
}: Readonly<{ readonly entry: SourceDebugEntry }>) => (
  <div className="mb-2 flex items-start justify-between">
    <h4 className="line-clamp-2 text-base font-semibold">{entry.title}</h4>
    <div className="ml-2 flex flex-shrink-0 gap-2">
      {entry.has_images && <Badge variant="secondary" className="text-xs">Has Images</Badge>}
      <Badge variant="outline" className="text-xs">
        #{entry.index + 1}
      </Badge>
    </div>
  </div>
);

const ParsedEntryMeta = ({
  entry,
}: Readonly<{ readonly entry: SourceDebugEntry }>) => (
  <div className="flex items-center justify-between text-xs text-muted-foreground">
    <span>Published: {entry.published}</span>
    <span>Author: {getAuthorLabel(entry.author)}</span>
  </div>
);

const ParsedEntryCard = ({
  entry,
}: Readonly<{ readonly entry: SourceDebugEntry }>) => (
  <div className="rounded-lg border border-muted p-4">
    <ParsedEntryHeader entry={entry} />
    <p className="mb-3 line-clamp-3 text-sm text-muted-foreground">{entry.description}</p>
    <ParsedEntryMeta entry={entry} />
    <EntryImageBadges entry={entry} />
  </div>
);

const ParsedEntriesSection = ({
  debugData,
}: Readonly<{ readonly debugData: ReadonlySourceDebugData }>) => {
  if (debugData.parsed_entries.length === 0) {
    return null;
  }
  return (
    <details>
      <SectionSummary kind="entries" title="Sample Parsed Entries (First 5)" />
      <SectionBody>
        <ParsedEntryList entries={debugData.parsed_entries} />
      </SectionBody>
    </details>
  );
};

export {
  FeedOverviewSection,
  ImageAnalysisSection,
  ParsedEntriesSection,
  SectionBody,
  SectionSummary,
  SubFeedsSection,
};
