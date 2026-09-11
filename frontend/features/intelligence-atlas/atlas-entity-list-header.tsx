"use client";

import { ArrowDownAZ, Search } from "lucide-react";
import type { ChangeEventHandler } from "react";
import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import styles from "./atlas.module.css";
import { TYPE_TABS } from "./atlas-entity-list-state";
import type { EntityTypeTab } from "./atlas-entity-list-state";

type AtlasEntityListVariant = "page" | "modal";

type FilterPatch = Readonly<{
  bias?: readonly string[];
  country?: readonly string[];
  funding?: readonly string[];
}>;

interface DirectoryHeaderProps {
  readonly variant: AtlasEntityListVariant;
  readonly total: number;
  readonly query: string;
  readonly sort: string;
  readonly type: EntityTypeTab;
  readonly kind: readonly string[];
  readonly kindOptions: readonly string[];
  readonly country: readonly string[];
  readonly funding: readonly string[];
  readonly bias: readonly string[];
  readonly countryOptions: readonly string[];
  readonly fundingOptions: readonly string[];
  readonly biasOptions: readonly string[];
  readonly onQueryChange: (value: string) => void;
  readonly onSortChange: (value: string) => void;
  readonly onTypeChange: (value: EntityTypeTab) => void;
  readonly onKindChange: (value: string) => void;
  readonly onClearKinds: () => void;
  readonly onFiltersChange: (filters: FilterPatch) => void;
}

type TypeTab = (typeof TYPE_TABS)[number];

const getDirectoryPaddingClass = (variant: AtlasEntityListVariant): string => {
  if (variant === "page") {
    return "border-b border-white/10 p-5 pr-5";
  }
  return "border-b border-white/10 p-5 pr-14";
};

const humanizeKind = (value: string): string =>
  value.replaceAll("_", " ").replaceAll(/\b\w/gu, (letter) => letter.toUpperCase());

const singleFilterValue = (values: readonly string[]): string => values[0] ?? "all";

const toSingleFilter = (value: string): string[] => {
  if (value === "all") {
    return [];
  }
  return [value];
};

const DirectoryIntro = ({
  variant,
  total,
}: Readonly<{ variant: AtlasEntityListVariant; total: number }>) => {
  if (variant === "page") {
    return (
      <div>
        <h1 className="font-serif text-3xl font-normal text-[#f0ede4]">Entity directory</h1>
        <p className="mt-1 text-[#77736a]">
          {total.toLocaleString()} matching records. Search outlets, organizations, people, and
          reporters.
        </p>
      </div>
    );
  }

  return (
    <p className="text-[#77736a]">
      {total.toLocaleString()} matching records. Results are server-filtered and rendered
      virtually.
    </p>
  );
};

interface SearchInputProps {
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
}

const SearchInput = ({ query, onQueryChange }: SearchInputProps) => {
  const handleChange: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => {
      onQueryChange(event.currentTarget.value);
    },
    [onQueryChange],
  );
  return (
    <div className="relative min-w-[230px] flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#77736a]" />
      <Input
        value={query}
        onChange={handleChange}
        placeholder="Search the entity index"
        aria-label="Search the entity index"
        className="border-white/10 bg-black/20 pl-9"
      />
    </div>
  );
};

const SORT_OPTIONS = [
  { label: "Most connected", value: "most_connected" },
  { label: "Most articles", value: "most_articles" },
  { label: "Recently indexed", value: "recently_indexed" },
  { label: "Lowest confidence", value: "lowest_confidence" },
  { label: "Name", value: "name" },
] as const;

const SortOptions = () => (
  <>
    {SORT_OPTIONS.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </>
);

interface SortSelectProps {
  readonly sort: string;
  readonly onSortChange: (value: string) => void;
}

const SortSelect = ({ sort, onSortChange }: SortSelectProps) => {
  const handleChange: ChangeEventHandler<HTMLSelectElement> = useCallback(
    (event) => {
      onSortChange(event.currentTarget.value);
    },
    [onSortChange],
  );
  return (
    <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3">
      <ArrowDownAZ className="h-4 w-4 text-[#77736a]" />
      <select
        value={sort}
        onChange={handleChange}
        className="h-10 bg-transparent text-sm text-[#c9c3b6] outline-none"
        aria-label="Sort entity index"
      >
        <SortOptions />
      </select>
    </label>
  );
};

interface FacetSelectProps {
  readonly label: string;
  readonly value: string;
  readonly values: readonly string[];
  readonly onChange: (value: string) => void;
}

const FacetSelect = ({ label, value, values, onChange }: FacetSelectProps) => {
  const handleChange: ChangeEventHandler<HTMLSelectElement> = useCallback(
    (event) => {
      onChange(event.currentTarget.value);
    },
    [onChange],
  );
  return (
    <label className="rounded-xl border border-white/10 bg-black/20 px-3">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={handleChange}
        className="h-10 max-w-36 bg-transparent text-sm text-[#c9c3b6] outline-none"
        aria-label={`Filter by ${label.toLowerCase()}`}
      >
        <option value="all">All {label.toLowerCase()}</option>
        {values.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
};

type FacetFiltersProps = Pick<
  DirectoryHeaderProps,
  | "country"
  | "funding"
  | "bias"
  | "countryOptions"
  | "fundingOptions"
  | "biasOptions"
  | "onFiltersChange"
>;

const FacetFilters = ({
  country,
  funding,
  bias,
  countryOptions,
  fundingOptions,
  biasOptions,
  onFiltersChange,
}: FacetFiltersProps) => {
  const handleCountryChange = useCallback(
    (value: string) => {
      onFiltersChange({ country: toSingleFilter(value) });
    },
    [onFiltersChange],
  );
  const handleFundingChange = useCallback(
    (value: string) => {
      onFiltersChange({ funding: toSingleFilter(value) });
    },
    [onFiltersChange],
  );
  const handleBiasChange = useCallback(
    (value: string) => {
      onFiltersChange({ bias: toSingleFilter(value) });
    },
    [onFiltersChange],
  );
  return (
    <>
      <FacetSelect
        label="Country"
        value={singleFilterValue(country)}
        values={countryOptions}
        onChange={handleCountryChange}
      />
      <FacetSelect
        label="Funding"
        value={singleFilterValue(funding)}
        values={fundingOptions}
        onChange={handleFundingChange}
      />
      <FacetSelect
        label="Bias"
        value={singleFilterValue(bias)}
        values={biasOptions}
        onChange={handleBiasChange}
      />
    </>
  );
};

type SearchAndFacetsProps = Pick<
  DirectoryHeaderProps,
  | "query"
  | "sort"
  | "country"
  | "funding"
  | "bias"
  | "countryOptions"
  | "fundingOptions"
  | "biasOptions"
  | "onQueryChange"
  | "onSortChange"
  | "onFiltersChange"
>;

const SearchAndFacets = ({
  query,
  sort,
  country,
  funding,
  bias,
  countryOptions,
  fundingOptions,
  biasOptions,
  onQueryChange,
  onSortChange,
  onFiltersChange,
}: SearchAndFacetsProps) => (
  <div className="flex flex-wrap items-center gap-2">
    <SearchInput query={query} onQueryChange={onQueryChange} />
    <SortSelect sort={sort} onSortChange={onSortChange} />
    <FacetFilters
      country={country}
      funding={funding}
      bias={bias}
      countryOptions={countryOptions}
      fundingOptions={fundingOptions}
      biasOptions={biasOptions}
      onFiltersChange={onFiltersChange}
    />
  </div>
);

const TypeTabButton = ({
  active,
  tab,
  onChange,
}: Readonly<{
  active: boolean;
  tab: TypeTab;
  onChange: (value: EntityTypeTab) => void;
}>) => {
  const handleClick = useCallback(() => {
    onChange(tab.key);
  }, [onChange, tab.key]);
  return (
    <button
      type="button"
      className={styles.pillButton}
      data-active={active}
      onClick={handleClick}
    >
      {tab.label}
    </button>
  );
};

const TypeTabs = ({
  type,
  onTypeChange,
}: Readonly<{ type: EntityTypeTab; onTypeChange: (value: EntityTypeTab) => void }>) => (
  <div className="mt-4 flex gap-2 overflow-x-auto">
    {TYPE_TABS.map((tab) => (
      <TypeTabButton key={tab.key} active={type === tab.key} tab={tab} onChange={onTypeChange} />
    ))}
  </div>
);

const KindOptionButton = ({
  active,
  option,
  onChange,
}: Readonly<{
  active: boolean;
  option: string;
  onChange: (value: string) => void;
}>) => {
  const handleClick = useCallback(() => {
    onChange(option);
  }, [onChange, option]);
  return (
    <button
      type="button"
      className={styles.pillButton}
      data-active={active}
      onClick={handleClick}
    >
      {humanizeKind(option)}
    </button>
  );
};

const KindFilters = ({
  kind,
  options,
  onClear,
  onChange,
}: Readonly<{
  kind: readonly string[];
  options: readonly string[];
  onClear: () => void;
  onChange: (value: string) => void;
}>) => {
  if (options.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2 overflow-x-auto" aria-label="Filter by entity kind">
      <button
        type="button"
        className={styles.pillButton}
        data-active={kind.length === 0}
        onClick={onClear}
      >
        All kinds
      </button>
      {options.map((option) => (
        <KindOptionButton
          key={option}
          active={kind.includes(option)}
          option={option}
          onChange={onChange}
        />
      ))}
    </div>
  );
};

const DirectoryHeader = (props: DirectoryHeaderProps) => {
  const { variant, total, type, kind, kindOptions, onTypeChange, onKindChange, onClearKinds } = props;
  return (
    <div className={getDirectoryPaddingClass(variant)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <DirectoryIntro variant={variant} total={total} />
        <SearchAndFacets
          query={props.query}
          sort={props.sort}
          country={props.country}
          funding={props.funding}
          bias={props.bias}
          countryOptions={props.countryOptions}
          fundingOptions={props.fundingOptions}
          biasOptions={props.biasOptions}
          onQueryChange={props.onQueryChange}
          onSortChange={props.onSortChange}
          onFiltersChange={props.onFiltersChange}
        />
      </div>
      <TypeTabs type={type} onTypeChange={onTypeChange} />
      <KindFilters
        kind={kind}
        options={kindOptions}
        onClear={onClearKinds}
        onChange={onKindChange}
      />
    </div>
  );
};

export { DirectoryHeader };
export type { AtlasEntityListVariant, FilterPatch };
