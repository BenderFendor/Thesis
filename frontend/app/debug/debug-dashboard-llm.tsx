import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { formatMilliseconds, formatTimestamp, textOr } from "./debug-dashboard-utils";
import type { DebugLlmEntry, LlmCallCardProps, LlmSectionProps } from "./debug-dashboard-types";

const ZERO = 0;
const EMPTY_LLM_ENTRIES: readonly DebugLlmEntry[] = [];

const averageLlmLatency = (entries: readonly DebugLlmEntry[]): string => {
  if (entries.length === ZERO) {
    return "—";
  }
  const total = entries.reduce((sum, entry) => sum + (entry.duration_ms ?? ZERO), ZERO);
  return `${Math.round(total / entries.length)}ms`;
};

const llmLogDescription = (available: boolean | undefined, total: number, path: string): string => {
  if (available === true) {
    return `${total} calls logged in ${path}`;
  }
  return "LLM log file is not available in this session directory.";
};

const getLlmSummaryValueClass = (tone: "error" | "success" | undefined): string => {
  if (tone === "error") {
    return "text-2xl font-semibold text-red-600 dark:text-red-400";
  }
  if (tone === "success") {
    return "text-2xl font-semibold text-emerald-600 dark:text-emerald-400";
  }
  return "text-2xl font-semibold";
};

const LlmSummaryMetric = (
  props: Readonly<
    Pick<
      { label: string; value: string | number; tone?: "error" | "success" },
      "label" | "tone" | "value"
    >
  >,
) => {
  const valueClass = getLlmSummaryValueClass(props.tone);
  return (
    <div>
      <p className="text-sm text-muted-foreground">{props.label}</p>
      <p className={valueClass}>{props.value}</p>
    </div>
  );
};

const LlmSummaryCard = (props: DeepReadonly<Pick<LlmSectionProps, "llmLogs">>) => {
  const entries = props.llmLogs?.entries ?? EMPTY_LLM_ENTRIES;
  const successfulCalls = entries.filter((entry) => entry.success === true).length;
  const failedCalls = entries.filter((entry) => entry.success === false).length;
  const averageLatency = averageLlmLatency(entries);
  const description = llmLogDescription(
    props.llmLogs?.available,
    props.llmLogs?.total ?? ZERO,
    props.llmLogs?.path ?? "",
  );
  return (
    <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
      <CardHeader>
        <CardTitle className="font-serif">Call Summary</CardTitle>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {description}
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-4">
        <LlmSummaryMetric label="Returned" value={props.llmLogs?.returned ?? ZERO} />
        <LlmSummaryMetric label="Successes" tone="success" value={successfulCalls} />
        <LlmSummaryMetric label="Failures" tone="error" value={failedCalls} />
        <LlmSummaryMetric label="Avg latency" value={averageLatency} />
      </CardContent>
    </Card>
  );
};

const getLlmCallStatusClass = (success: boolean | undefined): string => {
  if (success === true) {
    return "text-emerald-600 dark:text-emerald-400";
  }
  return "text-red-600 dark:text-red-400";
};

const getLlmCallStatusLabel = (success: boolean | undefined): string => {
  if (success === true) {
    return "success";
  }
  return "failed";
};

const LlmCallMeta = (props: DeepReadonly<LlmCallCardProps>) => (
  <div className="flex items-center gap-3 text-xs">
    <span className={getLlmCallStatusClass(props.entry.success)}>
      {getLlmCallStatusLabel(props.entry.success)}
    </span>
    <span>{formatMilliseconds(props.entry.duration_ms)}</span>
    <span>{props.entry.messages?.length ?? ZERO} messages</span>
  </div>
);

const LlmCallErrorDetails = (props: DeepReadonly<LlmCallCardProps>) => {
  const finishReason = textOr(props.entry.finish_reason, "");
  const errorType = textOr(props.entry.error_type, "");
  const errorMessage = textOr(props.entry.error_message, "");
  if (finishReason === "" && errorType === "" && errorMessage === "") {
    return null;
  }
  return (
    <div className="mt-2 text-xs text-muted-foreground">
      {finishReason !== "" && <span>Finish: {finishReason}</span>}
      {errorType !== "" && <span className="ml-3">Type: {errorType}</span>}
      {errorMessage !== "" && <span className="ml-3">{errorMessage}</span>}
    </div>
  );
};

const LlmCallHeading = (props: DeepReadonly<LlmCallCardProps>) => (
  <div>
    <p className="font-medium">
      {textOr(props.entry.service, "unknown service")} ·{" "}
      {textOr(props.entry.model, "unknown model")}
    </p>
    <p className="text-xs text-muted-foreground">
      {formatTimestamp(props.entry.timestamp)} · request {textOr(props.entry.request_id, "n/a")}
    </p>
  </div>
);

const llmCallKey = (entry: DebugLlmEntry): string =>
  `${entry.request_id ?? "request"}-${entry.timestamp ?? "timestamp"}-${entry.service ?? "service"}-${entry.model ?? "model"}`;

const LlmCallCard = (props: DeepReadonly<LlmCallCardProps>) => (
  <div className="rounded-lg border p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <LlmCallHeading entry={props.entry} />
      <LlmCallMeta entry={props.entry} />
    </div>
    <LlmCallErrorDetails entry={props.entry} />
  </div>
);

const LlmRecentCalls = (props: DeepReadonly<{ entries: readonly DebugLlmEntry[] }>) => {
  if (props.entries.length === ZERO) {
    return <p className="text-sm text-muted-foreground">No LLM calls logged yet.</p>;
  }
  return (
    <div className="max-h-[36rem] space-y-3 overflow-y-auto">
      {props.entries.map((entry) => (
        <LlmCallCard key={llmCallKey(entry)} entry={entry} />
      ))}
    </div>
  );
};

const LlmRecentCallsPanel = (props: DeepReadonly<{ entries: readonly DebugLlmEntry[] }>) => (
  <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">Recent Calls</CardTitle>
    </CardHeader>
    <CardContent>
      <LlmRecentCalls entries={props.entries} />
    </CardContent>
  </Card>
);

const LlmSection = (props: DeepReadonly<LlmSectionProps>) => {
  const handleRefresh = props.onRefresh;
  const entries = props.llmLogs?.entries ?? EMPTY_LLM_ENTRIES;
  return (
    <TabsContent value="llm" className="space-y-4">
      <LlmHeader onRefresh={handleRefresh} />
      <LlmSummaryCard llmLogs={props.llmLogs} />
      <LlmRecentCallsPanel entries={entries} />
    </TabsContent>
  );
};

const LlmHeader = ({ onRefresh }: Readonly<Pick<LlmSectionProps, "onRefresh">>) => (
  <div className="flex items-center justify-between gap-3">
    <div>
      <h2 className="text-lg font-medium font-serif">LLM Calls</h2>
      <p className="text-sm text-muted-foreground">
        Parsed model calls with latency and outcome details.
      </p>
    </div>
    <Button variant="outline" onClick={onRefresh}>
      Refresh LLM logs
    </Button>
  </div>
);

export { LlmSection };
