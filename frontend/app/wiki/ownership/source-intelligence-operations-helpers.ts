import { API_BASE_URL, triggerWikiIndex } from "@/lib/api";
import type { DebugErrorsResponse, LlmLogEntry, SourceStats } from "@/lib/api";
import { parseDebugResponse } from "@/app/debug/debug-dashboard-queries";
import { hasText } from "@/lib/utils";
import { DEBUG_SCHEMAS } from "@/app/debug/debug-dashboard-schemas";
import type {
  NormalizedErrorEvent,
  ParserResult,
  ParserTestRequest,
  SourceIndexRequest,
} from "./source-intelligence-operations-types";

const EMPTY_LLM_ENTRIES: readonly LlmLogEntry[] = [];
const PANEL_CLASS =
  "rounded-[1.6rem] border border-white/[0.08] bg-background/70 p-4 backdrop-blur-xl";
const SURFACE_CLASS = "rounded-[1.2rem] border border-white/[0.08] bg-black/20 p-4";

const averageSourceArticles = (sources: readonly SourceStats[]): number => {
  if (sources.length === 0) {
    return 0;
  }
  return Math.round(
    sources.reduce((total, source) => total + source.article_count, 0) / sources.length,
  );
};

const buildRecentErrorEvents = (data: DebugErrorsResponse | undefined): NormalizedErrorEvent[] => [
  ...(data?.log_file.entries ?? []).map<NormalizedErrorEvent>((entry, index) => ({
    errorType: entry.error_type ?? "error",
    key: `${entry.request_id ?? "log"}-${index}`,
    message: entry.error_message ?? "No error message recorded.",
    service: entry.service ?? "unknown service",
  })),
  ...(data?.recent_request_stream_errors ?? []).map<NormalizedErrorEvent>((entry, index) => ({
    errorType: entry.error_type ?? entry.event_type ?? "error",
    key: `${entry.request_id ?? "stream"}-${index}`,
    message: entry.error_message ?? entry.message ?? "No error message recorded.",
    service: entry.service ?? entry.component ?? "unknown service",
  })),
];

const countSuccessfulLogs = (entries: readonly LlmLogEntry[], success: boolean): number =>
  entries.filter((entry) => entry.success === success).length;

const displaySourceValue = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  return String(value);
};

const formatCheckedTime = (value: string | null | undefined): string => {
  if (!hasText(value)) {
    return "—";
  }
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatAverageLatency = (values: readonly (number | undefined)[] | undefined): string => {
  const numericValues = (values ?? []).filter(
    (value): value is number => typeof value === "number",
  );
  if (numericValues.length === 0) {
    return "—";
  }
  return `${Math.round(numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length)}ms`;
};

const parseRssParserResponse = async (response: Response): Promise<ParserResult | undefined> =>
  parseDebugResponse(response, DEBUG_SCHEMAS.rssParserTestResult);

const parseArticleParserResponse = async (response: Response): Promise<ParserResult | undefined> =>
  parseDebugResponse(response, DEBUG_SCHEMAS.articleParserTestResult);

const startParserTest = (
  setTesting: (value: boolean) => void,
  setResult: (value: ParserResult | null) => void,
): void => {
  setTesting(true);
  setResult(null);
};

const indexSource = async ({
  sourceName,
  setIndexing,
  onSourceProfileRefresh,
  onRefreshAll,
}: SourceIndexRequest): Promise<void> => {
  if (!hasText(sourceName)) {
    return;
  }
  setIndexing(true);
  try {
    await triggerWikiIndex(sourceName);
    await onSourceProfileRefresh();
    onRefreshAll();
  } finally {
    setIndexing(false);
  }
};

const runParserTest = async ({
  url,
  endpoint,
  failureMessage,
  parseResponse,
  setTesting,
  setResult,
}: ParserTestRequest): Promise<void> => {
  if (!url.trim()) {
    return;
  }
  startParserTest(setTesting, setResult);
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}?url=${encodeURIComponent(url)}`, {
      method: "POST",
    });
    await setParserResponse(response, parseResponse, setResult);
  } catch (error) {
    if (error instanceof Error) {
      setResult({ error: error.message });
    } else {
      setResult({ error: failureMessage });
    }
  } finally {
    setTesting(false);
  }
};

const setParserResponse = async (
  response: Response,
  parseResponse: (response: Response) => Promise<ParserResult | undefined>,
  setResult: (value: ParserResult | null) => void,
): Promise<void> => {
  const parserResult = await parseResponse(response);
  if (parserResult === undefined) {
    setResult({ error: "Invalid parser response" });
    return;
  }
  setResult(parserResult);
};

export {
  EMPTY_LLM_ENTRIES,
  PANEL_CLASS,
  SURFACE_CLASS,
  averageSourceArticles,
  buildRecentErrorEvents,
  countSuccessfulLogs,
  displaySourceValue,
  formatAverageLatency,
  formatCheckedTime,
  indexSource,
  parseArticleParserResponse,
  parseRssParserResponse,
  runParserTest,
};
