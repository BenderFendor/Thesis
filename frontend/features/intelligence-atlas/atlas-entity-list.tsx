"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ArrowDownAZ, Loader2, Search } from "lucide-react"

import { Input } from "@/components/ui/input"

import { fetchAtlasIndex } from "./lib/atlas-api"
import type { AtlasEntityType, AtlasNode } from "./lib/atlas-schema"
import styles from "./atlas.module.css"

type EntityTypeTab = "all" | AtlasEntityType
type AtlasEntityListVariant = "page" | "modal"

type FilterPatch = Readonly<{
  bias?: string[]
  country?: string[]
  funding?: string[]
}>

interface AtlasEntityListProps {
  readonly entityTypes: readonly AtlasEntityType[]
  readonly country: readonly string[]
  readonly funding: readonly string[]
  readonly bias: readonly string[]
  readonly onFiltersChange: (filters: FilterPatch) => void
  readonly onSelect: (node: AtlasNode) => void
  /** "page" fills its container; "modal" keeps the bounded height used inside a dialog. */
  readonly variant?: AtlasEntityListVariant
  readonly active?: boolean
}

interface TypeTab {
  readonly key: EntityTypeTab
  readonly label: string
  readonly types: readonly AtlasEntityType[]
}

const INITIAL_CURSOR: string | null = null
const PAGE_SIZE = 80
const ROW_ESTIMATE = 66
const LOAD_AHEAD_ROWS = 8
const VIRTUAL_OVERSCAN = 8

const TYPE_TABS: readonly TypeTab[] = [
  { key: "all", label: "All", types: [] },
  { key: "outlet", label: "Outlets", types: ["outlet"] },
  { key: "organization", label: "Organizations", types: ["organization"] },
  { key: "person", label: "People", types: ["person", "reporter"] },
  { key: "reporter", label: "Reporters", types: ["reporter"] },
]

const humanizeKind = (value: string): string => (
  value.replaceAll("_", " ").replaceAll(/\b\w/gu, (letter) => letter.toUpperCase())
)

const effectiveEntityTypes = (
  type: EntityTypeTab,
  entityTypes: readonly AtlasEntityType[],
): readonly AtlasEntityType[] => {
  if (type === "all") return entityTypes
  return TYPE_TABS.find((tab) => tab.key === type)?.types ?? []
}

const toggleString = (values: readonly string[], value: string): string[] => (
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
)

const singleFilterValue = (values: readonly string[]): string => values[0] ?? "all"

const toSingleFilter = (value: string): string[] => (value === "all" ? [] : [value])

const isResearchedNode = (node: AtlasNode): boolean => (
  node.current_parent !== null && node.current_parent !== undefined
  || node.connection_count > 0
  || node.evidence_coverage !== "not researched"
  || Object.keys(node.analysis_scores).length > 0
)

const analysisSummary = (node: AtlasNode): string => {
  const count = Object.keys(node.analysis_scores).length
  return count > 0 ? ` · ${count} analysis scores` : ""
}

const ownershipSummary = (node: AtlasNode): string => (
  node.current_parent !== null && node.current_parent !== undefined
    ? `Owned by ${node.current_parent}`
    : node.evidence_coverage
)

const pendingSummary = (node: AtlasNode): string => (
  node.pending_change === null || node.pending_change === undefined || node.pending_change.length === 0
    ? ""
    : ` · ${node.pending_change}`
)

const connectionSummary = (count: number): string => (count > 0 ? `${count} links` : "—")

interface DirectoryHeaderProps {
  readonly variant: AtlasEntityListVariant
  readonly total: number
  readonly query: string
  readonly sort: string
  readonly type: EntityTypeTab
  readonly kind: readonly string[]
  readonly kindOptions: readonly string[]
  readonly country: readonly string[]
  readonly funding: readonly string[]
  readonly bias: readonly string[]
  readonly countryOptions: readonly string[]
  readonly fundingOptions: readonly string[]
  readonly biasOptions: readonly string[]
  readonly onQueryChange: (value: string) => void
  readonly onSortChange: (value: string) => void
  readonly onTypeChange: (value: EntityTypeTab) => void
  readonly onKindChange: (value: string) => void
  readonly onClearKinds: () => void
  readonly onFiltersChange: (filters: FilterPatch) => void
}

const DirectoryIntro = ({ variant, total }: Readonly<{ variant: AtlasEntityListVariant; total: number }>) => {
  if (variant === "page") {
    return (
      <div>
        <h1 className="font-serif text-3xl font-normal text-[#f0ede4]">Entity directory</h1>
        <p className="mt-1 text-[#77736a]">
          {total.toLocaleString()} matching records. Search outlets, organizations, people, and reporters.
        </p>
      </div>
    )
  }

  return (
    <p className="text-[#77736a]">
      {total.toLocaleString()} matching records. Results are server-filtered and rendered virtually.
    </p>
  )
}

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
}: Pick<
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
>) => (
  <div className="flex flex-wrap items-center gap-2">
    <div className="relative min-w-[230px] flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#77736a]" />
      <Input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search the entity index"
        aria-label="Search the entity index"
        className="border-white/10 bg-black/20 pl-9"
      />
    </div>
    <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3">
      <ArrowDownAZ className="h-4 w-4 text-[#77736a]" />
      <select
        value={sort}
        onChange={(event) => onSortChange(event.target.value)}
        className="h-10 bg-transparent text-sm text-[#c9c3b6] outline-none"
        aria-label="Sort entity index"
      >
        <option value="most_connected">Most connected</option>
        <option value="most_articles">Most articles</option>
        <option value="recently_indexed">Recently indexed</option>
        <option value="lowest_confidence">Lowest confidence</option>
        <option value="name">Name</option>
      </select>
    </label>
    <FacetSelect
      label="Country"
      value={singleFilterValue(country)}
      values={countryOptions}
      onChange={(value) => onFiltersChange({ country: toSingleFilter(value) })}
    />
    <FacetSelect
      label="Funding"
      value={singleFilterValue(funding)}
      values={fundingOptions}
      onChange={(value) => onFiltersChange({ funding: toSingleFilter(value) })}
    />
    <FacetSelect
      label="Bias"
      value={singleFilterValue(bias)}
      values={biasOptions}
      onChange={(value) => onFiltersChange({ bias: toSingleFilter(value) })}
    />
  </div>
)

const TypeTabs = ({
  type,
  onTypeChange,
}: Readonly<{ type: EntityTypeTab; onTypeChange: (value: EntityTypeTab) => void }>) => (
  <div className="mt-4 flex gap-2 overflow-x-auto">
    {TYPE_TABS.map((tab) => (
      <button
        key={tab.key}
        type="button"
        className={styles.pillButton}
        data-active={type === tab.key}
        onClick={() => onTypeChange(tab.key)}
      >
        {tab.label}
      </button>
    ))}
  </div>
)

const KindFilters = ({
  kind,
  options,
  onClear,
  onChange,
}: Readonly<{
  kind: readonly string[]
  options: readonly string[]
  onClear: () => void
  onChange: (value: string) => void
}>) => {
  if (options.length === 0) return undefined

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
        <button
          key={option}
          type="button"
          className={styles.pillButton}
          data-active={kind.includes(option)}
          onClick={() => onChange(option)}
        >
          {humanizeKind(option)}
        </button>
      ))}
    </div>
  )
}

const DirectoryHeader = (props: DirectoryHeaderProps) => {
  const {
    variant,
    total,
    type,
    kind,
    kindOptions,
    onTypeChange,
    onKindChange,
    onClearKinds,
  } = props
  const paddingClass = variant === "page" ? "border-b border-white/10 p-5 pr-5" : "border-b border-white/10 p-5 pr-14"

  return (
    <div className={paddingClass}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <DirectoryIntro variant={variant} total={total} />
        <SearchAndFacets {...props} />
      </div>
      <TypeTabs type={type} onTypeChange={onTypeChange} />
      <KindFilters kind={kind} options={kindOptions} onClear={onClearKinds} onChange={onKindChange} />
    </div>
  )
}

const IndexHeaderRow = () => (
  <div className={styles.indexHeaderRow} aria-hidden="true">
    <span />
    <span>Name</span>
    <span>Country</span>
    <span>Funding</span>
    <span>Links</span>
    <span>Confidence</span>
  </div>
)

interface EntityRowProps {
  readonly node: AtlasNode
  readonly height: number
  readonly start: number
  readonly onSelect: (node: AtlasNode) => void
}

const EntityRow = ({ node, height, start, onSelect }: EntityRowProps) => {
  const researched = isResearchedNode(node)

  return (
    <button
      type="button"
      className={styles.indexCard}
      style={{ height, transform: `translateY(${start}px)` }}
      onClick={() => onSelect(node)}
    >
      <span className={styles.entityMark} data-type={node.entity_type} aria-hidden="true">
        {node.entity_type.slice(0, 2).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm text-[#f0ede4]">{node.label}</span>
        <span className="mt-1 block truncate font-mono text-[9px] uppercase tracking-[0.13em] text-[#77736a]">
          {node.subtitle ?? node.entity_type}{analysisSummary(node)}
        </span>
        {researched ? (
          <span className={`mt-1 block truncate text-[10px] ${styles.indexParent}`}>
            {ownershipSummary(node)}{pendingSummary(node)}
          </span>
        ) : (
          <span className={`mt-1 block truncate text-[10px] ${styles.indexUnresearched}`}>
            Not yet researched
          </span>
        )}
      </span>
      <span className="text-xs text-[#c9c3b6]">{node.country_code ?? "—"}</span>
      <span className="text-xs text-[#c9c3b6]">{node.funding_type ?? "—"}</span>
      <span className="text-xs text-[#c9c3b6]">{connectionSummary(node.connection_count)}</span>
      <span className={styles.confidence} data-tier={node.confidence_tier ?? "unresolved"}>
        {node.confidence_tier ?? "unresolved"}
      </span>
    </button>
  )
}

interface EntityRowsProps {
  readonly items: readonly AtlasNode[]
  readonly virtualItems: readonly Readonly<{ index: number; size: number; start: number }>[]
  readonly totalSize: number
  readonly onSelect: (node: AtlasNode) => void
}

const EntityRows = ({ items, virtualItems, totalSize, onSelect }: EntityRowsProps) => (
  <>
    <IndexHeaderRow />
    <div style={{ height: totalSize, position: "relative" }}>
      {virtualItems.map((row) => {
        const node = items[row.index]
        if (node === undefined) return undefined
        return <EntityRow key={node.id} node={node} height={row.size} start={row.start} onSelect={onSelect} />
      })}
    </div>
  </>
)

interface IndexViewportContentProps {
  readonly isLoading: boolean
  readonly error: unknown
  readonly items: readonly AtlasNode[]
  readonly virtualItems: readonly Readonly<{ index: number; size: number; start: number }>[]
  readonly totalSize: number
  readonly onSelect: (node: AtlasNode) => void
}

const IndexViewportContent = ({
  isLoading,
  error,
  items,
  virtualItems,
  totalSize,
  onSelect,
}: IndexViewportContentProps) => {
  if (isLoading) {
    return (
      <div className={styles.emptyState}>
        <Loader2 className="h-6 w-6 animate-spin text-[#d7b35f]" aria-label="Loading entity index" />
      </div>
    )
  }

  if (error instanceof Error) {
    return (
      <div className={styles.emptyState}>
        <div>
          <div className={styles.brandTitle}>Index unavailable</div>
          <p className={styles.contextCopy}>{error.message}</p>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return <div className={styles.emptyState}>No entity records match the current index filters.</div>
  }

  return <EntityRows items={items} virtualItems={virtualItems} totalSize={totalSize} onSelect={onSelect} />
}

const LoadingMore = ({ active }: Readonly<{ active: boolean }>) => {
  if (!active) return undefined
  return (
    <div className="flex items-center justify-center gap-2 border-t border-white/10 p-3 text-xs text-[#77736a]">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading more records
    </div>
  )
}

export const AtlasEntityList = ({
  entityTypes,
  country,
  funding,
  bias,
  onFiltersChange,
  onSelect,
  variant = "page",
  active = true,
}: AtlasEntityListProps) => {
  const [type, setType] = useState<EntityTypeTab>("all")
  const [kind, setKind] = useState<string[]>([])
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState("most_connected")
  const viewportRef = useRef<HTMLDivElement>(undefined)
  const effectiveTypes = effectiveEntityTypes(type, entityTypes)

  const indexQuery = useInfiniteQuery({
    enabled: active,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    initialPageParam: INITIAL_CURSOR,
    queryFn: ({ pageParam, signal }) => fetchAtlasIndex({
      bias: [...bias],
      country: [...country],
      cursor: pageParam,
      entityTypes: [...effectiveTypes],
      funding: [...funding],
      kind,
      limit: PAGE_SIZE,
      q: query.length > 0 ? query : undefined,
      sort,
    }, signal),
    queryKey: ["atlas", "index", effectiveTypes, query, country, funding, bias, kind, sort],
    staleTime: 60_000,
  })

  const items = useMemo(
    () => indexQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [indexQuery.data],
  )
  const firstPage = indexQuery.data?.pages[0]
  const total = firstPage?.total ?? 0
  const facets = firstPage?.facets
  const kindOptions = useMemo(() => Object.keys(facets?.kind ?? {}).sort(), [facets])
  const countryOptions = useMemo(() => Object.keys(facets?.country ?? {}).sort(), [facets])
  const fundingOptions = useMemo(() => Object.keys(facets?.funding ?? {}).sort(), [facets])
  const biasOptions = useMemo(() => Object.keys(facets?.bias ?? {}).sort(), [facets])

  const virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: () => ROW_ESTIMATE,
    getScrollElement: () => viewportRef.current,
    overscan: VIRTUAL_OVERSCAN,
  })
  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    if (!active) return
    const last = virtualItems.at(-1)
    if (last === undefined) return
    if (last.index < items.length - LOAD_AHEAD_ROWS) return
    if (indexQuery.hasNextPage !== true || indexQuery.isFetchingNextPage) return
    void indexQuery.fetchNextPage()
  }, [active, indexQuery, items.length, virtualItems])

  const changeType = (nextType: EntityTypeTab) => {
    setType(nextType)
    setKind([])
  }
  const changeKind = (value: string) => setKind((current) => toggleString(current, value))
  const rootClass = variant === "page" ? "flex min-h-0 flex-1 flex-col" : undefined
  const viewportClass = variant === "page" ? "relative min-h-0 flex-1 overflow-auto" : styles.indexViewport

  return (
    <div className={rootClass}>
      <DirectoryHeader
        variant={variant}
        total={total}
        query={query}
        sort={sort}
        type={type}
        kind={kind}
        kindOptions={kindOptions}
        country={country}
        funding={funding}
        bias={bias}
        countryOptions={countryOptions}
        fundingOptions={fundingOptions}
        biasOptions={biasOptions}
        onQueryChange={setQuery}
        onSortChange={setSort}
        onTypeChange={changeType}
        onKindChange={changeKind}
        onClearKinds={() => setKind([])}
        onFiltersChange={onFiltersChange}
      />
      <div ref={viewportRef} className={viewportClass}>
        <IndexViewportContent
          isLoading={indexQuery.isLoading}
          error={indexQuery.error}
          items={items}
          virtualItems={virtualItems}
          totalSize={virtualizer.getTotalSize()}
          onSelect={onSelect}
        />
      </div>
      <LoadingMore active={indexQuery.isFetchingNextPage} />
    </div>
  )
}

interface FacetSelectProps {
  readonly label: string
  readonly value: string
  readonly values: readonly string[]
  readonly onChange: (value: string) => void
}

const FacetSelect = ({ label, value, values, onChange }: FacetSelectProps) => (
  <label className="rounded-xl border border-white/10 bg-black/20 px-3">
    <span className="sr-only">{label}</span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 max-w-36 bg-transparent text-sm text-[#c9c3b6] outline-none"
      aria-label={`Filter by ${label.toLowerCase()}`}
    >
      <option value="all">All {label.toLowerCase()}</option>
      {values.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  </label>
)
