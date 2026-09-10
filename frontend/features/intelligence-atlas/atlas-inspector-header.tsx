import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { hasText } from "@/lib/utils";
import { dateLabel, humanize } from "./atlas-inspector-display";
import type { ReadonlyAtlasEntityRecord } from "./atlas-inspector-types";
import styles from "./atlas.module.css";

const AtlasInspectorHeader = ({ record }: Readonly<{ record: ReadonlyAtlasEntityRecord }>) => (
  <header className={styles.inspectorHeader}>
    <AtlasIdentityHeader record={record} />
    <AtlasVerificationSummary record={record} />
    <AtlasProfileLink profilePath={record.profile_path} />
  </header>
);

const AtlasIdentityHeader = ({ record }: Readonly<{ record: ReadonlyAtlasEntityRecord }>) => (
  <div className="flex items-start gap-3">
    <span className={styles.entityMark} data-type={record.entity_type} aria-hidden="true">
      {record.entity_type.slice(0, 2).toUpperCase()}
    </span>
    <AtlasIdentityCopy record={record} />
  </div>
);

const AtlasIdentityCopy = ({ record }: Readonly<{ record: ReadonlyAtlasEntityRecord }>) => (
  <div className="min-w-0 flex-1">
    <div className={styles.brandEyebrow}>{record.entity_type} record</div>
    <h2 className="mt-2 font-serif text-3xl leading-none text-[#f0ede4]">{record.label}</h2>
    <AtlasIdentityMeta record={record} />
  </div>
);

const AtlasIdentityMeta = ({ record }: Readonly<{ record: ReadonlyAtlasEntityRecord }>) => (
  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[#c9c3b6]">
    {hasText(record.subtitle) && <span>{record.subtitle}</span>}
    {hasText(record.country_code) && <span>{record.country_code}</span>}
    <span className={styles.confidence} data-tier={record.confidence_tier ?? "unresolved"}>
      {humanize(record.confidence_tier ?? "unresolved")}
    </span>
  </div>
);

const AtlasVerificationSummary = ({ record }: Readonly<{ record: ReadonlyAtlasEntityRecord }>) => (
  <div className="mt-4 grid grid-cols-2 gap-2">
    <AtlasVerificationCard label="Last verified" value={dateLabel(record.last_verified_at)} />
    <AtlasVerificationCard label="Evidence" value={`${record.evidence.length} cited records`} />
  </div>
);

const AtlasVerificationCard = ({ label, value }: Readonly<{ label: string; value: string }>) => (
  <div className={styles.detailCard}>
    <div className={styles.microLabel}>{label}</div>
    <div className={styles.detailValue}>{value}</div>
  </div>
);

const AtlasProfileLink = ({ profilePath }: Readonly<{ profilePath?: string | null }>) => {
  if (!hasText(profilePath)) {
    return null;
  }
  return (
    <Link
      href={profilePath}
      className="mt-4 inline-flex items-center gap-2 text-sm text-[#d7b35f] hover:text-[#f0ede4]"
    >
      Open full profile <ArrowUpRight className="h-4 w-4" />
    </Link>
  );
};

export { AtlasInspectorHeader };
