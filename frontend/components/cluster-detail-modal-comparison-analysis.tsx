"use client";

import { Badge } from "@/components/ui/badge";
import type { CSSProperties } from "react";
import type { ComparisonData } from "./cluster-detail-modal-types";

const getKeywordShareStyle = (value: number, otherValue: number): CSSProperties => {
  const total = value + otherValue || 1;
  return { width: `${(value / total) * 100}%` };
};

interface EntitiesBlockProps {
  readonly comparisonData: ComparisonData;
  readonly primarySource: string;
  readonly secondarySource: string;
}

type EntityValues = Readonly<{
  readonly persons: readonly string[];
  readonly organizations: readonly string[];
}>;

const getEntityBadgeVariant = (outline: boolean): "default" | "outline" => {
  if (outline) {
    return "outline";
  }
  return "default";
};

const getEntityBadgeClass = (outline: boolean): string => {
  if (outline) {
    return "text-[9px] mr-1";
  }
  return "text-[10px] bg-green-500/20 text-green-400 border-green-500/40";
};

const EntityBadgeList = ({
  values,
  prefix,
  outline,
}: Readonly<{
  readonly values: readonly string[];
  readonly prefix: string;
  readonly outline: boolean;
}>) => (
  <div className="flex flex-wrap gap-1 mt-1">
    {values.map((value) => (
      <Badge
        key={`${prefix}-${value}`}
        variant={getEntityBadgeVariant(outline)}
        className={getEntityBadgeClass(outline)}
      >
        {value}
      </Badge>
    ))}
  </div>
);

const CommonEntityGroup = ({
  label,
  values,
  prefix,
}: Readonly<{
  readonly label: string;
  readonly values: readonly string[];
  readonly prefix: string;
}>) => {
  if (values.length === 0) {
    return null;
  }
  return (
    <div className="mb-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <EntityBadgeList values={values} prefix={prefix} outline={false} />
    </div>
  );
};

const getUniqueEntityValues = (entities: EntityValues): readonly string[] => [
  ...entities.persons.slice(0, 3),
  ...entities.organizations.slice(0, 3),
];

const UniqueEntityColumn = ({
  source,
  entities,
  prefix,
}: Readonly<{
  readonly source: string;
  readonly entities: EntityValues;
  readonly prefix: string;
}>) => (
  <div>
    <span className="text-xs text-muted-foreground block mb-2">Unique to {source}:</span>
    <EntityBadgeList values={getUniqueEntityValues(entities)} prefix={prefix} outline />
  </div>
);

const UniqueEntitiesGrid = ({
  comparisonData,
  primarySource,
  secondarySource,
}: EntitiesBlockProps) => (
  <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-border/60">
    <UniqueEntityColumn
      source={primarySource}
      entities={comparisonData.entities.comparison.unique_to_source_1}
      prefix="source-one"
    />
    <UniqueEntityColumn
      source={secondarySource}
      entities={comparisonData.entities.comparison.unique_to_source_2}
      prefix="source-two"
    />
  </div>
);

const EntitiesHeading = ({ count }: Readonly<{ count: number }>) => (
  <h4 className="font-bold mb-4 flex items-center gap-2">
    <span>Named Entities</span>
    <Badge variant="outline" className="text-[10px]">
      {count} shared
    </Badge>
  </h4>
);

const EntitiesBlock = ({ comparisonData, primarySource, secondarySource }: EntitiesBlockProps) => {
  const commonEntities = comparisonData.entities.comparison.common_entities;
  return (
    <div className="bg-[var(--news-bg-secondary)] rounded-lg border border-border/60 p-4">
      <EntitiesHeading count={comparisonData.summary.common_entities_count} />
      <CommonEntityGroup label="Common People:" values={commonEntities.persons} prefix="person" />
      <CommonEntityGroup
        label="Common Organizations:"
        values={commonEntities.organizations}
        prefix="organization"
      />
      <UniqueEntitiesGrid
        comparisonData={comparisonData}
        primarySource={primarySource}
        secondarySource={secondarySource}
      />
    </div>
  );
};

interface KeywordsBlockProps {
  readonly comparisonData: ComparisonData;
  readonly primarySource: string;
  readonly secondarySource: string;
}

type CommonKeyword = ComparisonData["keywords"]["comparison"]["common_keywords"][number];
type UniqueKeyword = ComparisonData["keywords"]["comparison"]["unique_to_source_1"][number];

const KeywordShareBar = ({ keyword }: Readonly<{ keyword: CommonKeyword }>) => (
  <div className="flex-1 h-4 bg-[var(--news-bg-primary)] rounded-full overflow-hidden flex">
    <div
      className="h-full bg-blue-500/60"
      style={getKeywordShareStyle(keyword.source_1_freq, keyword.source_2_freq)}
    />
    <div
      className="h-full bg-orange-500/60"
      style={getKeywordShareStyle(keyword.source_2_freq, keyword.source_1_freq)}
    />
  </div>
);

const getKeywordEmphasisClass = (emphasis: string): string => {
  if (emphasis === "source_1") {
    return "bg-blue-500/20 text-blue-400";
  }
  return "bg-orange-500/20 text-orange-400";
};

const KeywordEmphasisBadge = ({
  keyword,
  primarySource,
  secondarySource,
}: Readonly<{
  readonly keyword: CommonKeyword;
  readonly primarySource: string;
  readonly secondarySource: string;
}>) => {
  if (keyword.emphasis === "equal") {
    return null;
  }
  let source = secondarySource;
  if (keyword.emphasis === "source_1") {
    source = primarySource;
  }
  return (
    <Badge className={`text-[9px] ${getKeywordEmphasisClass(keyword.emphasis)}`}>
      {source.slice(0, 8)}
    </Badge>
  );
};

const CommonKeywordRow = ({
  keyword,
  primarySource,
  secondarySource,
}: Readonly<{
  readonly keyword: CommonKeyword;
  readonly primarySource: string;
  readonly secondarySource: string;
}>) => (
  <div className="flex items-center gap-2 text-xs">
    <span className="w-20 font-medium">{keyword.keyword}</span>
    <KeywordShareBar keyword={keyword} />
    <span className="w-8 text-right text-[10px] text-muted-foreground">
      {keyword.source_1_freq} vs {keyword.source_2_freq}
    </span>
    <KeywordEmphasisBadge
      keyword={keyword}
      primarySource={primarySource}
      secondarySource={secondarySource}
    />
  </div>
);

const CommonKeywords = ({
  keywords,
  primarySource,
  secondarySource,
}: Readonly<{
  readonly keywords: readonly CommonKeyword[];
  readonly primarySource: string;
  readonly secondarySource: string;
}>) => {
  if (keywords.length === 0) {
    return null;
  }
  return (
    <div className="mb-4">
      <span className="text-xs text-muted-foreground">Common Keywords (with emphasis):</span>
      <div className="mt-2 space-y-1">
        {keywords.slice(0, 8).map((keyword) => (
          <CommonKeywordRow
            key={keyword.keyword}
            keyword={keyword}
            primarySource={primarySource}
            secondarySource={secondarySource}
          />
        ))}
      </div>
    </div>
  );
};

const UniqueKeywordList = ({
  keywords,
  prefix,
}: Readonly<{ keywords: readonly UniqueKeyword[]; prefix: string }>) => (
  <div className="flex flex-wrap gap-1 mt-1">
    {keywords.slice(0, 6).map((keyword) => (
      <Badge key={`${prefix}-${keyword.keyword}`} variant="outline" className="text-[9px]">
        {keyword.keyword} ({keyword.frequency})
      </Badge>
    ))}
  </div>
);

const UniqueKeywordColumn = ({
  source,
  keywords,
  prefix,
}: Readonly<{
  readonly source: string;
  readonly keywords: readonly UniqueKeyword[];
  readonly prefix: string;
}>) => (
  <div>
    <span className="text-xs text-muted-foreground">Unique to {source}:</span>
    <UniqueKeywordList keywords={keywords} prefix={prefix} />
  </div>
);

const UniqueKeywordsGrid = ({
  comparisonData,
  primarySource,
  secondarySource,
}: KeywordsBlockProps) => (
  <div className="grid grid-cols-2 gap-3">
    <UniqueKeywordColumn
      source={primarySource}
      keywords={comparisonData.keywords.comparison.unique_to_source_1}
      prefix="source-one"
    />
    <UniqueKeywordColumn
      source={secondarySource}
      keywords={comparisonData.keywords.comparison.unique_to_source_2}
      prefix="source-two"
    />
  </div>
);

const KeywordsBlock = ({ comparisonData, primarySource, secondarySource }: KeywordsBlockProps) => (
  <div className="bg-[var(--news-bg-secondary)] rounded-lg border border-border/60 p-4">
    <h4 className="font-bold mb-4">Keyword Analysis</h4>
    <CommonKeywords
      keywords={comparisonData.keywords.comparison.common_keywords}
      primarySource={primarySource}
      secondarySource={secondarySource}
    />
    <UniqueKeywordsGrid
      comparisonData={comparisonData}
      primarySource={primarySource}
      secondarySource={secondarySource}
    />
  </div>
);

interface ComparisonSummaryProps {
  readonly comparisonData: ComparisonData;
  readonly primarySource: string;
  readonly secondarySource: string;
}

const ComparisonSummary = ({
  comparisonData,
  primarySource,
  secondarySource,
}: ComparisonSummaryProps) => (
  <div className="bg-[var(--news-bg-secondary)] rounded-lg border border-border/60 p-4">
    <h4 className="font-bold mb-4">Comparison Summary</h4>
    <ComparisonSummaryGrid
      comparisonData={comparisonData}
      primarySource={primarySource}
      secondarySource={secondarySource}
    />
  </div>
);

const ComparisonSummaryMetric = ({
  value,
  label,
  className,
}: Readonly<{ value: number; label: string; className: string }>) => (
  <div className="text-center">
    <div className={`text-2xl font-bold ${className}`}>{value}</div>
    <div className="text-xs text-muted-foreground">{label}</div>
  </div>
);

const ComparisonSummaryGrid = ({
  comparisonData,
  primarySource,
  secondarySource,
}: ComparisonSummaryProps) => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
    <ComparisonSummaryMetric
      value={comparisonData.summary.common_entities_count}
      label="Common Entities"
      className="text-green-400"
    />
    <ComparisonSummaryMetric
      value={comparisonData.summary.unique_entities_source_1}
      label={`Unique to ${primarySource}`}
      className="text-blue-400"
    />
    <ComparisonSummaryMetric
      value={comparisonData.summary.unique_entities_source_2}
      label={`Unique to ${secondarySource}`}
      className="text-orange-400"
    />
    <ComparisonSummaryMetric
      value={comparisonData.summary.common_keywords_count}
      label="Common Keywords"
      className="text-primary"
    />
  </div>
);

export { ComparisonSummary, EntitiesBlock, KeywordsBlock };
