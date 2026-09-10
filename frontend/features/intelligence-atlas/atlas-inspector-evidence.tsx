import { Clock3, ExternalLink } from "lucide-react";
import { hasText } from "@/lib/utils";
import { dateLabel, humanize } from "./atlas-inspector-display";
import type { AtlasEvidence } from "./atlas-inspector-types";
import styles from "./atlas.module.css";

const AtlasEvidenceTrail = ({ evidence }: Readonly<{ evidence: readonly AtlasEvidence[] }>) => (
  <section className={styles.inspectorSection}>
    <EvidenceTrailHeader />
    <EvidenceTrailList evidence={evidence} />
  </section>
);

const EvidenceTrailHeader = () => (
  <div className="flex items-center gap-2">
    <Clock3 className="h-4 w-4 text-[#62e3b0]" />
    <h3 className={styles.controlLabel}>Evidence trail</h3>
  </div>
);

const EvidenceTrailList = ({ evidence }: Readonly<{ evidence: readonly AtlasEvidence[] }>) => {
  if (evidence.length === 0) {
    return (
      <p className={`${styles.contextCopy} mt-2`}>
        No evidence rows are attached to the visible relationships. The confidence label remains
        explicit rather than implying certainty.
      </p>
    );
  }
  return (
    <div className="mt-2">
      {evidence.map((item) => (
        <AtlasEvidenceCard key={item.id} evidence={item} />
      ))}
    </div>
  );
};

const AtlasEvidenceCard = ({ evidence }: Readonly<{ evidence: AtlasEvidence }>) => (
  <article className={styles.evidenceCard}>
    <EvidenceSummary evidence={evidence} />
    <EvidenceLink evidence={evidence} />
  </article>
);

const EvidenceSummary = ({ evidence }: Readonly<{ evidence: AtlasEvidence }>) => (
  <div>
    <div className="text-sm text-[#f0ede4]">
      {evidence.source_name ?? humanize(evidence.source_type)}
    </div>
    <EvidenceExcerpt excerpt={evidence.excerpt} />
    <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.13em] text-[#77736a]">
      Retrieved {dateLabel(evidence.retrieved_at)}
    </div>
  </div>
);

const EvidenceExcerpt = ({ excerpt }: Readonly<{ excerpt?: string | null }>) => {
  if (!hasText(excerpt)) {
    return null;
  }
  return <p className="mt-1 text-xs leading-relaxed text-[#c9c3b6]">{excerpt}</p>;
};

const EvidenceLink = ({ evidence }: Readonly<{ evidence: AtlasEvidence }>) => {
  if (!hasText(evidence.source_url)) {
    return null;
  }
  return (
    <a
      href={evidence.source_url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open evidence from ${evidence.source_name ?? evidence.source_type}`}
      className="text-[#d7b35f] hover:text-[#f0ede4]"
    >
      <ExternalLink className="h-4 w-4" />
    </a>
  );
};

export { AtlasEvidenceTrail };
