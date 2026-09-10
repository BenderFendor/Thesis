import { Bug, ExternalLink, Globe, MapPin, Newspaper } from "lucide-react";
import Link from "next/link";
import { SourceResearchPanel } from "@/components/source-research-panel";
import { Button } from "@/components/ui/button";
import type { ReadonlySourcePageSource } from "./source-page-types";

interface SourceSidebarProps {
  readonly source: ReadonlySourcePageSource;
  readonly websiteHostname?: string;
  readonly debugMode: boolean;
}

const SourceOrigin = ({ country }: Readonly<{ country: string }>) => (
  <div className="grid grid-cols-[70px_1fr] gap-2 text-sm">
    <span className="text-muted-foreground text-xs flex items-center gap-1.5">
      <MapPin className="w-3 h-3" />
      Origin
    </span>
    <span className="text-foreground text-xs">{country}</span>
  </div>
);

const SourceLanguage = ({ language }: Readonly<{ language: string }>) => (
  <div className="grid grid-cols-[70px_1fr] gap-2 text-sm">
    <span className="text-muted-foreground text-xs flex items-center gap-1.5">
      <Globe className="w-3 h-3" />
      Lang
    </span>
    <span className="uppercase text-foreground text-xs">{language}</span>
  </div>
);

const SourceCategoryTags = ({ categories }: Readonly<{ categories: readonly string[] }>) => (
  <span className="flex flex-wrap gap-1">
    {categories.slice(0, 3).map((category) => (
      <span
        key={category}
        className="inline-flex items-center rounded-sm bg-white/5 px-1.5 py-0.5 text-[9px] text-muted-foreground"
      >
        {category}
      </span>
    ))}
  </span>
);

const SourceCategories = ({ categories }: Readonly<{ categories: readonly string[] }>) => {
  if (categories.length === 0) {
    return null;
  }
  return (
    <div className="grid grid-cols-[70px_1fr] gap-2 text-sm">
      <span className="text-muted-foreground text-xs flex items-center gap-1.5">
        <Newspaper className="w-3 h-3" />
        Focus
      </span>
      <SourceCategoryTags categories={categories} />
    </div>
  );
};

const SourceOverviewRows = ({ source }: Readonly<Pick<SourceSidebarProps, "source">>) => (
  <div className="space-y-3">
    <SourceOrigin country={source.country} />
    <SourceLanguage language={source.language} />
    <SourceCategories categories={source.category} />
  </div>
);

const SourceSiteAnchor = ({ source }: Readonly<Pick<SourceSidebarProps, "source">>) => (
  <a href={source.url} target="_blank" rel="noopener noreferrer">
    <ExternalLink className="w-3 h-3 mr-1" />
    Site
  </a>
);

const SourceSiteButton = ({ source }: Readonly<Pick<SourceSidebarProps, "source">>) => (
  <Button
    asChild
    variant="outline"
    size="sm"
    className="justify-center border-white/10 bg-transparent hover:bg-white/5 text-[9px] h-7"
  >
    <SourceSiteAnchor source={source} />
  </Button>
);

const SourceDebugAnchor = ({ source }: Readonly<Pick<SourceSidebarProps, "source">>) => (
  <Link href={`/sources/${encodeURIComponent(source.name)}/debug`}>
    <Bug className="w-3 h-3 mr-1" />
    Debug
  </Link>
);

const SourceDebugButton = ({ source }: Readonly<Pick<SourceSidebarProps, "source">>) => (
  <Button
    asChild
    variant="outline"
    size="sm"
    className="justify-center border-white/10 bg-transparent hover:bg-white/5 text-[9px] h-7"
  >
    <SourceDebugAnchor source={source} />
  </Button>
);

const SourceExternalLinks = ({
  source,
  debugMode,
}: Readonly<Pick<SourceSidebarProps, "source" | "debugMode">>) => (
  <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-white/10">
    <SourceSiteButton source={source} />
    {debugMode && <SourceDebugButton source={source} />}
  </div>
);

const SourceOverviewCard = ({
  source,
  debugMode,
}: Readonly<Pick<SourceSidebarProps, "source" | "debugMode">>) => (
  <div className="rounded-lg border border-white/10 bg-[var(--news-bg-secondary)] p-4 shrink-0">
    <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground block mb-3">
      Overview
    </span>
    <SourceOverviewRows source={source} />
    <SourceExternalLinks source={source} debugMode={debugMode} />
  </div>
);

const SourceSidebar = ({ source, websiteHostname, debugMode }: Readonly<SourceSidebarProps>) => (
  <div className="lg:col-span-3">
    <div className="sticky top-20 flex flex-col gap-4 max-h-[calc(100vh-6rem)] overflow-hidden">
      <SourceOverviewCard source={source} debugMode={debugMode} />
      <SourceResearchPanelFrame source={source} websiteHostname={websiteHostname} />
    </div>
  </div>
);

const SourceResearchPanelFrame = ({
  source,
  websiteHostname,
}: Readonly<{
  readonly source: ReadonlySourcePageSource;
  readonly websiteHostname?: string;
}>) => (
  <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-white/10 bg-[var(--news-bg-secondary)]">
    <SourceResearchPanel sourceName={source.name} website={websiteHostname} />
  </div>
);

export { SourceSidebar };
