import type { ReactNode } from "react";
import type { SourceStats } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { displaySourceValue, formatCheckedTime } from "./source-intelligence-operations-helpers";

const SourcesTable = ({ sources }: Readonly<{ sources: readonly SourceStats[] }>) => (
  <Table className="text-foreground">
    <SourceTableHeader />
    <TableBody>
      {sources.map((source) => (
        <SourceRow key={`${source.name}-${source.url}`} source={source} />
      ))}
    </TableBody>
  </Table>
);

const SourceTableHeader = () => (
  <TableHeader>
    <SourceTableHeaderRow />
  </TableHeader>
);

const SourceTableHeaderRow = () => (
  <TableRow className="border-white/10 hover:bg-transparent">
    <Th>Source</Th>
    <Th>Type</Th>
    <Th>Bias</Th>
    <Th>Funding</Th>
    <Th>Country</Th>
    <Th>Status</Th>
    <Th>Articles</Th>
    <Th>Last Checked</Th>
  </TableRow>
);

const Th = ({ children }: Readonly<{ children: ReactNode }>) => (
  <TableHead className="h-8 px-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
    {children}
  </TableHead>
);

const SourceRow = ({ source }: Readonly<{ source: SourceStats }>) => (
  <TableRow className="border-white/5 hover:bg-white/[0.02]">
    <SourceIdentityCell source={source} />
    <TableCell className="px-3 py-2 text-muted-foreground">
      {displaySourceValue(source.category)}
    </TableCell>
    <TableCell className="px-3 py-2 text-muted-foreground">
      {displaySourceValue(source.bias_rating)}
    </TableCell>
    <TableCell className="px-3 py-2 text-muted-foreground">
      {displaySourceValue(source.funding_type)}
    </TableCell>
    <TableCell className="px-3 py-2 text-muted-foreground">
      {displaySourceValue(source.country)}
    </TableCell>
    <TableCell className="px-3 py-2">
      <SourceStatus status={source.status} />
    </TableCell>
    <TableCell className="px-3 py-2 text-foreground">{source.article_count}</TableCell>
    <TableCell className="px-3 py-2 text-muted-foreground">
      {formatCheckedTime(source.last_checked)}
    </TableCell>
  </TableRow>
);

const SourceIdentityCell = ({ source }: Readonly<{ source: SourceStats }>) => (
  <TableCell className="px-3 py-2">
    <SourceIdentity source={source} />
  </TableCell>
);

const SourceIdentity = ({ source }: Readonly<{ source: SourceStats }>) => (
  <div className="flex items-center gap-2">
    <span className="flex h-5 w-5 items-center justify-center rounded border border-white/10 bg-black/40 text-[9px] text-muted-foreground">
      {(source.country || source.name).slice(0, 2).toUpperCase()}
    </span>
    {source.name}
  </div>
);

const SourceStatus = ({ status }: Readonly<{ status: SourceStats["status"] }>) => {
  const statusDetails = {
    error: { className: "text-red-400", label: "Issue" },
    success: { className: "text-emerald-400", label: "Healthy" },
    warning: { className: "text-amber-400", label: "Needs review" },
  }[status] ?? { className: "text-red-400", label: "Issue" };
  return <span className={statusDetails.className}>{statusDetails.label}</span>;
};

const StatCard = ({ label, value }: Readonly<{ label: string; value: string | number }>) => (
  <div className="rounded-xl border border-white/10 bg-black/10 p-3">
    <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
      {label}
    </div>
    <div className="mt-1 text-lg text-foreground">{value}</div>
  </div>
);

const StatGrid = ({ children }: Readonly<{ children: ReactNode }>) => (
  <div className="grid grid-cols-2 gap-3">{children}</div>
);

const PanelTitle = ({ children }: Readonly<{ children: ReactNode }>) => (
  <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
    {children}
  </div>
);

const DataRow = ({ label, value }: Readonly<{ label: string; value: string }>) => (
  <div className="flex items-start justify-between gap-3">
    <span className="text-muted-foreground">{label}</span>
    <span className="max-w-[60%] text-right text-foreground">{value}</span>
  </div>
);

const DataRows = ({ children }: Readonly<{ children: ReactNode }>) => (
  <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
);

export { DataRow, DataRows, PanelTitle, SourcesTable, StatCard, StatGrid };
export { SURFACE_CLASS } from "./source-intelligence-operations-helpers";
