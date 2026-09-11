"use client";

import { ChevronLeft, Loader2 } from "lucide-react";
import type { FundingBiasAnalysisResponse, FundingBiasStatistic } from "@/features/intelligence-atlas/lib/atlas-schema";
import type { ReactElement, ReactNode } from "react";
import { GlobalNavigation } from "@/components/global-navigation";
import Link from "next/link";
import { fetchFundingBiasAnalysis } from "@/features/intelligence-atlas/lib/atlas-api";
import { useQuery } from "@tanstack/react-query";

interface AnalysisContentProps {
  readonly data: FundingBiasAnalysisViewData | undefined;
  readonly error: Readonly<Error> | null;
  readonly isLoading: boolean;
}

interface AnalysisStateProps {
  readonly data: FundingBiasAnalysisViewData | undefined;
  readonly error: Readonly<Error> | null;
  readonly isLoading: boolean;
}

interface AssociationPanelProps {
  readonly statistic: FundingBiasStatisticView | undefined;
}

interface ContingencyTableBodyProps {
  readonly columns: readonly string[];
  readonly rows: readonly string[];
  readonly table: readonly (readonly number[])[];
}

interface ContingencyTablePanelProps {
  readonly populationSize: number;
  readonly statistic: FundingBiasStatisticView | undefined;
}

interface ContingencyTableRowProps {
  readonly columns: readonly string[];
  readonly counts: readonly number[];
  readonly row: string;
}

interface MethodologyContentProps {
  readonly algorithmVersion: string | null | undefined;
  readonly methodology: FundingBiasMethodologyView;
  readonly specification: FundingBiasSpecificationView;
}

interface MethodologyMetadataProps {
  readonly algorithmVersion: string | null | undefined;
  readonly methodology: FundingBiasMethodologyView;
}

interface MethodologyPanelProps {
  readonly algorithmVersion: string | null | undefined;
  readonly methodology: FundingBiasMethodologyView | undefined;
}

interface PanelProps {
  readonly children: Readonly<ReactElement>;
  readonly eyebrow: string;
  readonly title: string;
}

interface FundingBiasAnalysisViewData {
  readonly algorithm_version?: string | null | undefined;
  readonly available: boolean;
  readonly methodology?: FundingBiasMethodologyView | null | undefined;
  readonly population_size: number;
  readonly statistic?: FundingBiasStatisticView | null | undefined;
}

interface FundingBiasMethodologyView {
  readonly locked_at: string;
  readonly preregistration_id: string;
  readonly specification: FundingBiasSpecificationView;
}

interface FundingBiasSpecificationView {
  readonly limitations: readonly string[];
  readonly measure?: string | undefined;
  readonly population?: string | undefined;
}

interface FundingBiasStatisticView extends Readonly<Pick<FundingBiasStatistic, "n">> {
  readonly chi_square?: number | null | undefined;
  readonly cols: readonly string[];
  readonly cramers_v?: number | null | undefined;
  readonly interpretation?: string | null | undefined;
  readonly note?: string | null | undefined;
  readonly rows: readonly string[];
  readonly table: readonly (readonly number[])[];
}

const AlgorithmVersion = (props: Readonly<{ readonly value: string | null | undefined }>): ReactNode => {
    const version = props.value ?? "";
    if (version === "") {
      return false;
    }

    return <span>Algorithm {version}</span>;
  },
  AnalysisBackground = () => (
    <div className="pointer-events-none fixed inset-0 z-[-1] bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />
  ),
  AnalysisCommand = () => (
    <code className="font-mono text-xs">python -m app.scripts.run_funding_bias_analysis</code>
  ),
  AnalysisContent = (props: Readonly<AnalysisContentProps>) => (
    <div className="flex min-h-screen overflow-hidden bg-background text-foreground">
      <GlobalNavigation />
      <AnalysisContentBody data={props.data} error={props.error} isLoading={props.isLoading} />
    </div>
  ),
  AnalysisContentBody = (props: Readonly<AnalysisContentProps>) => (
    <div className="relative z-10 flex-1 overflow-y-auto custom-scrollbar">
      <AnalysisBackground />
      <main className="mx-auto max-w-[1100px] space-y-5 p-4">
        <AnalysisHeader />
        <AnalysisState data={props.data} error={props.error} isLoading={props.isLoading} />
      </main>
    </div>
  ),
  AnalysisError = (props: Readonly<{ readonly error: Readonly<Error> | null }>) => {
    let message = "Analysis unavailable";
    if (props.error instanceof Error) {
      const { message: errorMessage } = props.error;
      message = errorMessage;
    }

    return (
      <div className="rounded-2xl border border-white/5 bg-black/20 p-8 text-center font-mono text-sm text-red-400">
        {message}
      </div>
    );
  },
  AnalysisHeader = () => (
    <>
      <Link
        href="/wiki/ownership"
        className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-3 w-3" />
        Intelligence Atlas
      </Link>
      <AnalysisHeaderCopy />
    </>
  ),
  AnalysisHeaderCopy = () => (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        Analysis
      </div>
      <h1 className="mt-1 font-serif text-3xl">Funding vs. Bias</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        A pre-registered, catalog-wide association between each outlet&apos;s funding type and its bias rating.
      </p>
    </div>
  ),
  AnalysisLoading = () => (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
  AnalysisState = (props: Readonly<AnalysisStateProps>) => {
    if (props.isLoading) {
      return <AnalysisLoading />;
    }

    if (props.error !== null || props.data === undefined) {
      return <AnalysisError error={props.error} />;
    }

    if (!props.data.available) {
      return <UnavailableAnalysis />;
    }

    return <AvailableAnalysis data={props.data} />;
  },
  AssociationContent = (props: Readonly<{ readonly statistic: FundingBiasStatisticView }>) => (
    <>
      <AssociationStats statistic={props.statistic} />
      <StatisticNote note={props.statistic.note} />
    </>
  ),
  AssociationPanel = (props: Readonly<AssociationPanelProps>): ReactNode => {
    if (props.statistic === undefined) {
      return false;
    }

    return (
      <Panel title="Association Statistic" eyebrow="Cramer&apos;s V">
        <AssociationContent statistic={props.statistic} />
      </Panel>
    );
  },
  AssociationStats = (props: Readonly<{ readonly statistic: FundingBiasStatisticView }>) => (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile label="n" value={String(props.statistic.n)} />
      <StatTile label="Chi-square" value={formatStatistic(props.statistic.chi_square, "—")} />
      <StatTile label="Cramer&apos;s V" value={formatStatistic(props.statistic.cramers_v, "—")} />
      <StatTile label="Interpretation" value={props.statistic.interpretation ?? "not computable"} />
    </div>
  ),
  AvailableAnalysis = (props: Readonly<{ readonly data: FundingBiasAnalysisViewData }>) => (
    <>
      <MethodologyPanel methodology={props.data.methodology ?? undefined} algorithmVersion={props.data.algorithm_version} />
      <ContingencyTablePanel populationSize={props.data.population_size} statistic={props.data.statistic ?? undefined} />
      <AssociationPanel statistic={props.data.statistic ?? undefined} />
      <LimitationsPanel methodology={props.data.methodology ?? undefined} />
      <CorrelationCaption />
    </>
  ),
  ContingencyTable = (props: Readonly<{ readonly statistic: FundingBiasStatisticView }>) => (
    <div className="overflow-x-auto rounded-2xl border border-white/5 bg-black/20 p-5">
      <table className="w-full border-collapse text-sm">
        <ContingencyTableHead columns={props.statistic.cols} />
        <ContingencyTableBody columns={props.statistic.cols} rows={props.statistic.rows} table={props.statistic.table} />
      </table>
    </div>
  ),
  ContingencyTableBody = (props: Readonly<ContingencyTableBodyProps>) => (
    <tbody>
      {props.rows.map((row, rowIndex) => (
        <ContingencyTableRow
          key={row}
          columns={props.columns}
          counts={props.table[rowIndex] ?? EMPTY_COUNTS}
          row={row}
        />
      ))}
    </tbody>
  ),
  ContingencyTableHead = (props: Readonly<{ readonly columns: readonly string[] }>) => (
    <thead>
      <ContingencyTableHeaderRow columns={props.columns} />
    </thead>
  ),
  ContingencyTableHeaderRow = (props: Readonly<{ readonly columns: readonly string[] }>) => (
    <tr>
      <th className="p-2 text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Funding \ Bias
      </th>
      {props.columns.map((column) => (
        <th
          key={column}
          className="p-2 text-right font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
        >
          {column}
        </th>
      ))}
    </tr>
  ),
  ContingencyTablePanel = (props: Readonly<ContingencyTablePanelProps>): ReactNode => {
    if (props.statistic === undefined) {
      return false;
    }

    return (
      <Panel title="Contingency Table" eyebrow={`${props.populationSize} outlets in the population`}>
        <ContingencyTable statistic={props.statistic} />
      </Panel>
    );
  },
  ContingencyTableRow = (props: Readonly<ContingencyTableRowProps>) => (
    <tr className="border-t border-white/5">
      <td className="p-2 font-serif">{props.row}</td>
      {props.columns.map((column, columnIndex) => (
        <td key={column} className="p-2 text-right font-mono text-xs">
          {props.counts[columnIndex] ?? EMPTY_COUNT}
        </td>
      ))}
    </tr>
  ),
  CorrelationCaption = () => (
    <p className="rounded-xl border border-white/5 bg-black/10 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
      Correlation shown, not proven causation — values are attributed to their sources.
    </p>
  ),
  DECIMAL_PLACES = 3,
  EMPTY_COUNT = 0,
  EMPTY_COUNTS: readonly number[] = [],
  EMPTY_LIST_SIZE = 0,
  FundingBiasAnalysisView = () => {
    const { data, error, isLoading } = useQuery<FundingBiasAnalysisResponse>({
      queryFn: () => fetchFundingBiasAnalysis(),
      queryKey: ["atlas-funding-bias-analysis"],
      retry: 1,
    });

    return <AnalysisContent data={data} error={error} isLoading={isLoading} />;
  },
  LimitationItem = (props: Readonly<{ readonly limitation: string }>) => (
    <li className="flex gap-2">
      <span className="text-muted-foreground">-</span>
      <span>{props.limitation}</span>
    </li>
  ),
  LimitationsList = (props: Readonly<{ readonly limitations: readonly string[] }>) => (
    <ul className="space-y-2 rounded-2xl border border-white/5 bg-black/20 p-5 text-sm leading-relaxed text-foreground/90">
      {props.limitations.map((limitation) => (
        <LimitationItem key={limitation} limitation={limitation} />
      ))}
    </ul>
  ),
  LimitationsPanel = (props: Readonly<{ readonly methodology: FundingBiasMethodologyView | undefined }>): ReactNode => {
    const limitations = getLimitations(props.methodology);
    if (limitations === undefined) {
      return false;
    }

    return (
      <Panel title="Limitations" eyebrow="Preregistered before the data was seen">
        <LimitationsList limitations={limitations} />
      </Panel>
    );
  },
  MethodologyContent = (props: Readonly<MethodologyContentProps>) => (
    <div className="space-y-3 rounded-2xl border border-white/5 bg-black/20 p-5 text-sm leading-relaxed">
      <MethodologyField label="Population" value={props.specification.population} />
      <MethodologyField label="Measure" value={props.specification.measure} />
      <MethodologyMetadata algorithmVersion={props.algorithmVersion} methodology={props.methodology} />
    </div>
  ),
  MethodologyField = (props: Readonly<{ readonly label: string; readonly value: string | undefined }>) => {
    const value = props.value ?? "Not specified";
    return (
      <div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{props.label}</div>
        <p className="mt-1 text-foreground/90">{value}</p>
      </div>
    );
  },
  MethodologyMetadata = (props: Readonly<MethodologyMetadataProps>) => (
    <div className="flex flex-wrap items-center gap-3 pt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      <span>Locked {new Date(props.methodology.locked_at).toLocaleDateString()}</span>
      <span>Preregistration {props.methodology.preregistration_id}</span>
      <AlgorithmVersion value={props.algorithmVersion} />
    </div>
  ),
  MethodologyPanel = (props: Readonly<MethodologyPanelProps>): ReactNode => {
    if (props.methodology === undefined) {
      return false;
    }

    return (
      <Panel title="Methodology" eyebrow="Locked before computation">
        <MethodologyContent
          specification={props.methodology.specification}
          methodology={props.methodology}
          algorithmVersion={props.algorithmVersion}
        />
      </Panel>
    );
  },
  Panel = (props: Readonly<PanelProps>) => (
    <section>
      <PanelHeading eyebrow={props.eyebrow} title={props.title} />
      {props.children}
    </section>
  ),
  PanelHeading = (props: Readonly<Pick<PanelProps, "eyebrow" | "title">>) => (
    <div className="mb-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{props.eyebrow}</div>
      <h2 className="mt-1 font-serif text-2xl">{props.title}</h2>
    </div>
  ),
  StatTile = (props: Readonly<{ readonly label: string; readonly value: string }>) => (
    <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{props.label}</div>
      <div className="mt-2 font-serif text-xl">{props.value}</div>
    </div>
  ),
  StatisticNote = (props: Readonly<{ readonly note: string | null | undefined }>): ReactNode => {
    const resolvedNote = props.note ?? "";
    if (resolvedNote === "") {
      return false;
    }

    return <p className="mt-3 text-xs text-muted-foreground">{resolvedNote}</p>;
  },
  UnavailableAnalysis = () => (
    <div className="rounded-2xl border border-white/5 bg-black/20 p-8 text-center">
      <p className="text-sm text-muted-foreground">
        This analysis hasn&apos;t been run yet. It ships as a CLI job <AnalysisCommand />,
        not a live computation, because it locks a methodology before touching the data.
      </p>
    </div>
  ),
  formatStatistic = (value: number | null | undefined, fallback: string): string => {
    const numericValue = value ?? Number.NaN;
    if (Number.isNaN(numericValue)) {
      return fallback;
    }

    return numericValue.toFixed(DECIMAL_PLACES);
  },
  getLimitations = (
    methodology: Readonly<FundingBiasMethodologyView> | undefined,
  ): readonly string[] | undefined => {
    if (methodology === undefined) {
      return undefined;
    }

    const limitations = [...new Set(methodology.specification.limitations)];
    if (limitations.length === EMPTY_LIST_SIZE) {
      return undefined;
    }

    return limitations;
  };

/**
 * Phase 5 Part B: the catalog-wide, pre-registered funding-vs-bias
 * correlation. Read-only -- the analysis itself is computed and persisted
 * by `python -m app.scripts.run_funding_bias_analysis`, not triggered from
 * this page. Renders the locked methodology, the contingency table, the
 * Cramer's V statistic with a plain-language interpretation band, the
 * preregistered limitations, and the same correlation-not-causation
 * caption shown on the per-entity Funding & Bias panel.
 *
 * @returns {ReactNode} The funding-vs-bias analysis view.
 */

export { FundingBiasAnalysisView };
