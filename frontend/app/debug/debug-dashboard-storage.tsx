import { TabsContent } from "@/components/ui/tabs";
import type { DeepReadonly } from "@/lib/deep-readonly";
import {
  CacheDeltaCard,
  CacheSnapshotCard,
  CachedArticlesCard,
  ChromaDocumentsCard,
  ChromaSnapshotCard,
} from "./debug-dashboard-cards";
import { DatabaseSnapshotCard } from "./debug-dashboard-control-cards";
import { StartupTimelineCard } from "./debug-dashboard-system";
import { StorageFilterCards } from "./debug-dashboard-storage-filters";
import {
  DriftSamplesCard,
  PostgresArticlesCard,
  StorageDriftCard,
} from "./debug-dashboard-storage-samples";
import type {
  StorageSectionProps,
  StorageSnapshotSectionProps,
} from "./debug-dashboard-types";

const StorageSnapshotSection = (
  props: DeepReadonly<{ snapshot: StorageSnapshotSectionProps }>,
) => {
  const snapshot = props.snapshot;
  return (
  <div className="grid gap-4 md:grid-cols-4">
    <CacheSnapshotCard
      cacheData={snapshot.cacheData}
      cacheLimit={snapshot.cacheLimit}
      setCacheLimit={snapshot.setCacheLimit}
      cacheOffset={snapshot.cacheOffset}
      setCacheOffset={snapshot.setCacheOffset}
    />
    <ChromaSnapshotCard
      chromaData={snapshot.chromaData}
      chromaLimit={snapshot.chromaLimit}
      setChromaLimit={snapshot.setChromaLimit}
      chromaOffset={snapshot.chromaOffset}
      setChromaOffset={snapshot.setChromaOffset}
    />
    <DatabaseSnapshotCard
      dbData={snapshot.dbData}
      dbLimit={snapshot.dbLimit}
      setDbLimit={snapshot.setDbLimit}
      dbOffset={snapshot.dbOffset}
      setDbOffset={snapshot.setDbOffset}
      dbSortDirection={snapshot.dbSortDirection}
      setDbSortDirection={snapshot.setDbSortDirection}
      dbMissingOnly={snapshot.dbMissingOnly}
      setDbMissingOnly={snapshot.setDbMissingOnly}
    />
    <StorageDriftCard driftStats={snapshot.driftStats} />
  </div>
  );
};

const createStorageSnapshotProps = (
  props: DeepReadonly<StorageSectionProps>,
): StorageSnapshotSectionProps => ({
  cacheData: props.cacheData,
  cacheLimit: props.cacheLimit,
  cacheOffset: props.cacheOffset,
  chromaData: props.chromaData,
  chromaLimit: props.chromaLimit,
  chromaOffset: props.chromaOffset,
  dbData: props.dbData,
  dbLimit: props.dbLimit,
  dbMissingOnly: props.dbMissingOnly,
  dbOffset: props.dbOffset,
  dbSortDirection: props.dbSortDirection,
  driftStats: props.driftData,
  setCacheLimit: props.setCacheLimit,
  setCacheOffset: props.setCacheOffset,
  setChromaLimit: props.setChromaLimit,
  setChromaOffset: props.setChromaOffset,
  setDbLimit: props.setDbLimit,
  setDbMissingOnly: props.setDbMissingOnly,
  setDbOffset: props.setDbOffset,
  setDbSortDirection: props.setDbSortDirection,
});

const StorageFilterSection = (
  props: DeepReadonly<{ storage: StorageSectionProps }>,
) => {
  const storage = props.storage;
  const handleApplyCacheFilters = storage.onApplyCacheFilters;
  const handleApplyDbFilters = storage.onApplyDbFilters;
  return (
    <StorageFilterCards
      cacheSourceDraft={storage.cacheSourceDraft}
      setCacheSourceDraft={storage.setCacheSourceDraft}
      onApplyCacheFilters={handleApplyCacheFilters}
      dbSourceDraft={storage.dbSourceDraft}
      setDbSourceDraft={storage.setDbSourceDraft}
      dbBeforeDraft={storage.dbBeforeDraft}
      setDbBeforeDraft={storage.setDbBeforeDraft}
      dbAfterDraft={storage.dbAfterDraft}
      setDbAfterDraft={storage.setDbAfterDraft}
      onApplyDbFilters={handleApplyDbFilters}
    />
  );
};

const StorageSection = (props: DeepReadonly<StorageSectionProps>) => {
  const snapshot = createStorageSnapshotProps(props);
  return (
    <TabsContent value="storage" className="space-y-4">
      <StorageSnapshotSection snapshot={snapshot} />
      <StorageFilterSection storage={props} />
      <CacheDeltaCard cacheDelta={props.cacheDelta} />
      <StartupTimelineCard
        startupMetrics={props.startupMetrics}
        startupEvents={props.startupEvents}
      />
      <ChromaDocumentsCard chromaData={props.chromaData} />
      <CachedArticlesCard cacheData={props.cacheData} />
      <PostgresArticlesCard dbData={props.dbData} />
      <DriftSamplesCard driftData={props.driftData} />
    </TabsContent>
  );
};

export { StorageSection };
