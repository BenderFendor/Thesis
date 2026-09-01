import type { AtlasGraphResponse, AtlasNode } from "./lib/atlas-schema"

import { resolveEntityCount, resolveRelationshipCount } from "./atlas-stage-metrics"
import styles from "./atlas.module.css"

type AtlasGraphStats = Readonly<Pick<
  AtlasGraphResponse["stats"],
  | "total_organizations"
  | "total_outlets"
  | "total_people"
  | "total_reporters"
  | "visible_organizations"
  | "visible_outlets"
  | "visible_people"
  | "visible_relationships"
  | "visible_reporters"
>>
type AtlasNodeSummary = Readonly<Pick<AtlasNode, "entity_type" | "label">>

interface MetricProps {
  readonly label: string
  readonly value: string | number
}

const AtlasContextPanel = ({
  selectedNode,
  currentStats,
  totalStats,
  ownershipCoverage,
}: Readonly<{
  readonly selectedNode: AtlasNodeSummary | null
  readonly currentStats?: Readonly<AtlasGraphStats>
  readonly totalStats?: Readonly<AtlasGraphStats>
  readonly ownershipCoverage: number
}>) => {
  const title = selectedNode?.label ?? "Follow publication, ownership, reporter, and evidence relationships."
  let copy = "Every visible relationship is typed. Inferred and evidence-backed links remain distinguishable, and bounded results declare truncation.",
   eyebrow = "Traceable media context"
  if (selectedNode !== null) {
    copy = "Direct connections remain visible while the inspector exposes confidence, provenance, verification dates, and unresolved claims."
    eyebrow = `${humanize(selectedNode.entity_type)} selected`
  }

  return (
    <section className={styles.contextPanel} aria-label="Atlas context and coverage">
      <div className={styles.brandEyebrow}>{eyebrow}</div>
      <h2 className={styles.contextTitle}>{title}</h2>
      <p className={styles.contextCopy}>{copy}</p>
      <div className={styles.metrics}>
        <Metric label="Outlets" value={resolveEntityCount(currentStats, "visible_outlets", totalStats, "total_outlets")} />
        <Metric label="Organizations" value={resolveEntityCount(currentStats, "visible_organizations", totalStats, "total_organizations")} />
        <Metric label="People" value={resolveEntityCount(currentStats, "visible_people", totalStats, "total_people")} />
        <Metric label="Reporters" value={resolveEntityCount(currentStats, "visible_reporters", totalStats, "total_reporters")} />
        <Metric label="Relationships" value={resolveRelationshipCount(currentStats)} />
        <Metric label="Ownership coverage" value={`${ownershipCoverage}%`} />
      </div>
    </section>
  )
},

 Metric = ({ label, value }: MetricProps) => (
  <div className={styles.metric}>
    <div className={styles.microLabel}>{label}</div>
    <div className={styles.metricValue}>{value.toLocaleString()}</div>
  </div>
),

 humanize = (value: Readonly<string>): string => (
  value.replaceAll("_", " ").replaceAll(/\b\w/gu, (letter) => letter.toUpperCase())
)

export { AtlasContextPanel }
