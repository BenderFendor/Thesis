"use client";

import type { ReactNode } from 'react';
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Loader2 } from "lucide-react";
import { GlobalNavigation } from "@/components/global-navigation";
import { fetchFundingBiasAnalysis } from "@/features/intelligence-atlas/lib/atlas-api";
import type { FundingBiasAnalysisResponse } from "@/features/intelligence-atlas/lib/atlas-schema";

/**
 * Phase 5 Part B: the catalog-wide, pre-registered funding-vs-bias
 * correlation. Read-only -- the analysis itself is computed and persisted
 * by `python -m app.scripts.run_funding_bias_analysis`, not triggered from
 * this page. Renders the locked methodology, the contingency table, the
 * Cramer's V statistic with a plain-language interpretation band, the
 * preregistered limitations, and the same correlation-not-causation
 * caption shown on the per-entity Funding & Bias panel.
 */
export function FundingBiasAnalysisView() {
  const { data, isLoading, error } = useQuery<FundingBiasAnalysisResponse>({
    queryFn: () => fetchFundingBiasAnalysis(),
    queryKey: ["atlas-funding-bias-analysis"],
    retry: 1,
  });

  return (
    <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
      <GlobalNavigation />
      <div className="flex-1 overflow-y-auto relative z-10 custom-scrollbar">
        <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
        <main className="mx-auto max-w-[1100px] space-y-5 p-4">
          <Link
            href="/wiki/ownership"
            className="inline-flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-3 w-3" />
            Intelligence Atlas
          </Link>

          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Analysis</div>
            <h1 className="mt-1 font-serif text-3xl">Funding vs. Bias</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              A pre-registered, catalog-wide association between each outlet&apos;s funding type and its bias rating.
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error || !data ? (
            <div className="rounded-2xl border border-white/5 bg-black/20 p-8 text-center text-sm text-red-400 font-mono">
              {error instanceof Error ? error.message : "Analysis unavailable"}
            </div>
          ) : data.available ? (
            <>
              {data.methodology && (
                <Panel title="Methodology" eyebrow="Locked before computation">
                  <div className="space-y-3 rounded-2xl border border-white/5 bg-black/20 p-5 text-sm leading-relaxed">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Population
                      </div>
                      <p className="mt-1 text-foreground/90">
                        {String(data.methodology.specification.population ?? "")}
                      </p>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Measure
                      </div>
                      <p className="mt-1 text-foreground/90">
                        {String(data.methodology.specification.measure ?? "")}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 pt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      <span>Locked {new Date(data.methodology.locked_at).toLocaleDateString()}</span>
                      <span>Preregistration {data.methodology.preregistration_id}</span>
                      {data.algorithm_version && <span>Algorithm {data.algorithm_version}</span>}
                    </div>
                  </div>
                </Panel>
              )}

              {data.statistic && (
                <Panel title="Contingency Table" eyebrow={`${data.population_size} outlets in the population`}>
                  <div className="overflow-x-auto rounded-2xl border border-white/5 bg-black/20 p-5">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <th className="p-2 text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                            Funding \ Bias
                          </th>
                          {data.statistic.cols.map((col) => (
                            <th
                              key={col}
                              className="p-2 text-right font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
                            >
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.statistic.rows.map((row, rowIndex) => (
                          <tr key={row} className="border-t border-white/5">
                            <td className="p-2 font-serif">{row}</td>
                            {data.statistic!.table[rowIndex]?.map((count, colIndex) => (
                              <td key={colIndex} className="p-2 text-right font-mono text-xs">
                                {count}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              )}

              {data.statistic && (
                <Panel title="Association Statistic" eyebrow="Cramer's V">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <StatTile label="n" value={String(data.statistic.n)} />
                    <StatTile
                      label="Chi-square"
                      value={data.statistic.chi_square == null ? "—" : data.statistic.chi_square.toFixed(3)}
                    />
                    <StatTile
                      label="Cramer's V"
                      value={data.statistic.cramers_v == null ? "undefined" : data.statistic.cramers_v.toFixed(3)}
                    />
                    <StatTile label="Interpretation" value={data.statistic.interpretation ?? "not computable"} />
                  </div>
                  {data.statistic.note && (
                    <p className="mt-3 text-xs text-muted-foreground">{data.statistic.note}</p>
                  )}
                </Panel>
              )}

              {data.methodology && Array.isArray(data.methodology.specification.limitations) && (
                <Panel title="Limitations" eyebrow="Preregistered before the data was seen">
                  <ul className="space-y-2 rounded-2xl border border-white/5 bg-black/20 p-5 text-sm leading-relaxed text-foreground/90">
                    {(data.methodology.specification.limitations as unknown[]).map((item, index) => (
                      <li key={index} className="flex gap-2">
                        <span className="text-muted-foreground">-</span>
                        <span>{String(item)}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              <p className="rounded-xl border border-white/5 bg-black/10 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                Correlation shown, not proven causation — values are attributed to their sources.
              </p>
            </>
          ) : (
            <div className="rounded-2xl border border-white/5 bg-black/20 p-8 text-center">
              <p className="text-sm text-muted-foreground">
                This analysis hasn&apos;t been run yet. It ships as a CLI job
                (<code className="font-mono text-xs">python -m app.scripts.run_funding_bias_analysis</code>),
                not a live computation, because it locks a methodology before touching the data.
              </p>
            </div>
          )}
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

function StatTile({ label, value }:Readonly< { label: string; value: string }>) {
  return (
    <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-2 font-serif text-xl">{value}</div>
    </div>
  );
}
