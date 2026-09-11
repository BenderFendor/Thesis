"use client";

import { AlertTriangle, Bug, DollarSign, Sparkles } from "lucide-react";
import type { ArticleAnalysis, NewsSource, SourceDebugData } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReactElement } from "react";

const ZERO = 0;

interface QueueAnalysisView {
  readonly success: ArticleAnalysis["success"];
  readonly summary?: ArticleAnalysis["summary"];
  readonly bias_analysis?: ArticleAnalysis["bias_analysis"];
}

interface QueueSourceView {
  readonly category: NewsSource["category"];
  readonly funding: NewsSource["funding"];
  readonly url: NewsSource["url"];
}

interface QueueSourceDebugView {
  readonly parsed_entries: SourceDebugData["parsed_entries"];
}

const KeyboardShortcutRow = ({
  keyLabel,
  text,
}: Readonly<{ keyLabel: string; text: string }>): ReactElement => (
  <div>
    <kbd className="px-2 py-1 bg-gray-700 rounded text-xs mr-2">{keyLabel}</kbd>
    {text}
  </div>
);

const KeyboardShortcutList = (): ReactElement => (
  <div className="space-y-1 text-muted-foreground">
    <KeyboardShortcutRow keyLabel="→" text="Next article" />
    <KeyboardShortcutRow keyLabel="←" text="Previous article" />
    <KeyboardShortcutRow keyLabel="M" text="Mark as read" />
    <KeyboardShortcutRow keyLabel="Esc" text="Close article" />
  </div>
);

const KeyboardShortcutsCard = (): ReactElement => (
  <div className="border border-border rounded-lg p-4 text-xs">
    <h3 className="font-semibold text-sm text-white mb-2">Keyboard Shortcuts</h3>
    <KeyboardShortcutList />
  </div>
);

const AiSummaryLoading = (): ReactElement => (
  <div className="flex items-center justify-center rounded-lg border border-border p-4 bg-card">
    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
  </div>
);

const AiSummaryHeader = (): ReactElement => (
  <div className="flex items-center gap-2 mb-3">
    <Sparkles className="h-4 w-4 text-primary" />
    <h3 className="font-semibold text-sm text-white">AI Summary</h3>
  </div>
);

const AiSummaryCard = ({
  aiAnalysis,
  aiAnalysisLoading,
}: Readonly<{ readonly aiAnalysis?: QueueAnalysisView; readonly aiAnalysisLoading: boolean }>):
  | ReactElement
  | undefined => {
  if (aiAnalysisLoading) {
    return <AiSummaryLoading />;
  }
  if (
    aiAnalysis === undefined ||
    !aiAnalysis.success ||
    aiAnalysis.summary === undefined ||
    aiAnalysis.summary === ""
  ) {
    return void 0;
  }
  return (
    <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-4">
      <AiSummaryHeader />
      <p className="text-foreground text-sm leading-relaxed">{aiAnalysis.summary}</p>
    </div>
  );
};

type BiasAnalysis = NonNullable<ArticleAnalysis["bias_analysis"]>;

const BiasCardHeader = (): ReactElement => (
  <h3 className="flex items-center gap-2 font-semibold text-sm text-white mb-2">
    <AlertTriangle className="h-4 w-4 text-yellow-400" />
    Bias Analysis
  </h3>
);

const BiasScoreBadge = ({ score }: Readonly<{ score: string }>): ReactElement | undefined => {
  if (score === "") {
    return void 0;
  }
  return (
    <Badge className="mb-2 bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
      Score: {score}/10
    </Badge>
  );
};

const BiasDetailRow = ({
  label,
  value,
}: Readonly<{ label: string; value: string }>): ReactElement | undefined => {
  if (value === "") {
    return void 0;
  }
  return (
    <div>
      <span className="text-muted-foreground">{label}:</span>
      <p className="text-foreground">{value}</p>
    </div>
  );
};

const BiasDetails = ({ analysis }: Readonly<{ analysis: BiasAnalysis }>): ReactElement => (
  <div className="space-y-2 text-xs">
    <BiasDetailRow label="Tone" value={analysis.tone_bias} />
    <BiasDetailRow label="Framing" value={analysis.framing_bias} />
  </div>
);

const BiasAnalysisCard = ({
  aiAnalysis,
}: Readonly<{ readonly aiAnalysis?: QueueAnalysisView }>): ReactElement | undefined => {
  if (aiAnalysis === undefined || !aiAnalysis.success || aiAnalysis.bias_analysis === undefined) {
    return void 0;
  }
  const analysis = aiAnalysis.bias_analysis;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <BiasCardHeader />
      <BiasScoreBadge score={analysis.overall_bias_score} />
      <BiasDetails analysis={analysis} />
    </div>
  );
};

const SourceDebugPanel = ({
  debugData,
  debugLoading,
}: Readonly<{
  readonly debugLoading: boolean;
  readonly debugData?: QueueSourceDebugView;
}>): ReactElement => {
  if (debugLoading) {
    return (
      <div className="flex items-center justify-center">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
      </div>
    );
  }
  if (debugData !== undefined) {
    return (
      <div className="text-foreground">Feed has {debugData.parsed_entries.length} entries</div>
    );
  }
  return <div className="text-muted-foreground">No debug data</div>;
};

interface SourceCardProps {
  readonly sourceLoading: boolean;
  readonly source?: QueueSourceView;
  readonly showSourceDetails: boolean;
  readonly onToggleDetails: () => void;
  readonly debugOpen: boolean;
  readonly onToggleDebug: () => void;
  readonly debugLoading: boolean;
  readonly debugData?: QueueSourceDebugView;
}

const SourceCardHeader = (): ReactElement => (
  <h3 className="flex items-center gap-2 font-semibold text-sm text-white mb-3">
    <AlertTriangle className="h-4 w-4 text-yellow-400" />
    Source
  </h3>
);

const SourceLoadingState = (): ReactElement => (
  <div className="flex items-center justify-center p-4">
    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
  </div>
);

const SourceFunding = ({
  funding,
}: Readonly<{ funding: readonly string[] }>): ReactElement | undefined => {
  if (funding.length === ZERO) {
    return void 0;
  }
  return (
    <div className="flex items-center gap-2">
      <DollarSign className="h-4 w-4 text-green-400" />
      <span className="text-foreground">{funding.join(", ")}</span>
    </div>
  );
};

const SourceDetailField = ({
  label,
  value,
}: Readonly<{ label: string; value: string }>): ReactElement => (
  <div>
    <span className="text-muted-foreground">{label}:</span>
    <p className="text-foreground">{value}</p>
  </div>
);

const SourceDetails = ({
  source,
}: Readonly<{ source: QueueSourceView }>): ReactElement | undefined => {
  if (source.url === "") {
    return void 0;
  }
  return (
    <div className="border-t border-border pt-2 space-y-2">
      <SourceDetailField label="Website" value={source.url} />
      <SourceDetailField label="Category" value={source.category.join(", ")} />
    </div>
  );
};

const SourceDetailsButton = ({
  onToggleDetails: handleToggleDetails,
  showSourceDetails,
}: Readonly<Pick<SourceCardProps, "onToggleDetails" | "showSourceDetails">>): ReactElement => (
  <Button size="sm" variant="outline" onClick={handleToggleDetails} className="w-full mt-2 text-xs">
    {(() => {
      if (showSourceDetails) {
        return "Hide";
      }
      return "Show";
    })()} Details
  </Button>
);

const SourceCardBody = ({
  onToggleDetails: handleToggleDetails,
  showSourceDetails,
  source,
  sourceLoading,
}: Readonly<
  Pick<SourceCardProps, "onToggleDetails" | "showSourceDetails" | "source" | "sourceLoading">
>): ReactElement => {
  if (sourceLoading) {
    return <SourceLoadingState />;
  }
  if (source === undefined) {
    return <p className="text-muted-foreground text-xs">Source info unavailable</p>;
  }
  return (
    <div className="space-y-2 text-xs">
      <SourceFunding funding={source.funding} />
      {showSourceDetails && <SourceDetails source={source} />}
      <SourceDetailsButton
        onToggleDetails={handleToggleDetails}
        showSourceDetails={showSourceDetails}
      />
    </div>
  );
};

const SourceDebugButton = ({
  debugOpen,
  onToggleDebug: handleToggleDebug,
}: Readonly<Pick<SourceCardProps, "debugOpen" | "onToggleDebug">>): ReactElement => (
  <Button variant="outline" size="sm" onClick={handleToggleDebug} className="w-full mt-2 text-xs">
    <Bug className="h-3 w-3 mr-1" />
    {(() => {
      if (debugOpen) {
        return "Hide";
      }
      return "Show";
    })()} Debug
  </Button>
);

const SourceCardDebug = ({
  debugData,
  debugLoading,
}: Readonly<{
  readonly debugData?: QueueSourceDebugView;
  readonly debugLoading: boolean;
}>): ReactElement => (
  <div className="bg-black/40 border border-border mt-2 p-2 rounded text-xs">
    <SourceDebugPanel debugLoading={debugLoading} debugData={debugData} />
  </div>
);

const SourceCard = ({
  debugData,
  debugLoading,
  debugOpen,
  onToggleDebug: handleToggleDebug,
  onToggleDetails: handleToggleDetails,
  showSourceDetails,
  source,
  sourceLoading,
}: SourceCardProps): ReactElement => (
  <div className="rounded-lg border border-border bg-card p-4">
    <SourceCardHeader />
    <SourceCardBody
      onToggleDetails={handleToggleDetails}
      showSourceDetails={showSourceDetails}
      source={source}
      sourceLoading={sourceLoading}
    />
    <SourceDebugButton debugOpen={debugOpen} onToggleDebug={handleToggleDebug} />
    {debugOpen && <SourceCardDebug debugData={debugData} debugLoading={debugLoading} />}
  </div>
);

interface ArticleDetailSidebarProps {
  readonly aiAnalysis?: QueueAnalysisView;
  readonly aiAnalysisLoading: boolean;
  readonly debugData?: QueueSourceDebugView;
  readonly debugLoading: boolean;
  readonly debugOpen: boolean;
  readonly onToggleDebug: () => void;
  readonly onToggleSourceDetails: () => void;
  readonly showSourceDetails: boolean;
  readonly source?: QueueSourceView;
  readonly sourceLoading: boolean;
}

const ArticleDetailSidebar = ({
  aiAnalysis,
  aiAnalysisLoading,
  debugData,
  debugLoading,
  debugOpen,
  onToggleDebug: handleToggleDebug,
  onToggleSourceDetails: handleToggleSourceDetails,
  showSourceDetails,
  source,
  sourceLoading,
}: ArticleDetailSidebarProps): ReactElement => (
  <div className="lg:col-span-1 space-y-4">
    <KeyboardShortcutsCard />
    <AiSummaryCard aiAnalysis={aiAnalysis} aiAnalysisLoading={aiAnalysisLoading} />
    <BiasAnalysisCard aiAnalysis={aiAnalysis} />
    <SourceCard
      debugData={debugData}
      debugLoading={debugLoading}
      debugOpen={debugOpen}
      onToggleDebug={handleToggleDebug}
      onToggleDetails={handleToggleSourceDetails}
      showSourceDetails={showSourceDetails}
      source={source}
      sourceLoading={sourceLoading}
    />
  </div>
);

export { ArticleDetailSidebar };
export type { QueueAnalysisView, QueueSourceDebugView, QueueSourceView };
