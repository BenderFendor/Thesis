import { Button } from "@/components/ui/button";
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
import { TabsContent } from "@/components/ui/tabs";
import type { DeepReadonly } from "@/lib/deep-readonly";
import {
  formatDuration,
  formatMetadataValue,
  formatTimestamp,
  healthLabel,
} from "./debug-dashboard-utils";
import type {
  DebugStartupEvent,
  StartupTimelineCardProps,
  SystemStatusResponse,
  SystemStatusSectionProps,
} from "./debug-dashboard-types";

interface StatusLine {
  readonly label: string;
  readonly value: string | number | undefined;
}

interface PipelineSignal {
  readonly detail: string;
  readonly label: string;
  readonly value: string | number | undefined;
}

interface PipelineSignalRowProps {
  readonly signal: PipelineSignal;
}

const PipelineSignalRow = ({ signal }: Readonly<PipelineSignalRowProps>) => (
  <div>
    <p className="text-muted-foreground">{signal.label}</p>
    <p className="text-lg font-semibold">{signal.value}</p>
    <p className="text-xs text-muted-foreground">{signal.detail}</p>
  </div>
);

const PipelineSignalsCard = (
  props: Readonly<{ systemStatus: SystemStatusResponse | undefined }>,
) => {
  const { components = {}, pipeline = {} } = props.systemStatus ?? {};
  const embeddingQueue = components.embedding_queue ?? {};
  const fetch = pipeline.fetch ?? {};
  const signals: readonly PipelineSignal[] = [
    {
      detail: "Not-modified responses in current run",
      label: "ETag hits",
      value: fetch.not_modified ?? "—",
    },
    { detail: "Failures during feed fetch", label: "Fetch errors", value: fetch.errors ?? "—" },
    {
      detail: `Batch size ${embeddingQueue.batch_size ?? "—"} · max/min ${embeddingQueue.max_per_minute ?? "—"}`,
      label: "Embedding queue depth",
      value: embeddingQueue.depth ?? "—",
    },
  ];

  return (
    <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
      <CardHeader>
        <CardTitle className="font-serif">Pipeline Signals</CardTitle>
        <CardDescription className="font-mono text-[10px] tracking-widest uppercase">
          RSS fetch cadence, cache behavior, and embeddings
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3 text-sm">
        {signals.map((signal) => (
          <PipelineSignalRow key={signal.label} signal={signal} />
        ))}
      </CardContent>
    </Card>
  );
};

const renderMetadataBadges = (metadata?: DebugStartupEvent["metadata"]) => {
  if (metadata === undefined) {
    return [];
  }
  const descriptors = [
    { key: "cache_size", label: "cache" },
    { key: "article_count", label: "migrated" },
    { key: "documents", label: "vectors" },
  ];

  return descriptors.map(({ label, key }) => {
    const value = formatMetadataValue(metadata[key]);
    if (value === undefined || value === "") {
      return null;
    }
    return (
      <span key={`${label}-${value}`} className="ml-1 text-muted-foreground">
        • {label}: {value}
      </span>
    );
  });
};

interface StartupMetricProps {
  readonly label: string;
  readonly value: string;
}

const StartupMetric = (props: Readonly<StartupMetricProps>) => (
  <div>
    <p className="text-muted-foreground">{props.label}</p>
    <p className="text-lg font-semibold">{props.value}</p>
  </div>
);

const StartupMetricsSummary = (
  props: DeepReadonly<Pick<StartupTimelineCardProps, "startupMetrics">>,
) => (
  <div className="grid gap-2 md:grid-cols-3">
    <StartupMetric
      label="Backend boot"
      value={formatDuration(props.startupMetrics?.durationSeconds)}
    />
    <StartupMetric label="Started" value={formatTimestamp(props.startupMetrics?.startedAt)} />
    <StartupMetric label="Completed" value={formatTimestamp(props.startupMetrics?.completedAt)} />
  </div>
);

const StartupTimelineHeader = () => (
  <TableHeader>
    <TableRow>
      <TableHead>Phase</TableHead>
      <TableHead>Duration</TableHead>
      <TableHead>Detail</TableHead>
      <TableHead>Completed</TableHead>
    </TableRow>
  </TableHeader>
);

const getStartupDetail = (detail: string | null | undefined, fallback: string): string => {
  if (detail === undefined || detail === null || detail === "") {
    return fallback;
  }
  return detail;
};

const StartupTimelineRow = (
  props: DeepReadonly<{ event: DebugStartupEvent; detailFallback: string }>,
) => {
  const event = props.event;
  return (
    <TableRow>
      <TableCell className="font-medium capitalize">
        {event.name.replaceAll("_", " ")}
      </TableCell>
      <TableCell>{formatDuration(event.durationSeconds)}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {getStartupDetail(event.detail, props.detailFallback)}
        {renderMetadataBadges(event.metadata)}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatTimestamp(event.completedAt)}
      </TableCell>
    </TableRow>
  );
};

const StartupTimelineRows = (
  props: DeepReadonly<{ events: readonly DebugStartupEvent[]; detailFallback: string }>,
) => (
  <>
    {props.events.map((event) => (
      <StartupTimelineRow
        key={`${event.name}-${event.startedAt}`}
        event={event}
        detailFallback={props.detailFallback}
      />
    ))}
  </>
);

const StartupTimelineTable = (
  props: DeepReadonly<{ events: readonly DebugStartupEvent[]; detailFallback: string }>,
) => (
  <Table>
    <StartupTimelineHeader />
    <TableBody>
      <StartupTimelineRows events={props.events} detailFallback={props.detailFallback} />
    </TableBody>
    {props.events.length === 0 && <TableCaption>No startup metrics recorded yet.</TableCaption>}
  </Table>
);

const StartupTimelineCard = (props: DeepReadonly<StartupTimelineCardProps>) => (
  <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">Startup Timeline</CardTitle>
      <CardDescription className="font-mono text-[10px] tracking-widest uppercase">
        Backend startup phase breakdown
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4 text-sm">
      <StartupMetricsSummary startupMetrics={props.startupMetrics} />
      <StartupTimelineTable events={props.startupEvents} detailFallback={props.detailFallback ?? "—"} />
    </CardContent>
  </Card>
);

const StatusLines = (props: Readonly<{ items: readonly StatusLine[]; muted?: boolean }>) => {
  let className = "space-y-2 text-sm";
  if (props.muted === true) {
    className = "space-y-2 text-sm text-muted-foreground";
  }
  return (
    <div className={className}>
      {props.items.map((item) => (
        <p key={item.label}>
          {item.label}: {item.value}
        </p>
      ))}
    </div>
  );
};

const getSystemComponentItems = (
  components: SystemStatusResponse["components"] = {},
): readonly StatusLine[] => {
  const {
    cache = {},
    database = {},
    vector_store: vectorStore = {},
    embedding_queue: embeddingQueue = {},
  } = components;
  return [
    {
      label: "Cache",
      value: `${healthLabel(cache.healthy, "Healthy", "Unhealthy")} (${cache.article_count ?? ""} articles)`,
    },
    { label: "Cache updated", value: formatTimestamp(cache.last_updated) },
    { label: "Cache age", value: formatDuration(cache.age_seconds) },
    { label: "Cache refresh", value: healthLabel(cache.update_in_progress, "Running", "Idle") },
    { label: "Cache updates", value: cache.update_count ?? "—" },
    {
      label: "Incremental cache",
      value: healthLabel(cache.incremental_enabled, "Enabled", "Disabled"),
    },
    { label: "Sources tracked", value: cache.sources_tracked ?? "—" },
    { label: "Database", value: healthLabel(database.healthy, "Healthy", "Unavailable") },
    { label: "Vector Store", value: healthLabel(vectorStore.healthy, "Healthy", "Unavailable") },
    { label: "Embedding queue", value: embeddingQueue.depth ?? "—" },
  ];
};

const getSystemRuntimeItems = (
  runtime: SystemStatusResponse["runtime"] = {},
): readonly StatusLine[] => [
  { label: "Python", value: runtime.python_version?.split(" ")[0] },
  { label: "Platform", value: runtime.platform },
  { label: "PID", value: runtime.pid },
];

const SystemStatusDetails = (
  props: Readonly<{ systemStatus: SystemStatusResponse | undefined }>,
) => {
  if (props.systemStatus === undefined) {
    return <p className="text-sm text-muted-foreground">Loading system status...</p>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <h3 className="font-medium mb-2">Components</h3>
        <StatusLines items={getSystemComponentItems(props.systemStatus.components)} />
      </div>
      <div>
        <h3 className="font-medium mb-2">Runtime</h3>
        <StatusLines items={getSystemRuntimeItems(props.systemStatus.runtime)} muted />
      </div>
    </div>
  );
};

const SystemStatusCard = (
  props: DeepReadonly<Pick<SystemStatusSectionProps, "systemStatus" | "onRefreshStatus">>,
) => {
  const handleRefreshStatus = props.onRefreshStatus;
  return (
    <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
      <CardHeader>
        <CardTitle className="font-serif">System Status</CardTitle>
        <CardDescription className="font-mono text-[10px] tracking-widest uppercase">
          Component health and runtime information
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SystemStatusDetails systemStatus={props.systemStatus} />
        <Button variant="outline" size="sm" onClick={handleRefreshStatus}>
          Refresh Status
        </Button>
      </CardContent>
    </Card>
  );
};

const SystemStatusSection = (props: DeepReadonly<SystemStatusSectionProps>) => (
  <TabsContent value="system" className="space-y-4">
    <SystemStatusCard
      systemStatus={props.systemStatus}
      onRefreshStatus={props.onRefreshStatus}
    />
    <PipelineSignalsCard systemStatus={props.systemStatus} />
    <StartupTimelineCard
      startupMetrics={props.startupMetrics}
      startupEvents={props.startupEvents}
      detailFallback="-"
    />
  </TabsContent>
);

export { StartupTimelineCard, SystemStatusSection };
