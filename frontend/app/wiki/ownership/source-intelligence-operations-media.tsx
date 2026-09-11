import type { WikiSourceProfile } from "@/lib/api";
import { hasText } from "@/lib/utils";
import { DataRow, PanelTitle, SURFACE_CLASS } from "./source-intelligence-operations-common";
import { displaySourceValue } from "./source-intelligence-operations-helpers";
import type { DeepReadonly } from "@/lib/deep-readonly";

const MediaTab = ({
  selectedSourceProfile,
  selectedSourceName,
  indexingSource,
  onIndex,
}: Readonly<{
  selectedSourceProfile: DeepReadonly<WikiSourceProfile> | null;
  selectedSourceName: string | null;
  indexingSource: boolean;
  onIndex: () => void;
}>) => (
  <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
    <MediaSummaryColumn
      profile={selectedSourceProfile}
      selectedSourceName={selectedSourceName}
      indexingSource={indexingSource}
      onIndex={onIndex}
    />
    <MediaFactsColumn profile={selectedSourceProfile} />
  </div>
);

const MediaSummaryColumn = ({
  profile,
  selectedSourceName,
  indexingSource,
  onIndex,
}: Readonly<{
  profile: DeepReadonly<WikiSourceProfile> | null;
  selectedSourceName: string | null;
  indexingSource: boolean;
  onIndex: () => void;
}>) => (
  <div className="space-y-4">
    <SourceSummaryCard
      profile={profile}
      selectedSourceName={selectedSourceName}
      indexingSource={indexingSource}
      onIndex={onIndex}
    />
    <DossierSectionsCard profile={profile} />
  </div>
);

const SourceSummaryCard = ({
  profile,
  selectedSourceName,
  indexingSource,
  onIndex,
}: Readonly<{
  profile: DeepReadonly<WikiSourceProfile> | null;
  selectedSourceName: string | null;
  indexingSource: boolean;
  onIndex: () => void;
}>) => (
  <div className={SURFACE_CLASS}>
    <MediaCardHeader
      selectedSourceName={selectedSourceName}
      indexingSource={indexingSource}
      onIndex={onIndex}
    />
    <p className="text-sm leading-7 text-foreground/90">
      {profile?.overview ?? "No summary has been written for this source yet."}
    </p>
  </div>
);

const MediaCardHeader = ({
  selectedSourceName,
  indexingSource,
  onIndex,
}: Readonly<{
  selectedSourceName: string | null;
  indexingSource: boolean;
  onIndex: () => void;
}>) => (
  <div className="mb-3 flex items-center justify-between gap-3">
    <PanelTitle>Source Summary</PanelTitle>
    <button
      onClick={onIndex}
      disabled={!hasText(selectedSourceName) || indexingSource}
      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-white/5 disabled:opacity-50"
    >
      {indexButtonLabel(indexingSource)}
    </button>
  </div>
);

const indexButtonLabel = (indexingSource: boolean): string => {
  if (indexingSource) {
    return "Indexing...";
  }
  return "Index source";
};

const DossierSectionsCard = ({
  profile,
}: Readonly<{ profile: DeepReadonly<WikiSourceProfile> | null }>) => (
  <div className={SURFACE_CLASS}>
    <PanelTitle>Dossier Sections</PanelTitle>
    <DossierSectionList profile={profile} />
  </div>
);

const DossierSectionList = ({
  profile,
}: Readonly<{ profile: DeepReadonly<WikiSourceProfile> | null }>) => (
  <div className="space-y-2">
    {(profile?.dossier_sections ?? []).slice(0, 5).map((section) => (
      <DossierSectionRow
        key={section.id}
        title={section.title}
        status={section.status}
        itemCount={section.items.length}
      />
    ))}
  </div>
);

const DossierSectionRow = ({
  title,
  status,
  itemCount,
}: Readonly<{ title: string; status: string; itemCount: number }>) => (
  <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
    <div className="text-sm text-foreground">{title}</div>
    <div className="text-xs text-muted-foreground">{dossierStatusLabel(status, itemCount)}</div>
  </div>
);

const dossierStatusLabel = (status: string, itemCount: number): string => {
  if (status === "available") {
    return `${itemCount} saved items`;
  }
  return "No saved items yet";
};

const MediaFactsColumn = ({
  profile,
}: Readonly<{ profile: DeepReadonly<WikiSourceProfile> | null }>) => (
  <div className="space-y-4">
    <OwnershipChainCard profile={profile} />
    <QuickFactsCard profile={profile} />
  </div>
);

const OwnershipChainCard = ({
  profile,
}: Readonly<{ profile: DeepReadonly<WikiSourceProfile> | null }>) => (
  <div className={SURFACE_CLASS}>
    <PanelTitle>Ownership Chain</PanelTitle>
    <OwnershipChainList profile={profile} />
  </div>
);

const OwnershipChainList = ({
  profile,
}: Readonly<{ profile: DeepReadonly<WikiSourceProfile> | null }>) => {
  const chain = profile?.ownership_chain ?? [];
  return (
    <div className="space-y-2">
      {chain.map((organization) => (
        <div
          key={organization.name}
          className="rounded-xl border border-white/10 px-3 py-2 text-sm text-foreground"
        >
          {organization.name}
        </div>
      ))}
      {chain.length === 0 && (
        <div className="text-sm text-muted-foreground">No ownership chain recorded yet.</div>
      )}
    </div>
  );
};

const QuickFactsCard = ({
  profile,
}: Readonly<{ profile: DeepReadonly<WikiSourceProfile> | null }>) => (
  <div className={SURFACE_CLASS}>
    <PanelTitle>Quick Facts</PanelTitle>
    <QuickFactsRows profile={profile} />
  </div>
);

const QuickFactsRows = ({
  profile,
}: Readonly<{ profile: DeepReadonly<WikiSourceProfile> | null }>) => (
  <div className="space-y-2 text-sm text-muted-foreground">
    <DataRow label="Country" value={displaySourceValue(profile?.country)} />
    <DataRow label="Funding" value={displaySourceValue(profile?.funding_type)} />
    <DataRow label="Bias" value={displaySourceValue(profile?.bias_rating)} />
    <DataRow label="Parent company" value={displaySourceValue(profile?.parent_company)} />
    <DataRow label="Articles" value={displaySourceValue(profile?.article_count)} />
    <DataRow label="Last indexed" value={displaySourceValue(profile?.last_indexed_at)} />
  </div>
);

export { MediaTab };
