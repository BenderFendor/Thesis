import { ShieldCheck } from "lucide-react";
import { hasText } from "@/lib/utils";
import { dateLabel, humanize } from "./atlas-inspector-display";
import type {
  AtlasDossierSection,
  AtlasDossierStatement,
  AtlasEvidence,
} from "./atlas-inspector-types";
import styles from "./atlas.module.css";

const AtlasAnalysisSection = ({
  scores,
}: Readonly<{ scores: readonly (readonly [string, number])[] }>) => {
  if (scores.length === 0) {
    return null;
  }
  return (
    <section>
      <AnalysisHeader />
      <AnalysisGrid scores={scores} />
    </section>
  );
};

const AnalysisHeader = () => (
  <div className="flex items-center gap-2">
    <ShieldCheck className="h-4 w-4 text-[#d7b35f]" />
    <h3 className={styles.controlLabel}>Stored source analysis</h3>
  </div>
);

const AnalysisGrid = ({ scores }: Readonly<{ scores: readonly (readonly [string, number])[] }>) => (
  <div className={styles.detailGrid}>
    {scores.map(([axis, score]) => (
      <AnalysisCard key={axis} axis={axis} score={score} />
    ))}
  </div>
);

const AnalysisCard = ({ axis, score }: Readonly<{ axis: string; score: number }>) => (
  <div className={styles.detailCard}>
    <div className={styles.microLabel}>{humanize(axis)}</div>
    <div className={styles.detailValue}>{score} / 5</div>
  </div>
);

const AtlasStatementEvidence = ({ evidence }: Readonly<{ evidence: readonly AtlasEvidence[] }>) => {
  if (evidence.length === 0) {
    return null;
  }
  return (
    <details className="mt-3 text-xs text-[#c9c3b6]">
      <summary className="cursor-pointer text-[#d7b35f]">
        Open claim evidence ({evidence.length})
      </summary>
      <StatementEvidenceList evidence={evidence} />
    </details>
  );
};

const StatementEvidenceList = ({ evidence }: Readonly<{ evidence: readonly AtlasEvidence[] }>) => (
  <div className="mt-2 space-y-2">
    {evidence.map((item) => (
      <StatementEvidenceCard key={item.id} evidence={item} />
    ))}
  </div>
);

const StatementEvidenceCard = ({ evidence }: Readonly<{ evidence: AtlasEvidence }>) => (
  <div className="rounded border border-white/10 p-2">
    <div>{evidence.source_name ?? evidence.source_type}</div>
    <div>Captured: {dateLabel(evidence.retrieved_at)}</div>
    <EvidenceMetadata evidence={evidence} />
  </div>
);

const EvidenceMetadata = ({ evidence }: Readonly<{ evidence: AtlasEvidence }>) => (
  <>
    {hasText(evidence.snapshot_sha256) && (
      <div className="break-all">Snapshot: {evidence.snapshot_sha256}</div>
    )}
    {Object.keys(evidence.locator).length > 0 && (
      <div>Locator: {JSON.stringify(evidence.locator)}</div>
    )}
    {hasText(evidence.evidence_class) && <div>Evidence class: {evidence.evidence_class}</div>}
    {hasText(evidence.policy_version) && <div>Policy: {evidence.policy_version}</div>}
    {hasText(evidence.acceptance_decision) && <div>Decision: {evidence.acceptance_decision}</div>}
  </>
);

const AtlasDossierStatementView = ({
  statement,
}: Readonly<{ statement: AtlasDossierStatement }>) => (
  <div className={`${styles.detailCard} col-span-2`}>
    <StatementPrimary statement={statement} />
    <StatementMetadata statement={statement} />
    <AtlasStatementEvidence evidence={statement.evidence} />
  </div>
);

const StatementPrimary = ({ statement }: Readonly<{ statement: AtlasDossierStatement }>) => (
  <>
    <div className={styles.microLabel}>{statement.label}</div>
    <div className={styles.detailValue}>{statement.answer}</div>
  </>
);

const StatementMetadata = ({ statement }: Readonly<{ statement: AtlasDossierStatement }>) => (
  <div className="mt-2 flex flex-wrap gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[#77736a]">
    <span>{humanize(statement.state)}</span>
    {hasText(statement.lifecycle_state) && <span>{humanize(statement.lifecycle_state)}</span>}
    {hasText(statement.predicate) && <span>{statement.predicate}</span>}
  </div>
);

const AtlasDossierSectionView = ({ section }: Readonly<{ section: AtlasDossierSection }>) => (
  <section className={dossierSectionClassName(section.key)}>
    <DossierSectionHeader title={section.title} />
    <DossierStatementGrid section={section} />
  </section>
);

const dossierSectionClassName = (key: AtlasDossierSection["key"]): string | undefined => {
  if (key === "summary") {
    return styles.inspectorSection;
  }
  return undefined;
};

const DossierSectionHeader = ({ title }: Readonly<{ title: string }>) => (
  <div className="flex items-center gap-2">
    <ShieldCheck className="h-4 w-4 text-[#d7b35f]" />
    <h3 className={styles.controlLabel}>{title}</h3>
  </div>
);

const DossierStatementGrid = ({ section }: Readonly<{ section: AtlasDossierSection }>) => (
  <div className={styles.detailGrid}>
    {section.statements.map((statement) => (
      <AtlasDossierStatementView key={`${section.key}-${statement.label}`} statement={statement} />
    ))}
  </div>
);

const AtlasIdentitySection = ({
  details,
}: Readonly<{ details: readonly (readonly [string, string])[] }>) => (
  <section>
    <DossierSectionHeader title="Identity and context" />
    <IdentityDetailGrid details={details} />
  </section>
);

const IdentityDetailGrid = ({
  details,
}: Readonly<{ details: readonly (readonly [string, string])[] }>) => (
  <div className={styles.detailGrid}>
    {details.length > 0 &&
      details.map(([key, value]) => <IdentityDetailCard key={key} label={key} value={value} />)}
    {details.length === 0 && <IdentityEmptyCard />}
  </div>
);

const IdentityDetailCard = ({ label, value }: Readonly<{ label: string; value: string }>) => (
  <div className={styles.detailCard}>
    <div className={styles.microLabel}>{humanize(label)}</div>
    <div className={styles.detailValue}>{value}</div>
  </div>
);

const IdentityEmptyCard = () => (
  <div className={`${styles.detailCard} col-span-2`}>
    <div className={styles.detailValue}>
      No structured profile fields are indexed for this entity yet.
    </div>
  </div>
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

export { AtlasAnalysisSection, AtlasDossier };
