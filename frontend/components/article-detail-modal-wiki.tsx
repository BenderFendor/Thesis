"use client"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ReporterProfilePanel } from "@/components/reporter-profile"
import { SourceResearchPanel } from "@/components/source-research-panel"
import { useCallback } from "react"

interface ModalWikiSheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly tab: "source" | "reporter"
  readonly onTabChange: (tab: "source" | "reporter") => void
  readonly source: string
  readonly reporterName: string
  readonly hasSourceWiki: boolean
  readonly hasReporterWiki: boolean
  readonly articleHost?: string
  readonly articleWikiContext: string
}

interface ModalWikiOverlayProps {
  readonly wikiPanelOpen: boolean
  readonly setWikiPanelOpen: (open: boolean) => void
  readonly wikiPanelTab: "source" | "reporter"
  readonly setWikiPanelTab: (tab: "source" | "reporter") => void
  readonly currentArticle: Readonly<{ readonly source: string }>
  readonly reporterName: string
  readonly hasSourceWiki: boolean
  readonly hasReporterWiki: boolean
  readonly articleHost?: string
  readonly articleWikiContext: string
}

const
 ModalWikiBody = ({
  tab,
  source,
  reporterName,
  articleHost,
  articleWikiContext,
}: Readonly<Pick<ModalWikiSheetProps, "tab" | "source" | "reporterName" | "articleHost" | "articleWikiContext">>) => {
  if (tab === "source") {
    return <SourceResearchPanel sourceName={source} website={articleHost} autoRun />
  }
  if (reporterName !== "") {
    return <ReporterProfilePanel reporterName={reporterName} organization={source} articleContext={articleWikiContext} />
  }
  return (
    <div className="rounded-lg border border-white/10 bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
      Reporter information is not available for this article.
    </div>
  )
 },

 ModalWikiContent = ({
  tab,
  source,
  reporterName,
  articleHost,
  articleWikiContext,
}: Readonly<Pick<ModalWikiSheetProps, "tab" | "source" | "reporterName" | "articleHost" | "articleWikiContext">>) => (
  <div className="flex-1 overflow-y-auto p-4">
    <ModalWikiBody tab={tab} source={source} reporterName={reporterName} articleHost={articleHost} articleWikiContext={articleWikiContext} />
  </div>
 ),

 ModalWikiHeader = ({
  tab,
  onTabChange,
  source,
  reporterName,
  hasSourceWiki,
  hasReporterWiki,
}: Readonly<Pick<ModalWikiSheetProps, "tab" | "onTabChange" | "source" | "reporterName" | "hasSourceWiki" | "hasReporterWiki">>) => (
  <SheetHeader className="border-b border-white/10 px-5 py-4">
    <ModalWikiTitle tab={tab} source={source} reporterName={reporterName} />
    <ModalWikiOpenLink tab={tab} source={source} />
    <ModalWikiTabs tab={tab} hasSourceWiki={hasSourceWiki} hasReporterWiki={hasReporterWiki} onTabChange={onTabChange} />
  </SheetHeader>
 ),

 ModalWikiOpenLink = ({ tab, source }: Readonly<Pick<ModalWikiSheetProps, "tab" | "source">>) => {
  if (tab !== "source") {return false}
  return (
    <Button variant="outline" size="sm" asChild>
      <Link href={`/wiki/source/${encodeURIComponent(source)}`}>Open full wiki</Link>
    </Button>
  )
 },

 ModalWikiOverlay = (props: ModalWikiOverlayProps) => {
  const handleOpenChange = props.setWikiPanelOpen,
   handleTabChange = props.setWikiPanelTab
  return (
    <ModalWikiSheet
      open={props.wikiPanelOpen}
      onOpenChange={handleOpenChange}
      tab={props.wikiPanelTab}
      onTabChange={handleTabChange}
      source={props.currentArticle.source}
      reporterName={props.reporterName}
      hasSourceWiki={props.hasSourceWiki}
      hasReporterWiki={props.hasReporterWiki}
      articleHost={props.articleHost}
      articleWikiContext={props.articleWikiContext}
    />
  )
 },

 ModalWikiSheet = ({
  open,
  onOpenChange,
  tab,
  onTabChange,
  source,
  reporterName,
  hasSourceWiki,
  hasReporterWiki,
  articleHost,
  articleWikiContext,
}: Readonly<ModalWikiSheetProps>) => (
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent className="flex h-full w-full flex-col border-l border-white/10 bg-background p-0 sm:max-w-xl">
      <ModalWikiHeader tab={tab} onTabChange={onTabChange} source={source} reporterName={reporterName} hasSourceWiki={hasSourceWiki} hasReporterWiki={hasReporterWiki} />
      <ModalWikiContent tab={tab} source={source} reporterName={reporterName} articleHost={articleHost} articleWikiContext={articleWikiContext} />
    </SheetContent>
  </Sheet>
 ),

 ModalWikiTabs = ({
  tab,
  hasSourceWiki,
  hasReporterWiki,
  onTabChange,
}: Readonly<Pick<ModalWikiSheetProps, "tab" | "hasSourceWiki" | "hasReporterWiki" | "onTabChange">>) => {
  const handleReporterTabClick = useCallback(() => {
    onTabChange("reporter")
  }, [onTabChange]),
   handleSourceTabClick = useCallback(() => {
    onTabChange("source")
  }, [onTabChange])

  if (!(hasSourceWiki && hasReporterWiki)) {return false}
  return (
    <div className="mt-4 flex items-center gap-2">
      <button type="button" onClick={handleSourceTabClick} className={getWikiTabClassName(tab === "source")}>
        Source
      </button>
      <button type="button" onClick={handleReporterTabClick} className={getWikiTabClassName(tab === "reporter")}>
        Reporter
      </button>
    </div>
  )
 },

 ModalWikiTitle = ({ tab, source, reporterName }: Readonly<Pick<ModalWikiSheetProps, "tab" | "source" | "reporterName">>) => (
  <div>
    <SheetTitle className="font-serif text-xl">{getWikiSheetTitle(tab, source, reporterName)}</SheetTitle>
    <SheetDescription className="mt-1 text-xs">
      Inline wiki preview from cached public-source research with direct links to the full wiki pages.
    </SheetDescription>
  </div>
 ),

 getWikiSheetTitle = (tab: ModalWikiSheetProps["tab"], source: string, reporterName: string): string => {
  if (tab === "source") {return source}
  return reporterName
 },

 getWikiTabClassName = (active: boolean): string => {
  if (active) {
    return "rounded-md border px-3 py-1.5 text-xs font-mono uppercase tracking-[0.18em] transition-colors border-white/20 bg-white/10 text-foreground"
  }
  return "rounded-md border px-3 py-1.5 text-xs font-mono uppercase tracking-[0.18em] transition-colors border-white/10 bg-transparent text-muted-foreground hover:bg-white/5"
 }

export { ModalWikiOverlay, ModalWikiSheet }
