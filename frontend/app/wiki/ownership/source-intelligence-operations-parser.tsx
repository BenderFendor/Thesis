import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hasText } from "@/lib/utils";
import { DataRow, SURFACE_CLASS } from "./source-intelligence-operations-common";
import type { ParserResult } from "./source-intelligence-operations-types";

const ParserTab = ({
  rssUrl,
  articleUrl,
  onRssUrlChange,
  onArticleUrlChange,
  rssResult,
  articleResult,
  testingFeed,
  testingArticle,
  onTestFeed,
  onTestArticle,
}: Readonly<{
  rssUrl: string;
  articleUrl: string;
  onRssUrlChange: (value: string) => void;
  onArticleUrlChange: (value: string) => void;
  rssResult: ParserResult | null;
  articleResult: ParserResult | null;
  testingFeed: boolean;
  testingArticle: boolean;
  onTestFeed: () => void;
  onTestArticle: () => void;
}>) => (
  <div className="grid gap-4 md:grid-cols-2">
    <ParserTestCard
      title="Feed Parser"
      placeholder="Paste an RSS feed URL"
      value={rssUrl}
      onValueChange={onRssUrlChange}
      onTest={onTestFeed}
      testing={testingFeed}
      result={rssResult}
      rows={feedResultRows(rssResult)}
    />
    <ParserTestCard
      title="Article Image Check"
      placeholder="Paste an article URL"
      value={articleUrl}
      onValueChange={onArticleUrlChange}
      onTest={onTestArticle}
      testing={testingArticle}
      result={articleResult}
      rows={articleResultRows(articleResult)}
    />
  </div>
);

const ParserTestCard = ({
  title,
  placeholder,
  value,
  onValueChange,
  onTest,
  testing,
  result,
  rows,
}: Readonly<{
  title: string;
  placeholder: string;
  value: string;
  onValueChange: (value: string) => void;
  onTest: () => void;
  testing: boolean;
  result: ParserResult | null;
  rows: readonly { readonly label: string; readonly value: string }[];
}>) => (
  <div className={SURFACE_CLASS}>
    <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      {title}
    </div>
    <ParserTestInput
      value={value}
      placeholder={placeholder}
      onValueChange={onValueChange}
      onTest={onTest}
      testing={testing}
    />
    {result !== null && <ParserResultSummary result={result} rows={rows} />}
  </div>
);

const ParserTestInput = ({
  value,
  placeholder,
  onValueChange,
  onTest,
  testing,
}: Readonly<{
  value: string;
  placeholder: string;
  onValueChange: (value: string) => void;
  onTest: () => void;
  testing: boolean;
}>) => {
  const handleValueChange = useCallback(
    (event: { readonly target: { readonly value: string } }) => {
      onValueChange(event.target.value);
    },
    [onValueChange],
  );

  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={handleValueChange}
        placeholder={placeholder}
        className="border-white/10 bg-black/30 text-foreground"
      />
      <Button onClick={onTest} disabled={testing}>
        {testButtonLabel(testing)}
      </Button>
    </div>
  );
};

const ParserResultSummary = ({
  result,
  rows,
}: Readonly<{
  result: ParserResult;
  rows: readonly { readonly label: string; readonly value: string }[];
}>) => (
  <div className="mt-4 space-y-2 text-sm text-muted-foreground">
    <ParserResultRows rows={rows} />
    {hasText(result.error) && <div className="text-red-300">{result.error}</div>}
  </div>
);

const ParserResultRows = ({
  rows,
}: Readonly<{ rows: readonly { readonly label: string; readonly value: string }[] }>) => (
  <div className="space-y-2">
    {rows.map((row) => (
      <DataRow key={row.label} label={row.label} value={row.value} />
    ))}
  </div>
);

const testButtonLabel = (testing: boolean): string => {
  if (testing) {
    return "Testing...";
  }
  return "Run";
};

const feedResultRows = (
  result: ParserResult | null,
): { readonly label: string; readonly value: string }[] => {
  if (!result) {
    return [];
  }
  return [
    { label: "Result", value: feedResultLabel(result) },
    { label: "Entries", value: String(result.status?.entries_count ?? "—") },
    { label: "Parse time", value: parseTimeLabel(result) },
  ];
};

const feedResultLabel = (result: ParserResult): string => {
  if (result.success === true) {
    return "Feed parsed";
  }
  return "Feed failed";
};

const parseTimeLabel = (result: ParserResult): string => {
  if (
    result.parse_time_seconds !== undefined &&
    result.parse_time_seconds !== null &&
    result.parse_time_seconds !== 0
  ) {
    return `${result.parse_time_seconds}s`;
  }
  return "—";
};

const articleResultRows = (
  result: ParserResult | null,
): { readonly label: string; readonly value: string }[] => {
  if (!result) {
    return [];
  }
  return [
    { label: "Result", value: articleResultLabel(result) },
    { label: "Image URL", value: result.image_url ?? "—" },
  ];
};

const articleResultLabel = (result: ParserResult): string => {
  if (result.success === true) {
    return "Image found";
  }
  return "No image found";
};

export { ParserTab };
