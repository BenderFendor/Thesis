"use client";

import Link from "next/link";
import { ArrowUpRight, Clock3, ExternalLink, Network, ShieldCheck } from "lucide-react";

import type { AtlasEntityRecord, AtlasMeasurementsResponse } from "./lib/atlas-schema";
import styles from "./atlas.module.css";

interface AtlasInspectorProps {
  record: AtlasEntityRecord | undefined;
  loading: boolean;
  error: Error | null;
  measurements?: AtlasMeasurementsResponse;
  measurementsLoading?: boolean;
  onSelectConnection: (entityId: string) => void;
}

type AtlasConnection = AtlasEntityRecord["connections"][number];
type AtlasDossierSection = AtlasEntityRecord["dossier_sections"][number];
type AtlasDossierStatement = AtlasDossierSection["statements"][number];
type AtlasEvidence = AtlasEntityRecord["evidence"][number];
type AtlasMeasurement = AtlasMeasurementsResponse["measurements"][number];

function humanize(value: string): string {
  return value.replaceAll("_", " ").replaceAll(/\b\w/gu, (letter) => letter.toUpperCase());
}

const displayArrayValue = (value: readonly unknown[]): string | null => {
  const simpleValues = value.filter((item) => ["string", "number", "boolean"].includes(typeof item));
  if (simpleValues.length === value.length) {return simpleValues.join(", ");}
  return value.length > 0 ? `${value.length} records` : null;
},

 displayObjectValue = (value: object): string => `${Object.keys(value).length} fields`,

 displayValue = (value: unknown): string | null => {
  if (value == null || value === "") {return null;}
  switch (typeof value) {
    case "boolean":
    case "number":
    case "string": {
      return String(value);
    }
    case "object": {
      return Array.isArray(value) ? displayArrayValue(value) : displayObjectValue(value);
    }
    default: {
      return null;
    }
  }
};

function dateLabel(value?: string | null): string {
  if (!value) {return "Not recorded";}
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {return "Not recorded";}
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

const AtlasEmptyState = ({ title, message }: Readonly<{ title: string; message: string }>) => (
  <div className={styles.emptyState}>
    <div>
      <div className={styles.brandTitle}>{title}</div>
      <p className={styles.contextCopy}>{message}</p>
    </div>
  </div>
),

 AtlasLoadingState = () => (
  <div className={styles.inspector} aria-busy="true">
    <div className={styles.inspectorHeader}>
      <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
      <div className="mt-4 h-9 w-64 animate-pulse rounded bg-white/10" />
    </div>
    <div className={styles.inspectorBody}>
      <div className="h-32 animate-pulse rounded-2xl bg-white/[0.05]" />
    </div>
  </div>
),

 AtlasInspectorHeader = ({ record }: Readonly<{ record: AtlasEntityRecord }>) => (
  <header className={styles.inspectorHeader}>
    <div className="flex items-start gap-3">
      <span className={styles.entityMark} data-type={record.entity_type} aria-hidden="true">
        {record.entity_type.slice(0, 2).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className={styles.brandEyebrow}>{record.entity_type} record</div>
        <h2 className="mt-2 font-serif text-3xl leading-none text-[#f0ede4]">{record.label}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[#c9c3b6]">
          {record.subtitle ? <span>{record.subtitle}</span> : null}
          {record.country_code ? <span>{record.country_code}</span> : null}
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
    {record.profile_path ? (
      <Link href={record.profile_path} className="mt-4 inline-flex items-center gap-2 text-sm text-[#d7b35f] hover:text-[#f0ede4]">
        Open full profile <ArrowUpRight className="h-4 w-4" />
      </Link>
    ) : null}
  </header>
),

 AtlasAnalysisSection = ({ scores }: Readonly<{ scores: readonly [string, number][] }>) => {
  if (scores.length === 0) {return null;}
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
},

 AtlasStatementEvidence = ({ evidence }: Readonly<{ evidence: readonly AtlasEvidence[] }>) => {
  if (evidence.length === 0) {return null;}
  return (
    <details className="mt-3 text-xs text-[#c9c3b6]">
      <summary className="cursor-pointer text-[#d7b35f]">Open claim evidence ({evidence.length})</summary>
      <div className="mt-2 space-y-2">
        {evidence.map((item) => (
          <div key={item.id} className="rounded border border-white/10 p-2">
            <div>{item.source_name || item.source_type}</div>
            <div>Captured: {dateLabel(item.retrieved_at)}</div>
            {item.snapshot_sha256 ? <div className="break-all">Snapshot: {item.snapshot_sha256}</div> : null}
            {Object.keys(item.locator).length > 0 ? <div>Locator: {JSON.stringify(item.locator)}</div> : null}
            {item.evidence_class ? <div>Evidence class: {item.evidence_class}</div> : null}
            {item.policy_version ? <div>Policy: {item.policy_version}</div> : null}
            {item.acceptance_decision ? <div>Decision: {item.acceptance_decision}</div> : null}
          </div>
        ))}
      </div>
    </details>
  );
},

 AtlasDossierStatementView = ({ statement }: Readonly<{ statement: AtlasDossierStatement }>) => (
  <div className={`${styles.detailCard} col-span-2`}>
    <div className={styles.microLabel}>{statement.label}</div>
    <div className={styles.detailValue}>{statement.answer}</div>
    <div className="mt-2 flex flex-wrap gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[#77736a]">
      <span>{humanize(statement.state)}</span>
      {statement.lifecycle_state ? <span>{humanize(statement.lifecycle_state)}</span> : null}
      {statement.predicate ? <span>{statement.predicate}</span> : null}
    </div>
    <AtlasStatementEvidence evidence={statement.evidence} />
  </div>
),

 AtlasDossierSectionView = ({ section }: Readonly<{ section: AtlasDossierSection }>) => (
  <section className={section.key === "summary" ? styles.inspectorSection : undefined}>
    <div className="flex items-center gap-2">
      <ShieldCheck className="h-4 w-4 text-[#d7b35f]" />
      <h3 className={styles.controlLabel}>{section.title}</h3>
    </div>
    <div className={styles.detailGrid}>
      {section.statements.map((statement) => (
        <AtlasDossierStatementView key={`${section.key}-${statement.label}`} statement={statement} />
      ))}
    </div>
  </section>
),

 AtlasIdentitySection = ({ details }: Readonly<{ details: readonly (readonly [string, string])[] }>) => (
  <section>
    <div className="flex items-center gap-2">
      <ShieldCheck className="h-4 w-4 text-[#d7b35f]" />
      <h3 className={styles.controlLabel}>Identity and context</h3>
    </div>
    <div className={styles.detailGrid}>
      {details.length > 0 ? (
        details.map(([key, value]) => (
          <div key={key} className={styles.detailCard}>
            <div className={styles.microLabel}>{humanize(key)}</div>
            <div className={styles.detailValue}>{value}</div>
          </div>
        ))
      ) : (
        <div className={`${styles.detailCard} col-span-2`}>
          <div className={styles.detailValue}>No structured profile fields are indexed for this entity yet.</div>
        </div>
      )}
    </div>
  </section>
),

 AtlasDossier = ({
  sections,
  details,
}: Readonly<{
  sections: readonly AtlasDossierSection[];
  details: readonly (readonly [string, string])[];
}>) => {
  if (sections.length === 0) {return <AtlasIdentitySection details={details} />;}
  return (
    <>
      {sections.map((section) => (
        <AtlasDossierSectionView key={section.key} section={section} />
      ))}
    </>
  );
},

 AtlasMeasurementCard = ({ measurement }: Readonly<{ measurement: AtlasMeasurement }>) => {
  const { denominator } = measurement.result,
   corpusWindow = measurement.result.corpus_window as { start?: string | null; end?: string | null } | undefined;
  return (
    <div className={`${styles.detailCard} col-span-2`}>
      <div className={styles.microLabel}>{humanize(measurement.measurement_name)}</div>
      <div className={styles.detailValue}>
        Denominator: {typeof denominator === "number" ? denominator : "not available"}
      </div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#77736a]">
        {measurement.algorithm_version} · {corpusWindow?.start ? dateLabel(corpusWindow.start) : "No dated articles"} to {corpusWindow?.end ? dateLabel(corpusWindow.end) : "No dated articles"}
      </div>
      <details className="mt-2 text-xs text-[#c9c3b6]">
        <summary className="cursor-pointer text-[#d7b35f]">Open calculation trace</summary>
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-white/10 p-2">{JSON.stringify(measurement.result, undefined, 2)}</pre>
      </details>
    </div>
  );
},

 AtlasMeasurements = ({
  measurements,
  loading,
}: Readonly<{
  measurements?: AtlasMeasurementsResponse;
  loading: boolean;
}>) => {
  let content: React.ReactNode;
  if (loading) {
    content = <div className={`${styles.detailCard} mt-2`}>Calculating from the indexed corpus.</div>;
  } else if (measurements?.measurements.length) {
    content = (
      <div className={styles.detailGrid}>
        {measurements.measurements.map((measurement) => (
          <AtlasMeasurementCard key={measurement.id} measurement={measurement} />
        ))}
      </div>
    );
  } else {
    content = <div className={`${styles.detailCard} mt-2`}>No measurement is available for this indexed corpus.</div>;
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
},

 AtlasConnections = ({
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
      {connections.length > 0 ? (
        connections.slice(0, 40).map(({ edge, entity }) => (
          <button
            key={edge.id}
            type="button"
            className={styles.connectionButton}
            onClick={() =>{  onSelectConnection(entity.id); }}
          >
            <span>
              <span className="block text-sm text-[#f0ede4]">{entity.label}</span>
              <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.14em] text-[#77736a]">
                {humanize(edge.predicate || edge.relation_type)} · {humanize(edge.lifecycle_state)}
              </span>
            </span>
            <span className="text-right">
              <span className={styles.confidence} data-tier={edge.confidence_tier ?? "unresolved"}>
                {edge.confidence == null ? "Unrated" : `${Math.round(edge.confidence * 100)}%`}
              </span>
              <span className="mt-1 block text-[10px] text-[#77736a]">{edge.evidence_count} evidence</span>
            </span>
          </button>
        ))
      ) : (
        <p className={styles.contextCopy}>This entity has no relationships in the current bounded graph.</p>
      )}
    </div>
  </section>
),

 AtlasEvidenceCard = ({ evidence }: Readonly<{ evidence: AtlasEvidence }>) => (
  <article className={styles.evidenceCard}>
    <div>
      <div className="text-sm text-[#f0ede4]">{evidence.source_name || humanize(evidence.source_type)}</div>
      {evidence.excerpt ? <p className="mt-1 text-xs leading-relaxed text-[#c9c3b6]">{evidence.excerpt}</p> : null}
      <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.13em] text-[#77736a]">
        Retrieved {dateLabel(evidence.retrieved_at)}
      </div>
    </div>
    {evidence.source_url ? (
      <a
        href={evidence.source_url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open evidence from ${evidence.source_name || evidence.source_type}`}
        className="text-[#d7b35f] hover:text-[#f0ede4]"
      >
        <ExternalLink className="h-4 w-4" />
      </a>
    ) : null}
  </article>
),

 AtlasEvidenceTrail = ({ evidence }: Readonly<{ evidence: readonly AtlasEvidence[] }>) => (
  <section className={styles.inspectorSection}>
    <div className="flex items-center gap-2">
      <Clock3 className="h-4 w-4 text-[#62e3b0]" />
      <h3 className={styles.controlLabel}>Evidence trail</h3>
    </div>
    <div className="mt-2">
      {evidence.length > 0 ? (
        evidence.map((item) => <AtlasEvidenceCard key={item.id} evidence={item} />)
      ) : (
        <p className={styles.contextCopy}>No evidence rows are attached to the visible relationships. The confidence label remains explicit rather than implying certainty.</p>
      )}
    </div>
  </section>
),

 AtlasInspectorRecord = ({
  record,
  analysisScores,
  details,
  measurements,
  measurementsLoading,
  onSelectConnection,
}: Readonly<{
  record: AtlasEntityRecord;
  analysisScores: readonly [string, number][];
  details: readonly (readonly [string, string])[];
  measurements?: AtlasMeasurementsResponse;
  measurementsLoading?: boolean;
  onSelectConnection: (entityId: string) => void;
}>) => (
  <div className={styles.inspector}>
    <AtlasInspectorHeader record={record} />
    <div className={styles.inspectorBody}>
      <AtlasAnalysisSection scores={analysisScores} />
      <AtlasDossier sections={record.dossier_sections} details={details} />
      <AtlasMeasurements measurements={measurements} loading={Boolean(measurementsLoading)} />
      <AtlasConnections connections={record.connections} onSelectConnection={onSelectConnection} />
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
}: AtlasInspectorProps) => {
  if (loading) {return <AtlasLoadingState />;}
  if (error) {return <AtlasEmptyState title="Record unavailable" message={error.message} />;}
  if (!record) {
    return <AtlasEmptyState title="Select an entity" message="Choose an outlet, organization, person, or reporter to inspect its evidence and connections." />;
  }

  const analysisScores = Object.entries(record.details.analysis_scores ?? {}).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  ),
   details = Object.entries(record.details)
    .filter(([key]) => key !== "analysis_scores")
    .map(([key, value]) => [key, displayValue(value)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
    .slice(0, 18);

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
