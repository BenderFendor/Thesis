"use client";

import Link from "next/link";
import { ArrowUpRight, Clock3, ExternalLink, Network, ShieldCheck } from "lucide-react";

import type { AtlasEntityRecord } from "./lib/atlas-schema";
import styles from "./atlas.module.css";

interface AtlasInspectorProps {
  record: AtlasEntityRecord | undefined;
  loading: boolean;
  error: Error | null;
  onSelectConnection: (entityId: string) => void;
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const simpleValues = value.filter((item) => ["string", "number", "boolean"].includes(typeof item));
    if (simpleValues.length === value.length) return simpleValues.join(", ");
    return value.length > 0 ? `${value.length} records` : null;
  }
  if (typeof value === "object") return `${Object.keys(value as Record<string, unknown>).length} fields`;
  return null;
}

function dateLabel(value?: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function AtlasInspector({ record, loading, error, onSelectConnection }: AtlasInspectorProps) {
  if (loading) {
    return (
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
  }

  if (error) {
    return (
      <div className={styles.emptyState}>
        <div>
          <div className={styles.brandTitle}>Record unavailable</div>
          <p className={styles.contextCopy}>{error.message}</p>
        </div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className={styles.emptyState}>
        <div>
          <div className={styles.brandTitle}>Select an entity</div>
          <p className={styles.contextCopy}>Choose a source, organization, or reporter to inspect its evidence and connections.</p>
        </div>
      </div>
    );
  }

  const analysisScores = Object.entries(record.details.analysis_scores ?? {}).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  );
  const details = Object.entries(record.details)
    .filter(([key]) => key !== "analysis_scores")
    .map(([key, value]) => [key, displayValue(value)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
    .slice(0, 18);

  return (
    <div className={styles.inspector}>
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

      <div className={styles.inspectorBody}>
        {analysisScores.length > 0 ? (
          <section>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#d7b35f]" />
              <h3 className={styles.controlLabel}>Stored source analysis</h3>
            </div>
            <div className={styles.detailGrid}>
              {analysisScores.map(([axis, score]) => (
                <div key={axis} className={styles.detailCard}>
                  <div className={styles.microLabel}>{humanize(axis)}</div>
                  <div className={styles.detailValue}>{score} / 5</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

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

        <section className={styles.inspectorSection}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-[#88a9ff]" />
              <h3 className={styles.controlLabel}>Connections</h3>
            </div>
            <span className="font-mono text-[10px] text-[#77736a]">{record.connections.length}</span>
          </div>
          <div className="mt-2">
            {record.connections.length > 0 ? (
              record.connections.slice(0, 40).map(({ edge, entity }) => (
                <button
                  key={edge.id}
                  type="button"
                  className={styles.connectionButton}
                  onClick={() => onSelectConnection(entity.id)}
                >
                  <span>
                    <span className="block text-sm text-[#f0ede4]">{entity.label}</span>
                    <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.14em] text-[#77736a]">
                      {humanize(edge.relation_type)} · {edge.direction}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className={styles.confidence} data-tier={edge.confidence_tier ?? "unresolved"}>
                      {edge.confidence != null ? `${Math.round(edge.confidence * 100)}%` : "Unrated"}
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

        <section className={styles.inspectorSection}>
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-[#62e3b0]" />
            <h3 className={styles.controlLabel}>Evidence trail</h3>
          </div>
          <div className="mt-2">
            {record.evidence.length > 0 ? (
              record.evidence.map((evidence) => (
                <article key={evidence.id} className={styles.evidenceCard}>
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
              ))
            ) : (
              <p className={styles.contextCopy}>No evidence rows are attached to the visible relationships. The confidence label remains explicit rather than implying certainty.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
