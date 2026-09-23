import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SafeImage } from "@/components/safe-image";
import { isUsableImage } from "@/lib/article-image";
import { inputValueChange } from "./debug-dashboard-utils";

interface ArticleCandidate {
  readonly priority?: number;
  readonly source?: string;
  readonly url?: string;
}

interface ArticleParserTestResult {
  readonly success?: boolean;
  readonly image_url?: string;
  readonly candidates?: readonly ArticleCandidate[];
  readonly error?: string;
  readonly error_details?: string;
}

interface ArticleParserCardProps {
  readonly articleTestLoading: boolean;
  readonly articleTestResult: ArticleParserTestResult | undefined;
  readonly articleTestUrl: string;
  readonly errorDetails: (code: string) => string;
  readonly errorLabel: (code: string) => string;
  readonly setArticleTestUrl: (value: string) => void;
  readonly testArticleParser: () => void;
}

const resultStatusClass = (success?: boolean): string => {
  if (success === true) {
    return "text-green-600";
  }
  return "text-red-600";
};

const resultStatusLabel = (success?: boolean): string => {
  if (success === true) {
    return "Found";
  }
  return "Not Found";
};

const ArticleParserStatus = (props: Readonly<Pick<ArticleParserTestResult, "success">>) => (
  <span className={resultStatusClass(props.success)}>{resultStatusLabel(props.success)}</span>
);

const ArticleImagePreview = (
  props: Readonly<Pick<ArticleParserTestResult, "image_url">>,
) => {
  if (!isUsableImage(props.image_url)) {
    return null;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm break-all">{props.image_url}</p>
      <SafeImage
        src={props.image_url}
        alt="Preview"
        width={320}
        height={180}
        className="max-w-xs rounded border"
      />
    </div>
  );
};

const ArticleCandidateList = (props: Readonly<{ candidates: readonly ArticleCandidate[] }>) => (
  <div>
    <h4 className="mb-1 text-sm font-medium">All Candidates</h4>
    <ul className="space-y-1 text-xs">
      {props.candidates.map((candidate) => (
        <li
          key={`${candidate.url ?? candidate.source ?? "candidate"}-${candidate.priority ?? "priority"}`}
          className="rounded bg-muted p-1"
        >
          [{candidate.priority}] {candidate.source}: {candidate.url?.slice(0, 60)}...
        </li>
      ))}
    </ul>
  </div>
);

const ArticleParserError = (
  props: Readonly<Pick<ArticleParserCardProps, "errorDetails" | "errorLabel"> & { result: ArticleParserTestResult }>,
) => {
  if (props.result.error === undefined || props.result.error === "") {
    return null;
  }
  return (
    <p className="text-sm text-red-600">
      {props.errorLabel(props.result.error)}: {props.errorDetails(props.result.error_details ?? props.result.error)}
    </p>
  );
};

const ArticleParserResult = (
  props: Readonly<Pick<ArticleParserCardProps, "errorDetails" | "errorLabel"> & { result: ArticleParserTestResult }>,
) => {
  const candidates = props.result.candidates;
  return (
    <div className="mt-4 space-y-2">
      <ArticleParserStatus success={props.result.success} />
      <ArticleImagePreview image_url={props.result.image_url} />
      {candidates !== undefined && candidates.length > 0 && (
        <ArticleCandidateList candidates={candidates} />
      )}
      <ArticleParserError
        errorDetails={props.errorDetails}
        errorLabel={props.errorLabel}
        result={props.result}
      />
    </div>
  );
};

const getParserButtonLabel = (loading: boolean): string => {
  if (loading) {
    return "Testing...";
  }
  return "Extract Image";
};

const ArticleParserForm = (
  props: Readonly<
    Pick<
      ArticleParserCardProps,
      "articleTestLoading" | "articleTestUrl" | "setArticleTestUrl" | "testArticleParser"
    >
  >,
) => {
  const handleTestArticleParser = props.testArticleParser;
  return (
    <div className="flex gap-2">
      <Input
        placeholder="Enter article URL..."
        value={props.articleTestUrl}
        onChange={inputValueChange(props.setArticleTestUrl)}
        className="flex-1"
      />
      <Button onClick={handleTestArticleParser} disabled={props.articleTestLoading}>
        {getParserButtonLabel(props.articleTestLoading)}
      </Button>
    </div>
  );
};

const ArticleParserCard = (props: Readonly<ArticleParserCardProps>) => (
  <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">Article Image Extractor</CardTitle>
      <CardDescription className="font-mono text-[10px] uppercase tracking-widest">
        Test og:image extraction from article pages
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <ArticleParserForm
        articleTestLoading={props.articleTestLoading}
        articleTestUrl={props.articleTestUrl}
        setArticleTestUrl={props.setArticleTestUrl}
        testArticleParser={props.testArticleParser}
      />
      {props.articleTestResult !== undefined && (
        <ArticleParserResult
          errorDetails={props.errorDetails}
          errorLabel={props.errorLabel}
          result={props.articleTestResult}
        />
      )}
    </CardContent>
  </Card>
);

export { ArticleParserCard };
export type { ArticleParserTestResult };
