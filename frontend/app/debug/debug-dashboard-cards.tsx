import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CacheDebugResponse, CacheDeltaResponse, ChromaDebugResponse } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { formatArticleDateTime } from "@/lib/date-formatters";
import {
  debugArticleRowKey,
  debugEventClassName,
  formatMetadataValue,
} from "./debug-dashboard-utils";
import { SnapshotCard, SnapshotPagination } from "./debug-dashboard-primitives";

type DebugCacheDeltaResponse = DeepReadonly<CacheDeltaResponse>;
type DebugCacheResponse = DeepReadonly<CacheDebugResponse>;
type DebugChromaResponse = DeepReadonly<ChromaDebugResponse>;
type DebugLogEvent = Readonly<{
  event_type?: string;
  message?: string;
  timestamp?: string;
}>;

const ZERO = 0;
const EMPTY_DEBUG_LIST: readonly never[] = [];

interface BackendEventsCardProps {
  readonly backendLogEvents: readonly DebugLogEvent[];
}

const BackendEventsBody = (props: Readonly<BackendEventsCardProps>) => {
  if (props.backendLogEvents.length === ZERO) {
    return <p className="text-sm text-muted-foreground">No events logged yet</p>;
  }
  return (
    <div className="max-h-96 space-y-1 overflow-y-auto font-mono text-xs">
      {props.backendLogEvents.slice(0, 50).map((event) => (
        <div
          key={`${event.timestamp ?? "event"}-${event.event_type ?? "type"}-${event.message ?? "message"}`}
          className="flex items-start gap-2 rounded p-1 hover:bg-muted"
        >
          <span className="w-20 flex-shrink-0 text-muted-foreground">
            {new Date(event.timestamp ?? "").toLocaleTimeString()}
          </span>
          <span
            className={`flex-shrink-0 rounded px-1 text-xs ${debugEventClassName(event.event_type)}`}
          >
            {event.event_type ?? ""}
          </span>
          <span className="flex-1 truncate">{event.message ?? ""}</span>
        </div>
      ))}
    </div>
  );
};

const BackendEventsCard = (props: Readonly<BackendEventsCardProps>) => (
  <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">Recent Backend Events</CardTitle>
      <CardDescription className="font-mono text-[10px] uppercase tracking-widest">
        Last 100 debug events from the backend
      </CardDescription>
    </CardHeader>
    <CardContent>
      <BackendEventsBody backendLogEvents={props.backendLogEvents} />
    </CardContent>
  </Card>
);

interface CacheDeltaCardProps {
  readonly cacheDelta: DebugCacheDeltaResponse | undefined;
}

const CacheDeltaMetrics = (props: Readonly<CacheDeltaCardProps>) => (
  <div className="grid gap-2 md:grid-cols-4">
    <div>
      <p className="text-muted-foreground">Cache total</p>
      <p className="text-lg font-semibold">{props.cacheDelta?.cache_total ?? "-"}</p>
    </div>
    <div>
      <p className="text-muted-foreground">Cache sampled</p>
      <p className="text-lg font-semibold">{props.cacheDelta?.cache_sampled ?? "-"}</p>
    </div>
    <div>
      <p className="text-muted-foreground">DB total</p>
      <p className="text-lg font-semibold">{props.cacheDelta?.db_total ?? "-"}</p>
    </div>
    <div>
      <p className="text-muted-foreground">Missing in DB</p>
      <p className="text-lg font-semibold">{props.cacheDelta?.missing_in_db_count ?? "-"}</p>
    </div>
  </div>
);

const CacheDeltaSample = (props: Readonly<{ urls: readonly string[] }>) => {
  if (props.urls.length === ZERO) {
    return <p className="text-muted-foreground">No missing URLs in sample.</p>;
  }
  return (
    <ul className="space-y-1">
      {props.urls.map((url) => (
        <li key={url} className="break-all">
          {url}
        </li>
      ))}
    </ul>
  );
};

const CacheDeltaSamplePanel = (props: Readonly<CacheDeltaCardProps>) => (
  <div>
    <p className="mb-2 text-xs text-muted-foreground">Missing cache URLs (sample)</p>
    <div className="max-h-40 overflow-auto rounded border border-border bg-muted/30 p-3 text-xs">
      <CacheDeltaSample urls={props.cacheDelta?.missing_in_db_sample ?? EMPTY_DEBUG_LIST} />
    </div>
  </div>
);

const CacheDeltaCard = (props: Readonly<CacheDeltaCardProps>) => (
  <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">Cache vs database delta</CardTitle>
      <CardDescription className="font-mono text-[10px] uppercase tracking-widest">
        Compares the current cache window against Postgres
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4 text-sm">
      <CacheDeltaMetrics cacheDelta={props.cacheDelta} />
      <CacheDeltaSamplePanel cacheDelta={props.cacheDelta} />
    </CardContent>
  </Card>
);

interface CacheSnapshotCardProps {
  readonly cacheData: DebugCacheResponse | undefined;
  readonly cacheLimit: number;
  readonly cacheOffset: number;
  readonly setCacheLimit: (value: number) => void;
  readonly setCacheOffset: (value: number) => void;
}

const CacheSnapshotCard = (props: Readonly<CacheSnapshotCardProps>) => {
  const handleLimitChange = props.setCacheLimit;
  const handleOffsetChange = props.setCacheOffset;
  return (
    <SnapshotCard title="Cache Snapshot">
      <p>Total cached: {props.cacheData?.total ?? "-"}</p>
      <p>Showing: {props.cacheData?.returned ?? "-"}</p>
      <SnapshotPagination
        limit={props.cacheLimit}
        onLimitChange={handleLimitChange}
        offset={props.cacheOffset}
        onOffsetChange={handleOffsetChange}
      />
    </SnapshotCard>
  );
};

interface CachedArticlesCardProps {
  readonly cacheData: DebugCacheResponse | undefined;
}

const formatCachedArticleDate = (value: string): string => {
  if (value === "") {
    return "-";
  }
  return formatArticleDateTime(value);
};

const CachedArticlesHeader = () => (
  <TableHeader>
    <TableRow>
      <TableHead>Source</TableHead>
      <TableHead>Title</TableHead>
      <TableHead>Published</TableHead>
    </TableRow>
  </TableHeader>
);

const CachedArticleTitle = (props: Readonly<{ href: string; title: string }>) => (
  <a
    href={props.href}
    target="_blank"
    rel="noopener noreferrer"
    className="text-primary underline-offset-2 hover:underline"
  >
    {props.title}
  </a>
);

const CachedArticlesRows = (props: Readonly<CachedArticlesCardProps>) => (
  <TableBody>
    {props.cacheData?.articles?.map((article) => (
      <CachedArticleRow
        key={debugArticleRowKey(article.id ?? article.link, article.link)}
        article={article}
      />
    ))}
  </TableBody>
);

const CachedArticleRow = (
  props: Readonly<{ article: NonNullable<DebugCacheResponse["articles"]>[number] }>,
) => (
  <TableRow>
    <TableCell>{props.article.source}</TableCell>
    <TableCell>
      <CachedArticleTitle href={props.article.link} title={props.article.title} />
    </TableCell>
    <TableCell className="text-xs text-muted-foreground">
      {formatCachedArticleDate(props.article.published)}
    </TableCell>
  </TableRow>
);

const CachedArticlesTable = (props: Readonly<CachedArticlesCardProps>) => (
  <Table>
    <CachedArticlesHeader />
    <CachedArticlesRows cacheData={props.cacheData} />
    <TableCaption>
      Showing {props.cacheData?.returned ?? 0} / {props.cacheData?.total ?? 0} cached
    </TableCaption>
  </Table>
);

const CachedArticlesCard = (props: Readonly<CachedArticlesCardProps>) => (
  <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">Cached articles</CardTitle>
    </CardHeader>
    <CardContent>
      <CachedArticlesTable cacheData={props.cacheData} />
    </CardContent>
  </Card>
);

interface ChromaDocumentsCardProps {
  readonly chromaData: DebugChromaResponse | undefined;
}

const ChromaDocumentsHeader = () => (
  <TableHeader>
    <TableRow>
      <TableHead>ID</TableHead>
      <TableHead>Title</TableHead>
      <TableHead>Source</TableHead>
      <TableHead>Preview</TableHead>
    </TableRow>
  </TableHeader>
);

const ChromaDocumentRow = (
  props: Readonly<{ article: DebugChromaResponse["articles"][number] }>,
) => (
  <TableRow
    key={debugArticleRowKey(
      props.article.id,
      formatMetadataValue(props.article.metadata?.source) ?? "unknown",
    )}
  >
    <TableCell className="font-mono text-xs">{props.article.id}</TableCell>
    <TableCell>{formatMetadataValue(props.article.metadata?.title) ?? "(no title)"}</TableCell>
    <TableCell>{formatMetadataValue(props.article.metadata?.source) ?? "?"}</TableCell>
    <TableCell className="text-xs text-muted-foreground">{props.article.preview}</TableCell>
  </TableRow>
);

const ChromaDocumentsRows = (props: Readonly<ChromaDocumentsCardProps>) => (
  <TableBody>
    {props.chromaData?.articles.map((article) => (
      <ChromaDocumentRow
        key={debugArticleRowKey(
          article.id,
          formatMetadataValue(article.metadata?.source) ?? "unknown",
        )}
        article={article}
      />
    ))}
  </TableBody>
);

const ChromaDocumentsTable = (props: Readonly<ChromaDocumentsCardProps>) => (
  <Table>
    <ChromaDocumentsHeader />
    <ChromaDocumentsRows chromaData={props.chromaData} />
    <TableCaption>
      Showing {props.chromaData?.returned ?? 0} /{" "}
      {props.chromaData?.total ?? props.chromaData?.returned ?? 0} vectors
    </TableCaption>
  </Table>
);

const ChromaDocumentsCard = (props: Readonly<ChromaDocumentsCardProps>) => (
  <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">Chroma documents</CardTitle>
    </CardHeader>
    <CardContent>
      <ChromaDocumentsTable chromaData={props.chromaData} />
    </CardContent>
  </Card>
);

interface ChromaSnapshotCardProps {
  readonly chromaData: DebugChromaResponse | undefined;
  readonly chromaLimit: number;
  readonly chromaOffset: number;
  readonly setChromaLimit: (value: number) => void;
  readonly setChromaOffset: (value: number) => void;
}

const ChromaSnapshotCard = (props: Readonly<ChromaSnapshotCardProps>) => {
  const handleLimitChange = props.setChromaLimit;
  const handleOffsetChange = props.setChromaOffset;
  return (
    <SnapshotCard title="Chroma Snapshot">
      <p>Total vectors: {props.chromaData?.total ?? "-"}</p>
      <p>Showing: {props.chromaData?.returned ?? "-"}</p>
      <SnapshotPagination
        limit={props.chromaLimit}
        onLimitChange={handleLimitChange}
        offset={props.chromaOffset}
        onOffsetChange={handleOffsetChange}
      />
    </SnapshotCard>
  );
};

export {
  BackendEventsCard,
  CacheDeltaCard,
  CacheSnapshotCard,
  CachedArticlesCard,
  ChromaDocumentsCard,
  ChromaSnapshotCard,
};
