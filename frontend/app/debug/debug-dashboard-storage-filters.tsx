import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { inputValueChange } from "./debug-dashboard-utils";

interface StorageFilterCardsProps {
  readonly cacheSourceDraft: string;
  readonly setCacheSourceDraft: (value: string) => void;
  readonly onApplyCacheFilters: () => void;
  readonly dbSourceDraft: string;
  readonly setDbSourceDraft: (value: string) => void;
  readonly dbBeforeDraft: string;
  readonly setDbBeforeDraft: (value: string) => void;
  readonly dbAfterDraft: string;
  readonly setDbAfterDraft: (value: string) => void;
  readonly onApplyDbFilters: () => void;
}

type CacheFilterProps = Pick<
  StorageFilterCardsProps,
  "cacheSourceDraft" | "setCacheSourceDraft" | "onApplyCacheFilters"
>;

type DatabaseFilterProps = Pick<
  StorageFilterCardsProps,
  | "dbSourceDraft"
  | "setDbSourceDraft"
  | "dbBeforeDraft"
  | "setDbBeforeDraft"
  | "dbAfterDraft"
  | "setDbAfterDraft"
  | "onApplyDbFilters"
>;

const CacheFilterInputs = (props: DeepReadonly<CacheFilterProps>) => {
  const handleApplyFilters = props.onApplyCacheFilters;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder="Source (e.g. bbc)"
        className="w-40"
        value={props.cacheSourceDraft}
        onChange={inputValueChange(props.setCacheSourceDraft)}
      />
      <Button variant="secondary" onClick={handleApplyFilters}>
        Apply filters
      </Button>
    </div>
  );
};

const DatabaseFilterInputs = (props: DeepReadonly<DatabaseFilterProps>) => {
  const handleApplyFilters = props.onApplyDbFilters;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder="Source (e.g. bbc)"
        className="w-40"
        value={props.dbSourceDraft}
        onChange={inputValueChange(props.setDbSourceDraft)}
      />
      <Input
        type="datetime-local"
        className="w-56"
        value={props.dbAfterDraft}
        onChange={inputValueChange(props.setDbAfterDraft)}
        placeholder="Published after"
      />
      <Input
        type="datetime-local"
        className="w-56"
        value={props.dbBeforeDraft}
        onChange={inputValueChange(props.setDbBeforeDraft)}
        placeholder="Published before"
      />
      <Button variant="secondary" onClick={handleApplyFilters}>
        Apply filters
      </Button>
    </div>
  );
};

const CacheFilterCard = (props: DeepReadonly<CacheFilterProps>) => (
  <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
    <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <CardTitle className="font-serif">Cache filters</CardTitle>
      <CacheFilterInputs
        cacheSourceDraft={props.cacheSourceDraft}
        setCacheSourceDraft={props.setCacheSourceDraft}
        onApplyCacheFilters={props.onApplyCacheFilters}
      />
    </CardHeader>
  </Card>
);

const DatabaseFilterCard = (props: DeepReadonly<DatabaseFilterProps>) => (
  <Card className="bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
    <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <CardTitle className="font-serif">Database filters</CardTitle>
      <DatabaseFilterInputs
        dbSourceDraft={props.dbSourceDraft}
        setDbSourceDraft={props.setDbSourceDraft}
        dbBeforeDraft={props.dbBeforeDraft}
        setDbBeforeDraft={props.setDbBeforeDraft}
        dbAfterDraft={props.dbAfterDraft}
        setDbAfterDraft={props.setDbAfterDraft}
        onApplyDbFilters={props.onApplyDbFilters}
      />
    </CardHeader>
  </Card>
);

const StorageFilterCards = (props: DeepReadonly<StorageFilterCardsProps>) => (
  <>
    <CacheFilterCard
      cacheSourceDraft={props.cacheSourceDraft}
      setCacheSourceDraft={props.setCacheSourceDraft}
      onApplyCacheFilters={props.onApplyCacheFilters}
    />
    <DatabaseFilterCard
      dbSourceDraft={props.dbSourceDraft}
      setDbSourceDraft={props.setDbSourceDraft}
      dbBeforeDraft={props.dbBeforeDraft}
      setDbBeforeDraft={props.setDbBeforeDraft}
      dbAfterDraft={props.dbAfterDraft}
      setDbAfterDraft={props.setDbAfterDraft}
      onApplyDbFilters={props.onApplyDbFilters}
    />
  </>
);

export { StorageFilterCards };
export type { StorageFilterCardsProps };
