import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { inputValueChange, textOr } from "./debug-dashboard-utils";
import type {
  ImageErrorCode,
  ParserSectionProps,
  RssParserTestResult,
  RssSampleEntry,
} from "./debug-dashboard-types";
import { ArticleParserCard } from "./article-parser-card";

const IMAGE_ERROR_DETAILS = {
  ARTICLE_FETCH_FAILED: "Failed to download the article HTML.",
  FRONTEND_RENDER_FAILED: "Browser could not render the image asset.",
  IMAGE_FETCH_FAILED: "Remote server rejected the image request.",
  IMAGE_FETCH_TIMEOUT: "Fetching the image timed out.",
  IMAGE_UNSUPPORTED_TYPE: "Image type is not supported by the extractor.",
  IMAGE_URL_INVALID: "The article URL is malformed or missing.",
  MIXED_CONTENT_BLOCKED: "HTTPS page blocked an HTTP image URL.",
  NO_IMAGE_IN_FEED: "No image candidates found in the RSS entry.",
  OG_IMAGE_NOT_FOUND: "No og:image or twitter:image metadata found.",
} satisfies Record<ImageErrorCode, string>;

const IMAGE_ERROR_LABELS = {
  ARTICLE_FETCH_FAILED: "Article fetch failed",
  FRONTEND_RENDER_FAILED: "Frontend render failed",
  IMAGE_FETCH_FAILED: "Image fetch failed",
  IMAGE_FETCH_TIMEOUT: "Image fetch timeout",
  IMAGE_UNSUPPORTED_TYPE: "Unsupported image type",
  IMAGE_URL_INVALID: "Invalid image URL",
  MIXED_CONTENT_BLOCKED: "Mixed content blocked",
  NO_IMAGE_IN_FEED: "No image in RSS",
  OG_IMAGE_NOT_FOUND: "No og:image found",
} satisfies Record<ImageErrorCode, string>;

const isImageErrorCode = (value: string): value is ImageErrorCode =>
  Object.hasOwn(IMAGE_ERROR_DETAILS, value);

const getImageErrorDetails = (value: string | null | undefined): string => {
  const code = textOr(value, "");
  if (code === "" || !isImageErrorCode(code)) {
    return "";
  }
  return IMAGE_ERROR_DETAILS[code];
};

const getImageErrorLabel = (value: string | null | undefined): string => {
  const code = textOr(value, "");
  if (code === "") {
    return "None";
  }
  if (!isImageErrorCode(code)) {
    return code;
  }
  return IMAGE_ERROR_LABELS[code];
};

const ImageErrorItem = (props: Readonly<{ code: string; label: string }>) => (
  <li className="rounded border border-white/10 bg-[var(--news-bg-secondary)] px-3 py-2">
    <div className="font-mono text-xs text-muted-foreground">{props.code}</div>
    <div className="font-medium">{props.label}</div>
    <div className="text-xs text-muted-foreground">{getImageErrorDetails(props.code)}</div>
  </li>
);

const ImageErrorTaxonomyCard = () => (
  <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">Image Error Taxonomy</CardTitle>
      <CardDescription className="font-mono text-[10px] uppercase tracking-widest">
        Standardized error labels used by image extraction
      </CardDescription>
    </CardHeader>
    <CardContent>
      <ImageErrorList />
    </CardContent>
  </Card>
);

const ImageErrorList = () => (
  <ul className="grid gap-2 text-sm md:grid-cols-2">
    {Object.entries(IMAGE_ERROR_LABELS).map(([code, label]) => (
      <ImageErrorItem key={code} code={code} label={label} />
    ))}
  </ul>
);

const parserStatusClass = (success: boolean | undefined): string => {
  if (success === true) {
    return "text-green-600";
  }
  return "text-red-600";
};

const parserStatusLabel = (success: boolean | undefined): string => {
  if (success === true) {
    return "Success";
  }
  return "Failed";
};

const RssParserStatus = (props: Readonly<{ result: RssParserTestResult }>) => {
  const parseTime = props.result.parse_time_seconds;
  return (
    <div className="flex items-center gap-2">
      <span className={parserStatusClass(props.result.success)}>
        {parserStatusLabel(props.result.success)}
      </span>
      {parseTime !== undefined && (
        <span className="text-sm text-muted-foreground">({parseTime}s)</span>
      )}
    </div>
  );
};

const RssFeedInfo = (props: Readonly<{ result: RssParserTestResult }>) => {
  const feedInfo = props.result.feed_info;
  if (feedInfo === undefined) {
    return null;
  }
  return (
    <div className="text-sm">
      <p>
        <strong>Title:</strong> {feedInfo.title}
      </p>
      <p>
        <strong>Entries:</strong> {props.result.status?.entries_count}
      </p>
    </div>
  );
};

const RssSampleSource = (props: Readonly<{ entry: RssSampleEntry }>) => {
  const source = textOr(props.entry.image_extraction?.selected_source, "");
  if (source === "") {
    return null;
  }
  return <p className="text-muted-foreground">Source: {source}</p>;
};

const imageErrorDetail = (entry: RssSampleEntry): string => {
  const code = textOr(entry.image_extraction?.image_error, "");
  const details = getImageErrorDetails(code);
  if (details !== "") {
    return details;
  }
  return textOr(entry.image_extraction?.image_error_details, "");
};

const RssSampleError = (props: Readonly<{ entry: RssSampleEntry }>) => {
  const code = textOr(props.entry.image_extraction?.image_error, "");
  if (code === "") {
    return null;
  }
  return <p className="text-muted-foreground">Error detail: {imageErrorDetail(props.entry)}</p>;
};

const RssSampleImage = (props: Readonly<{ entry: RssSampleEntry }>) => (
  <p className="text-muted-foreground">
    Image:{" "}
    {textOr(
      props.entry.image_extraction?.image_url,
      getImageErrorLabel(props.entry.image_extraction?.image_error),
    )}
  </p>
);

const RssSampleEntryCard = (props: Readonly<{ entry: RssSampleEntry }>) => (
  <div className="rounded bg-muted p-2 text-xs">
    <p className="font-medium">{props.entry.title}</p>
    <RssSampleImage entry={props.entry} />
    <RssSampleSource entry={props.entry} />
    <RssSampleError entry={props.entry} />
  </div>
);

const RssSampleEntries = (props: Readonly<{ result: RssParserTestResult }>) => {
  const entries = props.result.sample_entries ?? [];
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className="mt-2">
      <h4 className="mb-2 text-sm font-medium">Sample Entries</h4>
      <div className="space-y-2">
        {entries.map((entry) => (
          <RssSampleEntryCard
            key={entry.title ?? entry.image_extraction?.image_url ?? "sample-entry"}
            entry={entry}
          />
        ))}
      </div>
    </div>
  );
};

const RssParserError = (props: Readonly<{ result: RssParserTestResult }>) => {
  const error = textOr(props.result.error, "");
  if (error === "") {
    return null;
  }
  return <p className="text-sm text-red-600">{error}</p>;
};

const RssParserResult = (props: Readonly<{ result: RssParserTestResult | undefined }>) => {
  if (props.result === undefined) {
    return null;
  }
  return (
    <div className="mt-4 space-y-2">
      <RssParserStatus result={props.result} />
      <RssFeedInfo result={props.result} />
      <RssSampleEntries result={props.result} />
      <RssParserError result={props.result} />
    </div>
  );
};

const RssParserCard = (
  props: Readonly<
    Pick<
      ParserSectionProps,
      "rssTestUrl" | "setRssTestUrl" | "rssTestResult" | "rssTestLoading" | "testRssParser"
    >
  >,
) => {
  const handleTestRssParser = props.testRssParser;
  return (
    <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
      <CardHeader>
        <CardTitle className="font-serif">RSS Feed Parser</CardTitle>
        <CardDescription className="font-mono text-[10px] uppercase tracking-widest">
          Test RSS parsing on any feed URL
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RssParserForm
          rssTestUrl={props.rssTestUrl}
          setRssTestUrl={props.setRssTestUrl}
          rssTestLoading={props.rssTestLoading}
          onTest={handleTestRssParser}
        />
        <RssParserResult result={props.rssTestResult} />
      </CardContent>
    </Card>
  );
};

const parserButtonLabel = (loading: boolean): string => {
  if (loading) {
    return "Testing...";
  }
  return "Test Feed";
};

const RssParserForm = (
  props: Readonly<Pick<ParserSectionProps, "rssTestUrl" | "setRssTestUrl" | "rssTestLoading">> &
    Readonly<{ onTest: () => void }>,
) => (
  <div className="flex gap-2">
    <Input
      placeholder="Enter RSS feed URL..."
      value={props.rssTestUrl}
      onChange={inputValueChange(props.setRssTestUrl)}
      className="flex-1"
    />
    <Button onClick={props.onTest} disabled={props.rssTestLoading}>
      {parserButtonLabel(props.rssTestLoading)}
    </Button>
  </div>
);

const ParserSection = (props: DeepReadonly<ParserSectionProps>) => (
  <TabsContent value="parser" className="space-y-4">
    <RssParserCard
      rssTestUrl={props.rssTestUrl}
      setRssTestUrl={props.setRssTestUrl}
      rssTestResult={props.rssTestResult}
      rssTestLoading={props.rssTestLoading}
      testRssParser={props.testRssParser}
    />
    <ArticleParserCard
      articleTestUrl={props.articleTestUrl}
      setArticleTestUrl={props.setArticleTestUrl}
      articleTestResult={props.articleTestResult}
      articleTestLoading={props.articleTestLoading}
      testArticleParser={props.testArticleParser}
      errorLabel={getImageErrorLabel}
      errorDetails={getImageErrorDetails}
    />
    <ImageErrorTaxonomyCard />
  </TabsContent>
);

export { ParserSection };
