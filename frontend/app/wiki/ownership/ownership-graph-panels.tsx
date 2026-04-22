import Link from "next/link";
import { Building2, Globe2, Network, Newspaper, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { EdgeFilter, LayoutNode, NodeFilter, ProcessedGraph } from "./graph-utils";
import { isSource, normalizeType } from "./graph-utils";

interface ControlsPanelProps {
  search: string;
  selectedNodeId: string | null;
  nodeFilter: NodeFilter;
  edgeFilter: EdgeFilter;
  focusNeighborhood: boolean;
  matchingNodes: LayoutNode[];
  topHubs: LayoutNode[];
  onSearchChange: (value: string) => void;
  onNodeFilterChange: (value: NodeFilter) => void;
  onEdgeFilterChange: (value: EdgeFilter) => void;
  onFocusNeighborhoodChange: (value: boolean) => void;
  onSelectNode: (node: LayoutNode) => void;
}

export function ControlsPanel({
  search,
  selectedNodeId,
  nodeFilter,
  edgeFilter,
  focusNeighborhood,
  matchingNodes,
  topHubs,
  onSearchChange,
  onNodeFilterChange,
  onEdgeFilterChange,
  onFocusNeighborhoodChange,
  onSelectNode,
}: ControlsPanelProps) {
  const list = search.trim() ? matchingNodes : topHubs;

  return (
    <aside className="rounded-2xl border border-white/10 bg-[#0b0f15]/95 p-4 text-[#ece6d9] shadow-[0_24px_80px_rgba(0,0,0,0.36)] backdrop-blur-xl">
      <div className="mb-4">
        <p className="font-serif text-lg text-[#f6f1e8]">Find a clean slice</p>
        <p className="mt-1 text-sm text-[#b4ab9b]">
          Search for a source or owner, then narrow the network before reading relationships.
        </p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8d8778]" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search source, organization, country"
          className="border-white/10 bg-black/30 pl-9 text-[#f6f1e8] placeholder:text-[#8d8778]"
        />
      </div>

      <div className="mt-4 space-y-3 text-sm">
        <FilterGroup<NodeFilter>
          label="Node filter"
          value={nodeFilter}
          options={[
            ["all", "All"],
            ["organizations", "Orgs"],
            ["sources", "Sources"],
          ]}
          onChange={onNodeFilterChange}
        />

        <FilterGroup<EdgeFilter>
          label="Link filter"
          value={edgeFilter}
          options={[
            ["all", "All"],
            ["ownership", "Ownership"],
            ["publishes", "Publishes"],
          ]}
          onChange={onEdgeFilterChange}
        />

        <button
          onClick={() => onFocusNeighborhoodChange(!focusNeighborhood)}
          className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 transition-colors ${
            focusNeighborhood
              ? "border-[#c9a66b]/40 bg-[#c9a66b]/12 text-[#f5ecd7]"
              : "border-white/10 text-[#b4ab9b] hover:border-white/20 hover:bg-white/[0.03]"
          }`}
        >
          <span>Focus on selected neighborhood</span>
          <Network className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-5 border-t border-white/10 pt-4">
        <div className="mb-2 text-[11px] font-mono uppercase tracking-[0.18em] text-[#8d8778]">
          {search.trim() ? "Matches" : "Top hubs"}
        </div>
        <div className="space-y-2">
          {list.map((node) => (
            <button
              key={node.id}
              onClick={() => onSelectNode(node)}
              className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition-colors ${
                selectedNodeId === node.id
                  ? "border-[#c9a66b]/40 bg-white/[0.06]"
                  : "border-white/10 hover:border-white/20 hover:bg-white/[0.03]"
              }`}
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-[#f1ebde]">{node.label}</div>
                <div className="mt-0.5 text-[11px] text-[#978f81]">
                  {normalizeType(node)} · {node.degree} connections
                </div>
              </div>
              {isSource(node) ? <Newspaper className="h-4 w-4 text-[#88b4ff]" /> : <Building2 className="h-4 w-4 text-[#c9a66b]" />}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

interface InspectorPanelProps {
  processedGraph: ProcessedGraph | null;
  selectedNode: LayoutNode | null;
  topHubs: LayoutNode[];
  relatedOrganizations: LayoutNode[];
  relatedSources: LayoutNode[];
  onSelectNode: (node: LayoutNode) => void;
}

export function InspectorPanel({
  processedGraph,
  selectedNode,
  topHubs,
  relatedOrganizations,
  relatedSources,
  onSelectNode,
}: InspectorPanelProps) {
  return (
    <aside className="rounded-2xl border border-white/10 bg-[#0b0f15]/95 p-4 text-[#ece6d9] shadow-[0_24px_80px_rgba(0,0,0,0.36)] backdrop-blur-xl">
      <div className="mb-4">
        <p className="font-serif text-lg text-[#f6f1e8]">Inspector</p>
        <p className="mt-1 text-sm text-[#b4ab9b]">
          {selectedNode ? "Selected node details and direct relationships." : "Pick a node to inspect its local ownership picture."}
        </p>
      </div>

      {processedGraph && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <StatCard label="Countries" value={processedGraph.stats.countries} />
          <StatCard label="Ownership links" value={processedGraph.stats.ownershipEdges} />
        </div>
      )}

      {!selectedNode && (
        <div className="mt-5 space-y-4 text-sm">
          <div className="rounded-2xl border border-dashed border-white/10 bg-black/30 p-4 text-[#b4ab9b]">
            Search or click a node to reduce the graph to one readable neighborhood.
          </div>
          <div>
            <div className="mb-2 text-[11px] font-mono uppercase tracking-[0.18em] text-[#8d8778]">Suggested starting points</div>
            <div className="space-y-2">
              {topHubs.slice(0, 5).map((node) => (
                <button
                  key={node.id}
                  onClick={() => onSelectNode(node)}
                  className="flex w-full items-center justify-between rounded-xl border border-white/10 px-3 py-2 text-left transition-colors hover:border-white/20 hover:bg-white/[0.03]"
                >
                  <span className="truncate text-[#f1ebde]">{node.label}</span>
                  <span className="text-[11px] text-[#978f81]">{node.degree}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedNode && (
        <div className="mt-5 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-[#8d8778]">
                  {normalizeType(selectedNode)}
                </div>
                <h2 className="mt-1 font-serif text-xl text-[#f6f1e8]">{selectedNode.label}</h2>
              </div>
              {isSource(selectedNode) ? <Newspaper className="mt-1 h-5 w-5 text-[#88b4ff]" /> : <Building2 className="mt-1 h-5 w-5 text-[#c9a66b]" />}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <StatCard label="Connections" value={selectedNode.degree} />
              <StatCard label="Ownership edges" value={selectedNode.ownershipDegree} />
            </div>

            <div className="mt-4 space-y-1.5 text-sm text-[#b4ab9b]">
              {selectedNode.country && (
                <div className="flex items-center gap-2">
                  <Globe2 className="h-4 w-4" />
                  <span>{selectedNode.country}</span>
                </div>
              )}
              {selectedNode.bias && <div>Bias: {selectedNode.bias}</div>}
              {selectedNode.funding && <div>Funding: {selectedNode.funding}</div>}
            </div>

            {isSource(selectedNode) && (
              <Link
                href={`/wiki/source/${encodeURIComponent(selectedNode.label)}`}
                className="mt-4 inline-flex rounded-lg border border-[#c9a66b]/30 bg-[#c9a66b]/12 px-3 py-2 text-sm text-[#f0debc] transition-colors hover:bg-[#c9a66b]/18"
              >
                Open source wiki page
              </Link>
            )}
          </div>

          <RelatedList label="Related organizations" nodes={relatedOrganizations} empty="No direct organizations in this neighborhood." onSelectNode={onSelectNode} />
          <RelatedList label="Related sources" nodes={relatedSources} empty="No direct sources in this neighborhood." onSelectNode={onSelectNode} />
        </div>
      )}
    </aside>
  );
}

function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-mono uppercase tracking-[0.18em] text-[#8d8778]">{label}</div>
      <div className="grid grid-cols-3 gap-2">
        {options.map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            onClick={() => onChange(optionValue)}
            className={`rounded-xl border px-3 py-2 transition-colors ${
              value === optionValue
                ? "border-[#c9a66b]/40 bg-white/[0.06] text-[#f5ecd7]"
                : "border-white/10 text-[#b4ab9b] hover:border-white/20 hover:bg-white/[0.03]"
            }`}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-[#8d8778]">{label}</div>
      <div className="mt-1 text-lg text-[#f5ecd7]">{value}</div>
    </div>
  );
}

function RelatedList({
  label,
  nodes,
  empty,
  onSelectNode,
}: {
  label: string;
  nodes: LayoutNode[];
  empty: string;
  onSelectNode: (node: LayoutNode) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-mono uppercase tracking-[0.18em] text-[#8d8778]">{label}</div>
      <div className="space-y-2">
        {nodes.length > 0 ? (
          nodes.map((node) => (
            <button
              key={node.id}
              onClick={() => onSelectNode(node)}
              className="flex w-full items-center justify-between rounded-xl border border-white/10 px-3 py-2 text-left transition-colors hover:border-white/20 hover:bg-white/[0.03]"
            >
              <span className="truncate text-[#f1ebde]">{node.label}</span>
              <span className="text-[11px] text-[#978f81]">{isSource(node) ? node.bias || "source" : node.degree}</span>
            </button>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 px-3 py-2 text-sm text-[#b4ab9b]">{empty}</div>
        )}
      </div>
    </div>
  );
}
