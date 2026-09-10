"use client";

import { useCallback, useMemo } from "react";
import { BookOpen, GitBranch, Search, Users, X } from "lucide-react";
import { AddRssDialog } from "@/components/add-rss-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SourceCoverageComparison } from "@/components/source-coverage-comparison";
import { NEWS_LENSES } from "@/lib/news-lens";
import type { NewsLensId } from "@/lib/news-lens";
import Link from "next/link";

const COVERAGE_COMPARISON_MIN_SOURCES = 2;

const getLensButtonClassName = (active: boolean): string => {
  if (active) {
    return "border-primary/60 bg-primary/10 text-foreground";
  }
  return "border-white/10 bg-[var(--news-bg-primary)]/40 text-muted-foreground hover:text-foreground";
};

const SourceSidebarHeader = ({
  onClose,
  onSourceAdded,
}: Readonly<{
  onClose: () => void;
  onSourceAdded: () => void;
}>) => (
  <div className="flex items-center justify-between border-b border-white/10 p-4">
    <h2 className="text-sm font-mono uppercase tracking-[0.3em] text-muted-foreground">Sources</h2>
    <SourceSidebarHeaderActions onClose={onClose} onSourceAdded={onSourceAdded} />
  </div>
);

const SourceSidebarHeaderActions = ({
  onClose,
  onSourceAdded,
}: Readonly<{
  onClose: () => void;
  onSourceAdded: () => void;
}>) => (
  <div className="flex items-center gap-2">
    <AddRssDialog onSourceAdded={onSourceAdded} />
    <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-md">
      <X className="h-4 w-4" />
    </Button>
  </div>
);

const ActiveFilterBadge = ({
  active,
  label,
  onClear,
}: Readonly<{
  active: boolean;
  label: string;
  onClear: () => void;
}>) => {
  if (!active) {
    return null;
  }
  return (
    <div className="px-4 pb-1 pt-2">
      <Badge
        variant="outline"
        className="cursor-pointer border-white/10 bg-white/5 text-[10px] font-mono uppercase tracking-[0.3em] text-foreground/80"
        onClick={onClear}
      >
        {label}
      </Badge>
    </div>
  );
};

const CoverageSection = ({
  selectedSourceIds,
  sourceNameLookup,
}: Readonly<{
  selectedSourceIds: readonly string[];
  sourceNameLookup: Readonly<Record<string, string>>;
}>) => {
  const sourceIds = useMemo(() => [...selectedSourceIds], [selectedSourceIds]);
  if (selectedSourceIds.length < COVERAGE_COMPARISON_MIN_SOURCES) {
    return null;
  }
  return (
    <div className="border-b border-white/10 px-4 py-3">
      <SourceCoverageComparison sourceIds={sourceIds} sourceNames={sourceNameLookup} />
    </div>
  );
};

const SourceSearch = ({
  onChange,
  searchQuery,
}: Readonly<{
  onChange: (value: string) => void;
  searchQuery: string;
}>) => {
  const handleChange = useCallback<React.ChangeEventHandler<HTMLInputElement>>(
    (event) => {
      onChange(event.target.value);
    },
    [onChange],
  );
  return (
    <div className="border-b border-white/10 px-4 py-3">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search sources..."
          value={searchQuery}
          onChange={handleChange}
          className="h-9 rounded-md border-white/10 bg-[var(--news-bg-primary)] pl-8 text-foreground"
        />
      </div>
    </div>
  );
};

const LensButton = ({
  lens,
  onSetLens,
  preset,
}: Readonly<{
  lens: NewsLensId;
  onSetLens: (lens: NewsLensId) => void;
  preset: Readonly<(typeof NEWS_LENSES)[number]>;
}>) => {
  const handleClick = useCallback(() => {
    onSetLens(preset.id);
  }, [onSetLens, preset.id]);
  return (
    <button
      type="button"
      onClick={handleClick}
      title={preset.description}
      className={`rounded-md border px-2 py-2 text-left text-[10px] font-mono uppercase tracking-[0.16em] transition-colors ${getLensButtonClassName(lens === preset.id)}`}
    >
      {preset.label}
    </button>
  );
};

const LensSection = ({
  lens,
  onSetLens,
}: Readonly<{
  lens: NewsLensId;
  onSetLens: (lens: NewsLensId) => void;
}>) => (
  <div className="border-b border-white/10 px-4 py-3">
    <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground">
      News Lens
    </div>
    <div className="grid grid-cols-2 gap-1.5">
      {NEWS_LENSES.map((preset) => (
        <LensButton key={preset.id} lens={lens} onSetLens={onSetLens} preset={preset} />
      ))}
    </div>
  </div>
);

const WikiLink = ({
  href,
  icon,
  label,
  onClose,
}: Readonly<{
  href: string;
  icon: "book" | "users" | "graph";
  label: string;
  onClose: () => void;
}>) => {
  const Icon = { book: BookOpen, graph: GitBranch, users: Users }[icon];
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-md border border-white/10 bg-[var(--news-bg-primary)]/40 px-3 py-2 text-sm text-foreground transition-colors hover:bg-[var(--news-bg-primary)]"
      onClick={onClose}
    >
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {label}
      </span>
    </Link>
  );
};

const WikiSection = ({ onClose }: Readonly<{ onClose: () => void }>) => (
  <div className="border-b border-white/10 px-4 py-3">
    <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground">
      Wiki
    </div>
    <div className="space-y-2">
      <WikiLink href="/wiki/ownership" icon="book" label="Source Wiki" onClose={onClose} />
      <WikiLink href="/wiki/reporters" icon="users" label="Reporter Wiki" onClose={onClose} />
      <WikiLink href="/wiki/ownership" icon="graph" label="Ownership Graph" onClose={onClose} />
    </div>
  </div>
);

export {
  ActiveFilterBadge,
  CoverageSection,
  LensSection,
  SourceSearch,
  SourceSidebarHeader,
  WikiSection,
};
