import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import type { DeepReadonly } from "@/lib/deep-readonly";
import {
  formatDuration,
  formatTimestamp,
  sourceStatsRowKey,
  sourceStatusTone,
  textOr,
} from "./debug-dashboard-utils";
import type { SourcesSectionProps } from "./debug-dashboard-types";

const ZERO = 0;

const cacheRefreshState = (inProgress: boolean | undefined): string => {
  if (inProgress === true) {
    return "Running";
  }
  return "Idle";
};

const SourceCacheCategories = (
  props: Readonly<{ categories: readonly (readonly [string, number])[] }>,
) => {
  if (props.categories.length === ZERO) {
    return <p className="text-muted-foreground">No category breakdown available.</p>;
  }
  return (
    <div className="space-y-1 text-muted-foreground">
      {props.categories.map(([category, count]) => (
        <div key={category} className="flex items-center justify-between">
          <span>{category}</span>
          <span>{count}</span>
        </div>
      ))}
    </div>
  );
};

const SourceCacheSummary = (props: DeepReadonly<Pick<SourcesSectionProps, "cacheStatus">>) => (
  <>
    <p>Total cached articles: {props.cacheStatus?.total_articles ?? "—"}</p>
    <p>Refresh state: {cacheRefreshState(props.cacheStatus?.update_in_progress)}</p>
    <p>Cache age: {formatDuration(props.cacheStatus?.cache_age_seconds)}</p>
  </>
);

const SourceCacheSnapshot = (props: DeepReadonly<Pick<SourcesSectionProps, "cacheStatus">>) => {
  const categories = Object.entries(props.cacheStatus?.category_breakdown ?? {}).toSorted(
    (firstCategory, secondCategory) => secondCategory[1] - firstCategory[1],
  );
  return (
    <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
      <CardHeader>
        <CardTitle className="font-serif">Cache Snapshot</CardTitle>
        <CardDescription className="font-mono text-[10px] uppercase tracking-widest">
          Last update {formatTimestamp(props.cacheStatus?.last_updated)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <SourceCacheSummary cacheStatus={props.cacheStatus} />
        <SourceCategoryBreakdown categories={categories} />
      </CardContent>
    </Card>
  );
};

const SourceCategoryBreakdown = (
  props: Readonly<{ categories: readonly (readonly [string, number])[] }>,
) => (
  <div className="space-y-1">
    <p className="font-medium">Category breakdown</p>
    <SourceCacheCategories categories={props.categories} />
  </div>
);

const SourceHealthHeader = () => (
  <TableHeader>
    <TableRow>
      <TableHead>Source</TableHead>
      <TableHead>Status</TableHead>
      <TableHead>Country</TableHead>
      <TableHead>Articles</TableHead>
      <TableHead>Checked</TableHead>
    </TableRow>
  </TableHeader>
);

const SourceHealthIdentity = (
  props: DeepReadonly<Pick<SourcesSectionProps, "sourceStats">>["sourceStats"][number],
) => (
  <div className="space-y-1">
    <div className="font-medium">{props.name}</div>
    <div className="text-xs text-muted-foreground">
      {props.category} · {textOr(props.funding_type, "unknown funding")}
    </div>
    {textOr(props.error_message, "") !== "" && (
      <div className="text-xs text-red-600 dark:text-red-400">{props.error_message}</div>
    )}
  </div>
);

const SourceHealthRow = (
  props: DeepReadonly<{ source: SourcesSectionProps["sourceStats"][number] }>,
) => (
  <TableRow>
    <TableCell>
      <SourceHealthIdentity
        article_count={props.source.article_count}
        bias_rating={props.source.bias_rating}
        category={props.source.category}
        country={props.source.country}
        error_message={props.source.error_message}
        funding_type={props.source.funding_type}
        last_checked={props.source.last_checked}
        name={props.source.name}
        status={props.source.status}
        url={props.source.url}
      />
    </TableCell>
    <TableCell className={sourceStatusTone(props.source.status)}>{props.source.status}</TableCell>
    <TableCell>{textOr(props.source.country, "—")}</TableCell>
    <TableCell>{props.source.article_count}</TableCell>
    <TableCell className="text-xs text-muted-foreground">
      {formatTimestamp(props.source.last_checked)}
    </TableCell>
  </TableRow>
);

const SourceHealthRows = (props: DeepReadonly<Pick<SourcesSectionProps, "sourceStats">>) => (
  <TableBody>
    {props.sourceStats.map((source) => (
      <SourceHealthRow key={sourceStatsRowKey(source)} source={source} />
    ))}
  </TableBody>
);

const SourceHealthTable = (props: DeepReadonly<Pick<SourcesSectionProps, "sourceStats">>) => {
  if (props.sourceStats.length === ZERO) {
    return (
      <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
        <CardHeader>
          <CardTitle className="font-serif">Source Health</CardTitle>
          <CardDescription className="font-mono text-[10px] uppercase tracking-widest">
            Current feed status from the ingestion catalog.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No source statistics available.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
      <CardHeader>
        <CardTitle className="font-serif">Source Health</CardTitle>
        <CardDescription className="font-mono text-[10px] uppercase tracking-widest">
          Current feed status from the ingestion catalog.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SourceHealthTableContent sourceStats={props.sourceStats} />
      </CardContent>
    </Card>
  );
};

const SourceHealthTableContent = (
  props: DeepReadonly<Pick<SourcesSectionProps, "sourceStats">>,
) => (
  <div className="max-h-[32rem] overflow-y-auto">
    <Table>
      <SourceHealthHeader />
      <SourceHealthRows sourceStats={props.sourceStats} />
    </Table>
  </div>
);

const SourceMetricCard = (props: Readonly<{ label: string; value: number }>) => (
  <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">{props.label}</CardTitle>
    </CardHeader>
    <CardContent className="text-2xl font-semibold">{props.value}</CardContent>
  </Card>
);

const SourceMetricCards = (
  props: DeepReadonly<Pick<SourcesSectionProps, "sourceStats" | "cacheStatus">>,
) => {
  const healthy = props.sourceStats.filter((source) => source.status === "success").length;
  const warnings = props.sourceStats.filter((source) => source.status === "warning").length;
  const errors = props.sourceStats.filter((source) => source.status === "error").length;
  const metrics: readonly Readonly<{ label: string; value: number }>[] = [
    { label: "Total Sources", value: props.cacheStatus?.total_sources ?? props.sourceStats.length },
    { label: "Healthy", value: props.cacheStatus?.sources_working ?? healthy },
    { label: "Warnings", value: props.cacheStatus?.sources_with_warnings ?? warnings },
    { label: "Errors", value: props.cacheStatus?.sources_with_errors ?? errors },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-4">
      {metrics.map((metric) => (
        <SourceMetricCard key={metric.label} label={metric.label} value={metric.value} />
      ))}
    </div>
  );
};

const refreshNoticeClass = (hasError: boolean): string => {
  if (hasError) {
    return "border-red-500/30 bg-red-500/10 bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg";
  }
  return "border-white/5 bg-black/20 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg";
};

const CacheRefreshNotice = (
  props: DeepReadonly<Pick<SourcesSectionProps, "cacheRefreshError" | "cacheRefreshMessage">>,
) => {
  const error = textOr(props.cacheRefreshError, "");
  const message = textOr(props.cacheRefreshMessage, "");
  if (error === "" && message === "") {
    return null;
  }
  if (error === "") {
    return <CacheRefreshNoticeCard message={message} hasError={false} />;
  }
  return <CacheRefreshNoticeCard message={error} hasError />;
};

const CacheRefreshNoticeCard = (props: Readonly<{ hasError: boolean; message: string }>) => (
  <Card className={refreshNoticeClass(props.hasError)}>
    <CardContent className="py-4 text-sm">{props.message}</CardContent>
  </Card>
);

const SourcesHeader = (
  props: DeepReadonly<
    Pick<SourcesSectionProps, "onRefresh" | "onRefreshCache" | "cacheRefreshRunning">
  >,
) => {
  const handleRefresh = props.onRefresh;
  const handleRefreshCache = props.onRefreshCache;
  const refreshLabel = refreshButtonLabel(props.cacheRefreshRunning);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-medium font-serif">Ingestion And Sources</h2>
        <p className="text-sm text-muted-foreground">
          Source health, cache coverage, and refresh controls in one place.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={handleRefresh}>
          Refresh source data
        </Button>
        <Button onClick={handleRefreshCache} disabled={props.cacheRefreshRunning}>
          {refreshLabel}
        </Button>
      </div>
    </div>
  );
};

const refreshButtonLabel = (running: boolean): string => {
  if (running) {
    return "Refreshing cache...";
  }
  return "Run cache refresh";
};

const SourcesSection = (props: DeepReadonly<SourcesSectionProps>) => (
  <TabsContent value="sources" className="space-y-4">
    <SourcesHeader
      cacheRefreshRunning={props.cacheRefreshRunning}
      onRefresh={props.onRefresh}
      onRefreshCache={props.onRefreshCache}
    />
    <CacheRefreshNotice
      cacheRefreshError={props.cacheRefreshError}
      cacheRefreshMessage={props.cacheRefreshMessage}
    />
    <SourceMetricCards cacheStatus={props.cacheStatus} sourceStats={props.sourceStats} />
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1.8fr]">
      <SourceCacheSnapshot cacheStatus={props.cacheStatus} />
      <SourceHealthTable sourceStats={props.sourceStats} />
    </div>
  </TabsContent>
);

export { SourcesSection };
