import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { formatTimestamp, textOr } from "./debug-dashboard-utils";
import type { DebugError, DebugErrorsPanelData, ErrorsSectionProps } from "./debug-dashboard-types";

const ZERO = 0;
const EMPTY_DEBUG_ERRORS: DebugErrorsPanelData = {
  log_file: { available: false, entries: [], total: 0 },
  recent_request_stream_errors: [],
  returned_recent_errors: 0,
};

const getDebugErrorKey = (prefix: string, entry: DebugError): string =>
  `${prefix}-${entry.request_id ?? entry.timestamp ?? entry.error_message ?? entry.message ?? entry.service ?? entry.component ?? "error"}`;

interface DebugErrorSummary {
  readonly description: string;
  readonly logged: number;
  readonly recent: number;
  readonly showing: number;
}

const createDebugErrorSummary = (
  debugErrors: DebugErrorsPanelData = EMPTY_DEBUG_ERRORS,
): DebugErrorSummary => {
  const {
    log_file: logFile,
    recent_request_stream_errors: recentErrors,
    returned_recent_errors: recent,
  } = debugErrors;
  return {
    description: describeErrorLog(logFile.available, logFile.total),
    logged: logFile.total,
    recent,
    showing: logFile.entries.length + recentErrors.length,
  };
};

const describeErrorLog = (available: boolean, total: number): string => {
  if (available) {
    return `${total} API errors logged`;
  }
  return "Session error log file not available.";
};

const errorSummaryValueClass = (danger: boolean | undefined): string => {
  if (danger === true) {
    return "text-2xl font-semibold text-red-600 dark:text-red-400";
  }
  return "text-2xl font-semibold";
};

const ErrorSummaryMetric = (
  props: Readonly<{ label: string; value: number; danger?: boolean }>,
) => (
  <div>
    <p className="text-sm text-muted-foreground">{props.label}</p>
    <p className={errorSummaryValueClass(props.danger)}>{props.value}</p>
  </div>
);

const ErrorSummaryCard = ({
  debugErrors,
}: DeepReadonly<Pick<ErrorsSectionProps, "debugErrors">>) => {
  const summary = createDebugErrorSummary(debugErrors);
  return (
    <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
      <CardHeader>
        <CardTitle className="font-serif">Error Summary</CardTitle>
        <CardDescription className="font-mono text-[10px] tracking-widest uppercase">
          {summary.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        <ErrorSummaryMetric label="Logged API errors" value={summary.logged} />
        <ErrorSummaryMetric danger label="Recent request/stream errors" value={summary.recent} />
        <ErrorSummaryMetric label="Showing" value={summary.showing} />
      </CardContent>
    </Card>
  );
};

const DebugLogErrorHeading = ({ entry }: DeepReadonly<{ entry: DebugError }>) => (
  <div>
    <p className="font-medium">
      {textOr(entry.service, "unknown service")} · {textOr(entry.model, "unknown model")}
    </p>
    <p className="text-xs text-muted-foreground">
      {formatTimestamp(entry.timestamp)} · request {textOr(entry.request_id, "n/a")}
    </p>
  </div>
);

const RequestStreamErrorHeading = ({ entry }: DeepReadonly<{ entry: DebugError }>) => (
  <div>
    <p className="font-medium">{textOr(entry.event_type ?? entry.component, "request error")}</p>
    <p className="text-xs text-muted-foreground">
      {formatTimestamp(entry.timestamp)} · request {textOr(entry.request_id, "n/a")}
    </p>
  </div>
);

const DebugLogErrorCard = ({ entry }: DeepReadonly<{ entry: DebugError }>) => (
  <div key={getDebugErrorKey("log", entry)} className="rounded-lg border p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <DebugLogErrorHeading entry={entry} />
      <span className="text-red-600 dark:text-red-400">{textOr(entry.error_type, "error")}</span>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">
      {textOr(entry.error_message, "No error message recorded.")}
    </p>
  </div>
);

const RequestStreamErrorCard = ({ entry }: DeepReadonly<{ entry: DebugError }>) => (
  <div key={getDebugErrorKey("event", entry)} className="rounded-lg border p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <RequestStreamErrorHeading entry={entry} />
      <span className="text-red-600 dark:text-red-400">{textOr(entry.operation, "request")}</span>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">
      {textOr(entry.message ?? entry.error_message, "No error message recorded.")}
    </p>
  </div>
);

const RecentFailureItems = (props: DeepReadonly<Pick<ErrorsSectionProps, "debugErrors">>) => {
  const debugErrors = props.debugErrors;
  if (
    debugErrors === undefined ||
    (debugErrors.log_file.entries.length === ZERO &&
      debugErrors.recent_request_stream_errors.length === ZERO)
  ) {
    return <p className="text-sm text-muted-foreground">No recent errors logged.</p>;
  }
  return (
    <>
      {debugErrors.log_file.entries.map((entry) => (
        <DebugLogErrorCard key={getDebugErrorKey("log", entry)} entry={entry} />
      ))}
      {debugErrors.recent_request_stream_errors.map((entry) => (
        <RequestStreamErrorCard key={getDebugErrorKey("event", entry)} entry={entry} />
      ))}
    </>
  );
};

const ErrorsSection = ({ debugErrors, onRefresh }: DeepReadonly<ErrorsSectionProps>) => {
  const handleRefresh = onRefresh;
  return (
    <TabsContent value="errors" className="space-y-4">
      <ErrorsHeader onRefresh={handleRefresh} />
      <ErrorSummaryCard debugErrors={debugErrors} />
      <RecentFailuresPanel debugErrors={debugErrors} />
    </TabsContent>
  );
};

const ErrorsHeader = ({ onRefresh }: Readonly<Pick<ErrorsSectionProps, "onRefresh">>) => (
  <div className="flex items-center justify-between gap-3">
    <div>
      <h2 className="text-lg font-medium font-serif">Errors</h2>
      <p className="text-sm text-muted-foreground">
        Combined API error log plus recent request and stream failures.
      </p>
    </div>
    <Button variant="outline" onClick={onRefresh}>
      Refresh errors
    </Button>
  </div>
);

const RecentFailuresPanel = (props: DeepReadonly<Pick<ErrorsSectionProps, "debugErrors">>) => (
  <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">Recent Failures</CardTitle>
    </CardHeader>
    <CardContent className="space-y-3">
      <RecentFailureItems debugErrors={props.debugErrors} />
    </CardContent>
  </Card>
);

export { ErrorsSection };
