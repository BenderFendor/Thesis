import type { ComponentProps } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Code,
  ExternalLink,
  FileText,
  Globe,
  ImageIcon,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";
import Link from "next/link";
import JsonView from "react18-json-view";
import "react18-json-view/src/style.css";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { SourceDebugData } from "@/lib/api";

const JSON_COLLAPSE_DEPTH = 2,
 PARSED_ENTRY_LIMIT = 5,
 PERCENT_SCALE = 100;

interface SourceDebugViewProps {
  readonly debugData: Readonly<SourceDebugData>;
  readonly debugMode: boolean;
  readonly onRefresh: () => void;
  readonly onSearchQueryChange: (value: string) => void;
  readonly onToggleDebugMode: () => void;
  readonly searchQuery: string;
}

interface SourceDebugHeaderProps {
  readonly debugData: Readonly<SourceDebugData>;
  readonly debugMode: boolean;
  readonly onRefresh: () => void;
  readonly onToggleDebugMode: () => void;
}

interface DebugJsonSectionProps {
  readonly debugData: Readonly<SourceDebugData>;
  readonly onSearchQueryChange: (value: string) => void;
  readonly searchQuery: string;
}

type DebugRecord = Record<string, unknown>;

type DebugJsonValue = DebugRecord | readonly unknown[];

const isDebugRecord = (value: unknown): value is DebugRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value),

 hasFilteredContent = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isDebugRecord(value)) {
    return Object.keys(value).length > 0;
  }
  return true;
},

 filterDebugRecord = (record: Readonly<DebugRecord>, query: string): DebugRecord | undefined => {
  const filtered: DebugRecord = {};
  for (const [key, value] of Object.entries(record)) {
    const keyMatches = key.toLowerCase().includes(query),
     valueMatches =
      typeof value === "string" && value.toLowerCase().includes(query);
    if (keyMatches || valueMatches) {
      filtered[key] = value;
      continue;
    }
    const nested = filterDebugValue(value, query);
    if (hasFilteredContent(nested)) {
      filtered[key] = nested;
    }
  }
  if (Object.keys(filtered).length === 0) {
    return undefined;
  }
  return filtered;
},

 filterDebugValue = (value: unknown, query: string): unknown => {
  if (Array.isArray(value)) {
    return value
      .map((item) => filterDebugValue(item, query))
      .filter(hasFilteredContent);
  }
  if (!isDebugRecord(value)) {
    return null;
  }
  return filterDebugRecord(value, query);
},

 filterSourceDebugData = (
  debugData: Readonly<SourceDebugData>,
  searchQuery: string,
): DebugJsonValue => {
  if (searchQuery.length === 0) {
    return structuredClone(debugData);
  }
  const filtered = filterDebugValue(
    structuredClone(debugData),
    searchQuery.toLowerCase(),
  );
  if (Array.isArray(filtered) || isDebugRecord(filtered)) {
    return filtered;
  }
  return {};
},

 getDebugModeLabel = (debugMode: boolean): string => {
  if (debugMode) {
    return "On";
  }
  return "Off";
},

 getSubFeedBadgeVariant = (
  status: "success" | "warning" | "error",
): ComponentProps<typeof Badge>["variant"] => {
  if (status === "success") {
    return "default";
  }
  return "secondary";
},

 getImagePercentage = (debugData: Readonly<SourceDebugData>): number => {
  const totalEntries = debugData.image_analysis.total_entries;
  if (totalEntries <= 0) {
    return 0;
  }
  return Math.round(
    (debugData.image_analysis.entries_with_images / totalEntries) * PERCENT_SCALE,
  );
},

 SectionHeader = ({
  icon: Icon,
  title,
}: Readonly<{
  icon: typeof Globe;
  title: string;
}>) => (
  <summary className="cursor-pointer">
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Icon className="h-5 w-5" />
        {title}
      </CardTitle>
    </CardHeader>
  </summary>
),

 FeedIssue = ({ debugData }: Readonly<{ debugData: Readonly<SourceDebugData> }>) => {
  const hasBozoError = debugData.feed_status.bozo,
   processingError = debugData.error;
  if (!hasBozoError && (processingError === undefined || processingError.length === 0)) {
    return null;
  }
  return (
    <div className="mt-4 rounded-md border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-900/20">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-1 h-5 w-5 text-yellow-600 dark:text-yellow-400" />
        <div>
          <h4 className="font-semibold text-yellow-800 dark:text-yellow-200">
            Feed Issue Detected
          </h4>
          {hasBozoError && (
            <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-300">
              <strong>Bozo Feed:</strong> {debugData.feed_status.bozo_exception}
            </p>
          )}
          {processingError !== undefined && processingError.length > 0 && (
            <p className="mt-1 text-sm text-red-700 dark:text-red-300">
              <strong>Processing Error:</strong> {processingError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
},

 FeedOverviewSection = ({
  debugData,
}: Readonly<{ debugData: Readonly<SourceDebugData> }>) => (
  <details open>
    <SectionHeader icon={Globe} title="Feed Overview" />
    <CardContent>
      <div className="grid grid-cols-2 gap-4 text-center md:grid-cols-4">
        <div>
          <p className="text-2xl font-bold">{debugData.feed_status.http_status}</p>
          <p className="text-xs text-muted-foreground">HTTP Status</p>
        </div>
        <div>
          <p className="text-2xl font-bold">{debugData.feed_status.entries_count}</p>
          <p className="text-xs text-muted-foreground">RSS Entries</p>
        </div>
        <div>
          <p className="text-2xl font-bold">{debugData.cached_articles.length}</p>
          <p className="text-xs text-muted-foreground">Cached Articles</p>
        </div>
        <div>
          <p className="text-2xl font-bold">
            {debugData.image_analysis.entries_with_images}
          </p>
          <p className="text-xs text-muted-foreground">With Images</p>
        </div>
      </div>
      <FeedIssue debugData={debugData} />
    </CardContent>
  </details>
),

 SubFeedsSection = ({
  debugData,
}: Readonly<{ debugData: Readonly<SourceDebugData> }>) => {
  const statistics = debugData.source_statistics,
   subFeeds = statistics?.sub_feeds;
  if (
    statistics?.is_consolidated !== true ||
    subFeeds === undefined ||
    subFeeds.length === 0
  ) {
    return null;
  }
  return (
    <details open>
      <SectionHeader icon={Globe} title={`Sub-Feeds (${subFeeds.length})`} />
      <CardContent>
        <div className="space-y-3">
          {subFeeds.map((subFeed) => (
            <div key={subFeed.url} className="rounded-lg border border-muted p-3">
              <div className="mb-2 flex items-start justify-between">
                <a
                  href={subFeed.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate font-mono text-sm text-blue-400 hover:underline"
                >
                  {subFeed.url}
                </a>
                <Badge variant={getSubFeedBadgeVariant(subFeed.status)}>
                  {subFeed.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {subFeed.article_count} articles
                {subFeed.error !== undefined && subFeed.error.length > 0 && (
                  <span> · Error: {subFeed.error}</span>
                )}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </details>
  );
},

 ImageAnalysisSection = ({
  debugData,
}: Readonly<{ debugData: Readonly<SourceDebugData> }>) => {
  const percentage = getImagePercentage(debugData),
   analysis = debugData.image_analysis;
  return (
    <details>
      <SectionHeader icon={ImageIcon} title="Image Parsing Analysis" />
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">Images found in entries:</span>
            <Badge>
              {analysis.entries_with_images} / {analysis.total_entries}
            </Badge>
          </div>
          <div className="h-2.5 w-full rounded-full bg-muted">
            <div
              className="h-2.5 rounded-full bg-primary"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="text-center text-xs text-muted-foreground">
            {percentage}% of entries have images.
          </p>
        </div>
      </CardContent>
    </details>
  );
},

 EntryImageBadges = ({
  entry,
}: Readonly<{ entry: Readonly<SourceDebugData["parsed_entries"][number]> }>) => {
  if (!entry.has_images) {
    return;
  }
  return (
    <div className="mt-3 border-t border-muted pt-3">
      <div className="mb-2 text-xs font-medium text-foreground">Images found in:</div>
      <div className="flex flex-wrap gap-2">
        {entry.content_images.length > 0 && (
          <Badge variant="outline">Content ({entry.content_images.length})</Badge>
        )}
        {entry.description_images.length > 0 && (
          <Badge variant="outline">
            Description ({entry.description_images.length})
          </Badge>
        )}
        {entry.image_sources.length > 0 && (
          <Badge variant="outline">Metadata ({entry.image_sources.length})</Badge>
        )}
      </div>
    </div>
  );
},

 ParsedEntryCard = ({
  entry,
}: Readonly<{ entry: Readonly<SourceDebugData["parsed_entries"][number]> }>) => (
  <div className="rounded-lg border border-muted p-4">
    <div className="mb-2 flex items-start justify-between">
      <h4 className="line-clamp-2 text-base font-semibold">{entry.title}</h4>
      <div className="ml-2 flex flex-shrink-0 gap-2">
        {entry.has_images && (
          <Badge variant="secondary" className="text-xs">
            Has Images
          </Badge>
        )}
        <Badge variant="outline" className="text-xs">
          #{entry.index + 1}
        </Badge>
      </div>
    </div>
    <p className="mb-3 line-clamp-3 text-sm text-muted-foreground">
      {entry.description}
    </p>
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>Published: {entry.published}</span>
      <span>Author: {entry.author.length > 0 ? entry.author : "N/A"}</span>
    </div>
    <EntryImageBadges entry={entry} />
  </div>
),

 ParsedEntriesSection = ({
  debugData,
}: Readonly<{ debugData: Readonly<SourceDebugData> }>) => {
  if (debugData.parsed_entries.length === 0) {
    return;
  }
  return (
    <details>
      <SectionHeader icon={FileText} title={`Sample Parsed Entries (First ${PARSED_ENTRY_LIMIT})`} />
      <CardContent>
        <div className="space-y-4">
          {debugData.parsed_entries.slice(0, PARSED_ENTRY_LIMIT).map((entry) => (
            <ParsedEntryCard key={entry.link || String(entry.index)} entry={entry} />
          ))}
        </div>
      </CardContent>
    </details>
  );
},

 DebugJsonSection = ({
  debugData,
  onSearchQueryChange,
  searchQuery,
}: Readonly<DebugJsonSectionProps>) => {
  const handleSearchChange: NonNullable<ComponentProps<"input">["onChange"]> = (
    event,
  ) => {
    onSearchQueryChange(event.target.value);
  },
   filteredData = filterSourceDebugData(debugData, searchQuery);
  return (
    <details open>
      <SectionHeader icon={Code} title="Complete Debug JSON" />
      <CardContent>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
          <Input
            placeholder="Search JSON..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="pl-10"
          />
        </div>
        <JsonView
          src={filteredData}
          collapsed={JSON_COLLAPSE_DEPTH}
          enableClipboard
          theme="vscode"
        />
      </CardContent>
    </details>
  );
},

 SourceDebugHeader = ({
  debugData,
  debugMode,
  onRefresh,
  onToggleDebugMode,
}: Readonly<SourceDebugHeaderProps>) => {
  const openRssFeed = () => {
    globalThis.open(debugData.rss_url, "_blank");
  };
  return (
    <header className="mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/debug?tab=sources">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">
              Debug: <span className="text-primary">{debugData.source_name}</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Raw RSS feed data and parsing analysis.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={openRssFeed}>
            <ExternalLink className="mr-2 h-4 w-4" />
            Open RSS Feed
          </Button>
          <Button variant="outline" size="sm" onClick={onToggleDebugMode}>
            <Settings className="mr-2 h-4 w-4" />
            Debug {getDebugModeLabel(debugMode)}
          </Button>
          <Button onClick={onRefresh} size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>
    </header>
  );
};

export const SourceDebugView = ({
  debugData,
  debugMode,
  onRefresh,
  onSearchQueryChange,
  onToggleDebugMode,
  searchQuery,
}: Readonly<SourceDebugViewProps>) => (
  <div className="min-h-screen bg-background p-4 text-foreground dark sm:p-6 lg:p-8">
    <SourceDebugHeader
      debugData={debugData}
      debugMode={debugMode}
      onRefresh={onRefresh}
      onToggleDebugMode={onToggleDebugMode}
    />
    <main className="space-y-6">
      <FeedOverviewSection debugData={debugData} />
      <SubFeedsSection debugData={debugData} />
      <ImageAnalysisSection debugData={debugData} />
      <ParsedEntriesSection debugData={debugData} />
      <DebugJsonSection
        debugData={debugData}
        onSearchQueryChange={onSearchQueryChange}
        searchQuery={searchQuery}
      />
    </main>
  </div>
);
