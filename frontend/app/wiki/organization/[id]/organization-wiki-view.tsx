"use client";

import type { ReactNode } from 'react';
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ExternalLink, Loader2, Network } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { GlobalNavigation } from "@/components/global-navigation";
import { fetchAtlasEntity } from "@/features/intelligence-atlas/lib/atlas-api";
import { parseControls, parseExternalIds, parseFundingAndBias, parseOwnershipChain, parseRoleBreakdown } from '@/features/intelligence-atlas/lib/atlas-schema';
import type { AtlasEntityRecord } from '@/features/intelligence-atlas/lib/atlas-schema';
import { FundingBiasPanel } from "@/features/intelligence-atlas/funding-bias-panel";
import { OwnershipChain } from "@/features/intelligence-atlas/ownership-chain";
import { buildAtlasNeighborhoodHref } from "@/features/intelligence-atlas/lib/atlas-query-state";

export function OrganizationWikiView({ entityId }:Readonly< { entityId: string }>) {
  const { data, isLoading, error } = useQuery<AtlasEntityRecord>({
    enabled: Boolean(entityId),
    queryFn: () => fetchAtlasEntity(entityId),
    queryKey: ["atlas-entity", entityId],
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
        <GlobalNavigation />
        <div className="flex-1 flex min-h-screen items-center justify-center relative z-10 custom-scrollbar">
          <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    const message = error instanceof Error ? error.message : "Organization not found";
    return (
      <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
        <GlobalNavigation />
        <div className="flex-1 p-6 relative z-10 custom-scrollbar">
          <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
          <Link href="/wiki/ownership" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="h-4 w-4" />
            Back to Intelligence Atlas
          </Link>
          <div className="mt-16 text-center text-red-400 font-mono text-sm">{message}</div>
        </div>
      </div>
    );
  }

  const chain = parseOwnershipChain(data.details),
   controls = parseControls(data.details),
   externalIds = parseExternalIds(data.details),
   roleBreakdown = parseRoleBreakdown(data.details),
   fundingAndBias = parseFundingAndBias(data.details);

  return (
    <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
      <GlobalNavigation />
      <div className="flex-1 overflow-y-auto relative z-10 custom-scrollbar">
        <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />

        <main className="mx-auto grid max-w-[1500px] gap-5 p-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="rounded-2xl border bg-black/40 backdrop-blur-2xl border-white/10 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] ring-1 ring-white/5 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto custom-scrollbar">
            <Link href="/wiki/ownership" className="inline-flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="h-3 w-3" />
              Intelligence Atlas
            </Link>

            <div className="mt-5">
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Organization
              </div>
              <h1 className="mt-1 font-serif text-3xl">{data.label}</h1>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {data.subtitle && <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">{data.subtitle}</Badge>}
                {data.status && <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">{data.status}</Badge>}
                {data.confidence_tier && <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">{data.confidence_tier}</Badge>}
              </div>
              <Link
                href={buildAtlasNeighborhoodHref(data.id)}
                className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
              >
                <Network className="h-3 w-3" />
                Explore neighborhood
              </Link>
            </div>

            <SidebarCard title="Quick Facts">
              <SidebarFact label="Evidence" value={String(data.evidence.length)} />
              <SidebarFact label="Connections" value={String(data.connections.length)} />
              {typeof data.details.funding_type === "string" ? (
                <SidebarFact label="Funding" value={data.details.funding_type} />
              ) : null}
              {data.last_verified_at ? (
                <SidebarFact label="Last verified" value={new Date(data.last_verified_at).toLocaleDateString()} />
              ) : null}
            </SidebarCard>

            {Object.keys(roleBreakdown).length > 0 ? (
              <SidebarCard title="Role Breakdown">
                <div className="space-y-2">
                  {Object.entries(roleBreakdown).map(([role, count]) => (
                    <div key={role} className="flex items-center justify-between text-[10px] font-mono tracking-widest uppercase">
                      <span className="text-muted-foreground">{role.replaceAll("_", " ")}</span>
                      <span>{count}</span>
                    </div>
                  ))}
                </div>
              </SidebarCard>
            ) : null}

            <SidebarCard title="External Identifiers">
              {externalIds.length > 0 ? (
                <div className="space-y-2 text-sm">
                  {externalIds.map((extId) => (
                    <div key={`${extId.scheme}-${extId.value}`} className="flex items-center gap-2">
                      {extId.url ? (
                        <a href={extId.url} target="_blank" rel="noreferrer" className="group flex items-center gap-2 text-muted-foreground transition-colors hover:text-white">
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span className="truncate font-serif">{extId.scheme.replaceAll("_", " ")}: {extId.value}</span>
                        </a>
                      ) : (
                        <span className="truncate font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
                          {extId.scheme.replaceAll("_", " ")}: {extId.value}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">No external identifiers recorded.</p>
              )}
            </SidebarCard>
          </aside>

          <section className="space-y-5">
            {fundingAndBias && (
              <Panel title="Funding & Bias" eyebrow="Funding type beside cited bias/factuality ratings">
                <div className="rounded-2xl border border-white/5 bg-black/20 p-5">
                  <FundingBiasPanel block={fundingAndBias} />
                </div>
              </Panel>
            )}

            <Panel title="Ownership Chain" eyebrow="This entity's evidenced parents, up to the ultimate owner">
              {chain.length > 1 ? (
                <div className="rounded-2xl border border-white/5 bg-black/20 p-5">
                  <OwnershipChain chain={chain} currentEntityId={data.id} />
                </div>
              ) : (
                <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">No accepted ownership chain recorded above this entity.</p>
              )}
            </Panel>

            <Panel title="Controls" eyebrow="Everything this owner reaches through accepted ownership edges">
              {controls.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {controls.map((entry) => {
                    const card = (
                      <div className="group rounded-2xl border border-white/5 bg-black/20 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-4 relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-tr from-primary/0 to-primary/5 opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none" />
                        <div className="font-serif text-base relative z-10">{entry.label}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 relative z-10">
                          <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">{entry.entity_type}</Badge>
                          {entry.percentage == null ? null : (
                            <span className="font-mono text-[10px] tracking-widest text-muted-foreground">{entry.percentage.toFixed(1)}%</span>
                          )}
                        </div>
                        <div className="mt-2 font-mono text-[10px] tracking-widest text-muted-foreground relative z-10">
                          {entry.evidence_count} evidence
                        </div>
                      </div>
                    );
                    return entry.profile_path ? (
                      <Link key={entry.entity_id} href={entry.profile_path}>{card}</Link>
                    ) : (
                      <div key={entry.entity_id}>{card}</div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">No downstream entities recorded under this owner.</p>
              )}
            </Panel>

            <Panel title="Connections" eyebrow="Every relationship in the bounded evidence graph">
              <div className="space-y-2">
                {data.connections.length > 0 ? (
                  data.connections.map(({ edge, entity }) => {
                    const row = (
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-sm transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg group">
                        <div className="min-w-0">
                          <div className="truncate font-serif group-hover:text-white transition-colors">{entity.label}</div>
                          <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                            {edge.relation_type.replaceAll("_", " ")} · {edge.direction}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{edge.fact_status}</div>
                          <div className="mt-1 font-mono text-[10px] text-muted-foreground">{edge.evidence_count} evidence</div>
                        </div>
                      </div>
                    );
                    return entity.profile_path ? (
                      <Link key={edge.id} href={entity.profile_path}>{row}</Link>
                    ) : (
                      <div key={edge.id}>{row}</div>
                    );
                  })
                ) : (
                  <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">No relationships in the current bounded graph.</p>
                )}
              </div>
            </Panel>

            <Panel title="Evidence Trail" eyebrow="Citations backing the relationships above">
              {data.evidence.length > 0 ? (
                <div className="space-y-3">
                  {data.evidence.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/5 bg-black/20 p-4 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-serif">{item.source_name || item.source_type}</div>
                          {item.excerpt ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.excerpt}</p> : null}
                          <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                            {item.retrieved_at ? new Date(item.retrieved_at).toLocaleDateString() : "Not recorded"}
                          </div>
                        </div>
                        {item.source_url ? (
                          <a href={item.source_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-white transition-colors shrink-0">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
                  <Network className="h-3.5 w-3.5" />
                  No evidence rows attached to the visible relationships.
                </div>
              )}
            </Panel>
          </section>
        </main>
      </div>
    </div>
  );
}

function Panel({ title, eyebrow, children }:Readonly< { title: string; eyebrow: string; children: ReactNode }>) {
  return (
    <section>
      <div className="mb-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{eyebrow}</div>
        <h2 className="mt-1 font-serif text-2xl">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function SidebarCard({ title, children }:Readonly< { title: string; children: ReactNode }>) {
  return (
    <div className="mt-4 rounded-2xl border border-white/5 bg-black/20 p-4 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
      <div className="mb-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function SidebarFact({ label, value }:Readonly< { label: string; value: string }>) {
  return (
    <div className="flex items-start justify-between gap-3 text-[10px] font-mono tracking-widest uppercase mt-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
