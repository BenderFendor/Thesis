import { z } from "zod";

import { api, query } from "./client";
import type {
  AgenticResearchResult,
} from "./primitives";
import type { DeepReadonly } from "../deep-readonly";
import type {
  ApiOpaqueObject,
  ArticleAnalysis,
  Highlight,
  LanguageDiagnostics,
  ReporterCareerTimeline,
  ReporterProfile,
  SourceCredibilityProfile,
  SourceResearchProfile,
  WikiIndexStatus,
  WikiReporterCard,
  WikiReporterDossier,
  WikiSourceProfile,
} from "./types";
import {
  AgenticResearchResponseSchema,
  ArticleAnalysisResponseSchema,
  HighlightSchema,
  InlineDefineResponseSchema,
  LanguageDiagnosticsResponseSchema,
  ReporterProfileSchema,
  SourceCredibilityProfileSchema,
  SourceResearchProfileSchema,
  WikiIndexStatusSchema,
  WikiIndexTriggerResponseSchema,
  WikiReporterCardSchema,
  WikiReporterDossierSchema,
  WikiSourceProfileSchema,
} from "./response-schemas";

const analyzeArticle = (url: string, sourceName?: string): Promise<ArticleAnalysis> =>
  api("/api/article/analyze", ArticleAnalysisResponseSchema, {
    body: JSON.stringify({ source_name: sourceName, url }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

const performAgenticSearch = async (
  queryText: string,
  maxSteps = 8,
): Promise<AgenticResearchResult> => {
  const payload = await api("/api/news/research", AgenticResearchResponseSchema, {
    body: JSON.stringify({ max_steps: maxSteps, query: queryText }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  return {
    answer: payload.answer,
    citations: payload.referenced_articles,
    reasoning: payload.thinking_steps,
    success: payload.success,
  };
};

const withForceRefresh = (path: string, forceRefresh: boolean): string => {
  if (!forceRefresh) {
    return path;
  }
  return `${path}?force_refresh=true`;
};

const researchSourceProfile = (
  name: string,
  website?: string,
  forceRefresh = false,
): Promise<SourceResearchProfile> =>
  api(withForceRefresh("/research/entity/source/profile", forceRefresh), SourceResearchProfileSchema, {
    body: JSON.stringify({ name, website }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

const checkSourceProfileCache = (
  name: string,
  website?: string,
): Promise<SourceResearchProfile | null> =>
  api(
    "/research/entity/source/profile?cache_only=true",
    SourceResearchProfileSchema.nullable(),
    {
    body: JSON.stringify({ name, website }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    },
  );

const profileReporter = (
  name: string,
  organization?: string,
  articleContext?: string,
  forceRefresh = false,
): Promise<ReporterProfile> =>
  api(withForceRefresh("/research/entity/reporter/profile", forceRefresh), ReporterProfileSchema, {
    body: JSON.stringify({ article_context: articleContext, name, organization }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

const fetchSourceCredibility = (domain: string): Promise<SourceCredibilityProfile> =>
  api(`/sources/${encodeURIComponent(domain)}/credibility`, SourceCredibilityProfileSchema);

// --- Wiki ---

const fetchWikiSource = (sourceName: string): Promise<WikiSourceProfile> =>
  api(`/api/wiki/sources/${encodeURIComponent(sourceName)}`, WikiSourceProfileSchema);

const fetchWikiReporters = (
  params: Readonly<{ search?: string; outlet?: string; limit?: number; offset?: number }> = {},
): Promise<WikiReporterCard[]> =>
  api(`/api/wiki/reporters${query(params)}`, z.array(WikiReporterCardSchema));

const fetchWikiReporter = (reporterId: number): Promise<WikiReporterDossier> =>
  api(`/api/wiki/reporters/${reporterId}`, WikiReporterDossierSchema);

const ReporterOwnershipRefSchema = z.object({
  entity_id: z.string(),
  entity_type: z.string().nullable().optional(),
  label: z.string(),
  profile_path: z.string().nullable().optional(),
});

const ReporterSharedOwnerFindingSchema = z.object({
  claim_ids: z.array(z.string()),
  evidence_count: z.number(),
  outlets: z.array(ReporterOwnershipRefSchema),
  owner: ReporterOwnershipRefSchema,
});

const ReporterTimelineEntrySchema = z.object({
  article_count: z.number().nullable().optional(),
  end_date: z.string().nullable().optional(),
  evidence_url: z.string().nullable().optional(),
  outlet: z.string(),
  role: z.string().nullable().optional(),
  source: z.enum(["byline", "affiliation"]),
  start_date: z.string().nullable().optional(),
});

const ReporterCareerTimelineSchema = z.object({
  shared_owner_findings: z.array(ReporterSharedOwnerFindingSchema),
  timeline: z.array(ReporterTimelineEntrySchema),
});

type ReporterCareerTimelineInput = z.input<typeof ReporterCareerTimelineSchema>;
type ReporterCareerTimelineCandidate =
  | DeepReadonly<ReporterCareerTimelineInput>
  | DeepReadonly<ApiOpaqueObject>
  | null;

const parseReporterCareerTimeline = (
  raw: ReporterCareerTimelineCandidate,
): ReporterCareerTimeline | null => {
  if (raw === null) {
    return null;
  }
  const result = ReporterCareerTimelineSchema.safeParse(raw);
  if (!result.success) {
    return null;
  }
  return result.data;
};

const fetchWikiIndexStatus = (): Promise<WikiIndexStatus> =>
  api("/api/wiki/index/status", WikiIndexStatusSchema);

const triggerWikiIndex = (sourceName: string): Promise<{ status: string; message: string }> =>
  api(
    `/api/wiki/index/${encodeURIComponent(sourceName)}`,
    WikiIndexTriggerResponseSchema,
    { method: "POST" },
  );

// --- Highlights / language diagnostics / inline definition ---

const createHighlight = (
  request: Readonly<{
    article_url: string;
    highlighted_text: string;
    color: Highlight["color"];
    note?: string;
    character_start: number;
    character_end: number;
    client_id?: string;
  }>,
): Promise<Highlight> =>
  api("/api/queue/highlights", HighlightSchema, {
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

const updateHighlight = (
  highlightId: number,
  request: Readonly<{
    note?: string;
    color?: Highlight["color"];
    article_url?: string;
    highlighted_text?: string;
    character_start?: number;
    character_end?: number;
  }>,
): Promise<Highlight> =>
  api(`/api/queue/highlights/${highlightId}`, HighlightSchema, {
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });

const getHighlightsForArticle = (articleUrl: string): Promise<Highlight[]> =>
  api(
    `/api/queue/highlights/article/${encodeURIComponent(articleUrl)}`,
    z.array(HighlightSchema),
  );

const fetchLanguageDiagnostics = (
  request: Readonly<{
    url: string;
    sourceName?: string;
    text?: string;
    title?: string;
  }>,
): Promise<LanguageDiagnostics> =>
  api("/api/article/language-diagnostics", LanguageDiagnosticsResponseSchema, {
    body: JSON.stringify({
      source_name: request.sourceName,
      text: request.text,
      title: request.title,
      url: request.url,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

const requestInlineDefinition = (
  term: string,
  context?: string,
): Promise<{
  success: boolean;
  term: string;
  definition?: string | null;
  error?: string | null;
}> =>
  api("/api/inline/define", InlineDefineResponseSchema, {
    body: JSON.stringify({ context, term }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });


export {
  analyzeArticle,
  performAgenticSearch,
  researchSourceProfile,
  checkSourceProfileCache,
  profileReporter,
  fetchSourceCredibility,
  fetchWikiSource,
  fetchWikiReporters,
  fetchWikiReporter,
  parseReporterCareerTimeline,
  fetchWikiIndexStatus,
  triggerWikiIndex,
  createHighlight,
  updateHighlight,
  getHighlightsForArticle,
  fetchLanguageDiagnostics,
  requestInlineDefinition,
};
