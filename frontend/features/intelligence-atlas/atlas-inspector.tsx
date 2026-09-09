"use client";
import { hasText } from "@/lib/utils";

import { ArrowUpRight, Clock3, ExternalLink, Network, ShieldCheck } from "lucide-react";
import type { AtlasEntityRecord, AtlasMeasurementsResponse } from "./lib/atlas-schema";
import type { DeepReadonly } from "@/lib/deep-readonly";

import Link from "next/link";
import styles from "./atlas.module.css";
import { useCallback, useMemo } from "react";
import { z } from "zod";

interface AtlasInspectorProps {
  readonly record: ReadonlyAtlasEntityRecord | undefined;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly measurements?: ReadonlyAtlasMeasurementsResponse;
  readonly measurementsLoading?: boolean;
  readonly onSelectConnection: (entityId: string) => void;
}

type AtlasConnection = AtlasEntityRecord["connections"][number];
type AtlasDossierSection = AtlasEntityRecord["dossier_sections"][number];
type AtlasDossierStatement = AtlasDossierSection["statements"][number];
type AtlasEvidence = AtlasEntityRecord["evidence"][number];
type ReadonlyAtlasEntityRecord = DeepReadonly<AtlasEntityRecord>;
type ReadonlyAtlasMeasurementsResponse = DeepReadonly<AtlasMeasurementsResponse>;
type AtlasMeasurement = ReadonlyAtlasMeasurementsResponse["measurements"][number];

const AtlasMeasurementResultSchema = z.object({
  corpus_window: z
    .object({
      end: z.string().nullable().optional(),
      start: z.string().nullable().optional(),
    })
    .optional(),
  denominator: z.number().optional(),
});

const humanize = (value: string): string =>
  value.replaceAll("_", " ").replaceAll(/\b\w/gu, (letter) => letter.toUpperCase());

const AtlasDisplayScalarSchema = z.union([z.string(), z.number(), z.boolean()]);
const AtlasDisplayObjectSchema = z.record(z.string(), z.unknown());
const AtlasDisplayArrayItemSchema = z.union([AtlasDisplayScalarSchema, AtlasDisplayObjectSchema]);
const AtlasDisplayArraySchema = z.array(AtlasDisplayArrayItemSchema);
const AtlasDisplayValueSchema = z.union([
    AtlasDisplayScalarSchema,
    AtlasDisplayArraySchema,
    AtlasDisplayObjectSchema,
  ]);

type AtlasDisplayArrayItem = DeepReadonly<z.infer<typeof AtlasDisplayArrayItemSchema>>;
type AtlasDisplayObject = DeepReadonly<z.infer<typeof AtlasDisplayObjectSchema>>;
type AtlasDisplayValue = DeepReadonly<z.infer<typeof AtlasDisplayValueSchema>>;

type AtlasInspectorRecordProps = Readonly<{
  record: ReadonlyAtlasEntityRecord;
  analysisScores: readonly (readonly [string, number])[];
  details: readonly (readonly [string, string])[];
  measurements?: ReadonlyAtlasMeasurementsResponse;
  measurementsLoading?: boolean;
  onSelectConnection: (entityId: string) => void;
}>;

const displayArrayValue = (value: readonly AtlasDisplayArrayItem[]): string | null => {
    const simpleValues = value.flatMap((item) => {
      const parsed = AtlasDisplayScalarSchema.safeParse(item);
      if (parsed.success) {
  return [parsed.data];
}
return [];
    });
    if (simpleValues.length === value.length) {
      return simpleValues.join(", ");
    }
    if (value.length > 0) {
  return `${value.length} records`;
}
return null;
  },
  displayObjectValue = (value: AtlasDisplayObject): string => `${Object.keys(value).length} fields`,
  displayValue = (value: AtlasDisplayValue): string | null => {
    if ((value === null || value === undefined) || value === "") {
      return null;
    }
    const scalar = AtlasDisplayScalarSchema.safeParse(value);
    if (scalar.success) {
      return String(scalar.data);
    }
    if (Array.isArray(value)) {
      return displayArrayValue(value);
    }
    const object = AtlasDisplayObjectSchema.safeParse(value);
    if (object.success) {
  return displayObjectValue(object.data);
}
return null;
  };

const dateLabel = (value?: string | null): string => {
  if (!hasText(value)) {
    return "Not recorded";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
};

const AtlasEmptyState = ({ title, message }: Readonly<{ title: string; message: string }>) => (
    <div className={styles.emptyState}>
      <div>
        <div className={styles.brandTitle}>{title}</div>
        <p className={styles.contextCopy}>{message}</p>
      </div>
    </div>
  );
const AtlasLoadingState = () => (
    <div className={styles.inspector} aria-busy="true">
      <div className={styles.inspectorHeader}>
        <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
        <div className="mt-4 h-9 w-64 animate-pulse rounded bg-white/10" />
      </div>
      <div className={styles.inspectorBody}>
        <div className="h-32 animate-pulse rounded-2xl bg-white/[0.05]" />
      </div>
    </div>
  );
const AtlasInspectorHeader = ({ record }: Readonly<{ record: ReadonlyAtlasEntityRecord }>) => (
    <header className={styles.inspectorHeader}>
      <div className="flex items-start gap-3">
        <span className={styles.entityMark} data-type={record.entity_type} aria-hidden="true">
          {record.entity_type.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className={styles.brandEyebrow}>{record.entity_type} record</div>
          <h2 className="mt-2 font-serif text-3xl leading-none text-[#f0ede4]">{record.label}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[#c9c3b6]">
            {Boolean(record.subtitle) && <span>{record.subtitle}</span>}
            {Boolean(record.country_code) && <span>{record.country_code}</span>}
            <span className={styles.confidence} data-tier={record.confidence_tier ?? "unresolved"}>
              {humanize(record.confidence_tier ?? "unresolved")}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className={styles.detailCard}>
          <div className={styles.microLabel}>Last verified</div>
          <div className={styles.detailValue}>{dateLabel(record.last_verified_at)}</div>
        </div>
        <div className={styles.detailCard}>
          <div className={styles.microLabel}>Evidence</div>
          <div className={styles.detailValue}>{record.evidence.length} cited records</div>
        </div>
      </div>
      {record.profile_path !== undefined && record.profile_path !== null && record.profile_path !== "" && <Link href={record.profile_path} className="mt-4 inline-flex items-center gap-2 text-sm text-[#d7b35f] hover:text-[#f0ede4]">
          Open full profile <ArrowUpRight className="h-4 w-4" />
        </Link>}
    </header>
  );
const AtlasAnalysisSection = ({
    scores,
  }: Readonly<{ scores: readonly (readonly [string, number])[] }>) => {
    if (scores.length === 0) {
      return null;
    }
    return (
      <section>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#d7b35f]" />
          <h3 className={styles.controlLabel}>Stored source analysis</h3>
        </div>
        <div className={styles.detailGrid}>
          {scores.map(([axis, score]) => (
            <div key={axis} className={styles.detailCard}>
              <div className={styles.microLabel}>{humanize(axis)}</div>
              <div className={styles.detailValue}>{score} / 5</div>
            </div>
          ))}
        </div>
      </section>
    );
  };
const AtlasStatementEvidence = ({ evidence }: Readonly<{ evidence: readonly AtlasEvidence[] }>) => {
    if (evidence.length === 0) {
      return null;
    }
    return (
      <details className="mt-3 text-xs text-[#c9c3b6]">
        <summary className="cursor-pointer text-[#d7b35f]">
          Open claim evidence ({evidence.length})
        </summary>
        <div className="mt-2 space-y-2">
          {evidence.map((item) => (
            <div key={item.id} className="rounded border border-white/10 p-2">
              <div>{item.source_name ?? item.source_type}</div>
              <div>Captured: {dateLabel(item.retrieved_at)}</div>
              {Boolean(item.snapshot_sha256) && <div className="break-all">Snapshot: {item.snapshot_sha256}</div>}
              {Object.keys(item.locator).length > 0 && <div>Locator: {JSON.stringify(item.locator)}</div>}
              {Boolean(item.evidence_class) && <div>Evidence class: {item.evidence_class}</div>}
              {Boolean(item.policy_version) && <div>Policy: {item.policy_version}</div>}
              {Boolean(item.acceptance_decision) && <div>Decision: {item.acceptance_decision}</div>}
            </div>
          ))}
        </div>
      </details>
    );
  };
const AtlasDossierStatementView = ({ statement }: Readonly<{ statement: AtlasDossierStatement }>) => (
    <div className={`${styles.detailCard} col-span-2`}>
      <div className={styles.microLabel}>{statement.label}</div>
      <div className={styles.detailValue}>{statement.answer}</div>
      <div className="mt-2 flex flex-wrap gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[#77736a]">
        <span>{humanize(statement.state)}</span>
        {statement.lifecycle_state !== undefined && statement.lifecycle_state !== null && <span>{humanize(statement.lifecycle_state)}</span>}
        {statement.predicate !== undefined && statement.predicate !== null && statement.predicate !== "" && <span>{statement.predicate}</span>}
      </div>
      <AtlasStatementEvidence evidence={statement.evidence} />
    </div>
  );
const AtlasDossierSectionView = ({ section }: Readonly<{ section: AtlasDossierSection }>) => (
    <section className={(() => {
  if (section.key === "summary") {
    return styles.inspectorSection;
  }
  return void 0;
})()}>
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-[#d7b35f]" />
        <h3 className={styles.controlLabel}>{section.title}</h3>
      </div>
      <div className={styles.detailGrid}>
        {section.statements.map((statement) => (
          <AtlasDossierStatementView
            key={`${section.key}-${statement.label}`}
            statement={statement}
          />
        ))}
      </div>
    </section>
  );
const AtlasIdentitySection = ({
    details,
  }: Readonly<{ details: readonly (readonly [string, string])[] }>) => (
    <section>
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-[#d7b35f]" />
        <h3 className={styles.controlLabel}>Identity and context</h3>
      </div>
      <div className={styles.detailGrid}>
        {(() => {
  if (details.length > 0) {
    return details.map(([key, value]) => <div key={key} className={styles.detailCard}>
              <div className={styles.microLabel}>{humanize(key)}</div>
              <div className={styles.detailValue}>{value}</div>
            </div>);
  }
  return <div className={`${styles.detailCard} col-span-2`}>
            <div className={styles.detailValue}>
              No structured profile fields are indexed for this entity yet.
            </div>
          </div>;
})()}
      </div>
    </section>
  );
const AtlasDossier = ({
    sections,
    details,
  }: Readonly<{
    sections: readonly AtlasDossierSection[];
    details: readonly (readonly [string, string])[];
  }>) => {
    if (sections.length === 0) {
      return <AtlasIdentitySection details={details} />;
    }
    return (
      <>
        {sections.map((section) => (
          <AtlasDossierSectionView key={section.key} section={section} />
        ))}
      </>
    );
  };
const AtlasMeasurementCard = ({ measurement }: Readonly<{ measurement: AtlasMeasurement }>) => {
    const parsedResult = AtlasMeasurementResultSchema.safeParse(measurement.result);
    const denominator = (() => {
  if (parsedResult.success) {
    return parsedResult.data.denominator;
  }
  return void 0;
})();
    const corpusWindow = (() => {
  if (parsedResult.success) {
    return parsedResult.data.corpus_window;
  }
  return void 0;
})();
    return (
      <div className={`${styles.detailCard} col-span-2`}>
        <div className={styles.microLabel}>{humanize(measurement.measurement_name)}</div>
        <div className={styles.detailValue}>
          Denominator: {denominator ?? "not available"}
        </div>
        <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#77736a]">
          {measurement.algorithm_version} ·{" "}
          {(() => {
  if (hasText(corpusWindow?.start)) {
    return dateLabel(corpusWindow.start);
  }
  return "No dated articles";
})()} to{" "}
          {(() => {
  if (hasText(corpusWindow?.end)) {
    return dateLabel(corpusWindow.end);
  }
  return "No dated articles";
})()}
        </div>
        <details className="mt-2 text-xs text-[#c9c3b6]">
          <summary className="cursor-pointer text-[#d7b35f]">Open calculation trace</summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-white/10 p-2">
            {JSON.stringify(measurement.result, undefined, 2)}
          </pre>
        </details>
      </div>
    );
  };
const AtlasMeasurements = ({
    measurements,
    loading,
  }: Readonly<{
    measurements?: ReadonlyAtlasMeasurementsResponse;
    loading: boolean;
  }>) => {
    let content: React.ReactNode = null;
    const measurementItems = measurements?.measurements ?? [];
    if (loading) {
      content = (
        <div className={`${styles.detailCard} mt-2`}>Calculating from the indexed corpus.</div>
      );
    } else if (measurementItems.length > 0) {
      content = (
        <div className={styles.detailGrid}>
          {measurementItems.map((measurement) => (
            <AtlasMeasurementCard key={measurement.id} measurement={measurement} />
          ))}
        </div>
      );
    } else {
      content = (
        <div className={`${styles.detailCard} mt-2`}>
          No measurement is available for this indexed corpus.
        </div>
      );
    }
    return (
      <section className={styles.inspectorSection}>
        <div className="flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-[#d7b35f]" />
          <h3 className={styles.controlLabel}>Corpus measurements</h3>
        </div>
        {content}
      </section>
    );
  };
const AtlasConnectionButton = ({
    edge,
    entity,
    onSelectConnection,
  }: Readonly<{
    edge: AtlasConnection["edge"];
    entity: AtlasConnection["entity"];
    onSelectConnection: (entityId: string) => void;
  }>) => {
    const handleClick = useCallback(() => {
      onSelectConnection(entity.id);
    }, [entity.id, onSelectConnection]);
    return (
      <button
        type="button"
        className={styles.connectionButton}
        aria-label={`Open connection to ${entity.label}`}
        onClick={handleClick}
      >
        <span>
          <span className="block text-sm text-[#f0ede4]">{entity.label}</span>
          <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.14em] text-[#77736a]">
            {humanize(edge.predicate || edge.relation_type)} · {humanize(edge.lifecycle_state)}
          </span>
        </span>
        <span className="text-right">
          <span className={styles.confidence} data-tier={edge.confidence_tier ?? "unresolved"}>
            {(() => {
  if (edge.confidence === null || edge.confidence === undefined) {
    return "Unrated";
  }
  return `${Math.round(edge.confidence * 100)}%`;
})()}
          </span>
          <span className="mt-1 block text-[10px] text-[#77736a]">
            {edge.evidence_count} evidence
          </span>
        </span>
      </button>
    );
  };
const AtlasConnections = ({
    connections,
    onSelectConnection,
  }: Readonly<{
    connections: readonly AtlasConnection[];
    onSelectConnection: (entityId: string) => void;
  }>) => (
    <section className={styles.inspectorSection}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-[#88a9ff]" />
          <h3 className={styles.controlLabel}>Connections</h3>
        </div>
        <span className="font-mono text-[10px] text-[#77736a]">{connections.length}</span>
      </div>
      <div className="mt-2">
        {(() => {
  if (connections.length > 0) {
    return connections.slice(0, 40).map(({
      edge,
      entity
    }) => <AtlasConnectionButton key={edge.id} edge={edge} entity={entity} onSelectConnection={onSelectConnection} />);
  }
  return <p className={styles.contextCopy}>
            This entity has no relationships in the current bounded graph.
          </p>;
})()}
      </div>
    </section>
  );
const AtlasEvidenceCard = ({ evidence }: Readonly<{ evidence: AtlasEvidence }>) => (
    <article className={styles.evidenceCard}>
      <div>
        <div className="text-sm text-[#f0ede4]">
          {evidence.source_name ?? humanize(evidence.source_type)}
        </div>
        {Boolean(evidence.excerpt) && <p className="mt-1 text-xs leading-relaxed text-[#c9c3b6]">{evidence.excerpt}</p>}
        <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.13em] text-[#77736a]">
          Retrieved {dateLabel(evidence.retrieved_at)}
        </div>
      </div>
      {evidence.source_url !== undefined && evidence.source_url !== null && evidence.source_url !== "" && <a href={evidence.source_url} target="_blank" rel="noreferrer" aria-label={`Open evidence from ${evidence.source_name ?? evidence.source_type}`} className="text-[#d7b35f] hover:text-[#f0ede4]">
          <ExternalLink className="h-4 w-4" />
        </a>}
    </article>
  );
const AtlasEvidenceTrail = ({ evidence }: Readonly<{ evidence: readonly AtlasEvidence[] }>) => (
    <section className={styles.inspectorSection}>
      <div className="flex items-center gap-2">
        <Clock3 className="h-4 w-4 text-[#62e3b0]" />
        <h3 className={styles.controlLabel}>Evidence trail</h3>
      </div>
      <div className="mt-2">
        {(() => {
  if (evidence.length > 0) {
    return evidence.map(item => <AtlasEvidenceCard key={item.id} evidence={item} />);
  }
  return <p className={styles.contextCopy}>
            No evidence rows are attached to the visible relationships. The confidence label remains
            explicit rather than implying certainty.
          </p>;
})()}
      </div>
    </section>
  );
const AtlasInspectorRecord = ({
    record,
    analysisScores,
    details,
    measurements,
    measurementsLoading,
    onSelectConnection,
  }: AtlasInspectorRecordProps) => (
    <div className={styles.inspector}>
      <AtlasInspectorHeader record={record} />
      <div className={styles.inspectorBody}>
        <AtlasAnalysisSection scores={analysisScores} />
        <AtlasDossier sections={record.dossier_sections} details={details} />
        <AtlasMeasurements measurements={measurements} loading={Boolean(measurementsLoading)} />
        <AtlasConnections
          connections={record.connections}
          onSelectConnection={onSelectConnection}
        />
        <AtlasEvidenceTrail evidence={record.evidence} />
      </div>
    </div>
  );

export const AtlasInspector = ({
  record,
  loading,
  error,
  measurements,
  measurementsLoading,
  onSelectConnection,
}: Readonly<AtlasInspectorProps>) => {
  const analysisScores = useMemo(() => {
      if (!record) {
        return [];
      }
      return Object.entries(record.details.analysis_scores ?? {}).flatMap(([axis, score]) => {
        const parsed = z.number().safeParse(score);
        if (parsed.success) {
  return [[axis, parsed.data]] as const;
}
return [];
      });
    }, [record]),
    details = useMemo(() => {
      if (!record) {
        return [];
      }
      return Object.entries(record.details)
        .filter(([key]) => key !== "analysis_scores")
        .map(([key, value]) => {
          const parsed = AtlasDisplayValueSchema.safeParse(value);
          return [key, (() => {
  if (parsed.success) {
    return displayValue(parsed.data);
  }
  return null;
})()] as const;
        })
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
        .slice(0, 18);
    }, [record]);

  if (loading) {
    return <AtlasLoadingState />;
  }
  if (error) {
    return <AtlasEmptyState title="Record unavailable" message={error.message} />;
  }
  if (!record) {
    return (
      <AtlasEmptyState
        title="Select an entity"
        message="Choose an outlet, organization, person, or reporter to inspect its evidence and connections."
      />
    );
  }

  return (
    <AtlasInspectorRecord
      record={record}
      analysisScores={analysisScores}
      details={details}
      measurements={measurements}
      measurementsLoading={measurementsLoading}
      onSelectConnection={onSelectConnection}
    />
  );
};
