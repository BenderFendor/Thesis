"use client"

import { BookOpen, Link as LinkIcon, Maximize2, Minimize2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import type { NewsArticle } from "../lib/article-detail-modal-data"
import type { RefObject } from "react"
import { motion } from "framer-motion"
import { useCallback } from "react"

type ArticleNavigationDirection = "prev" | "next"

type ModalHeroDetailsProps = Readonly<{
  article: NewsArticle
  layoutIdPrefix?: string
  reporterName: string
  onOpenSourceWiki: () => void
  onOpenReporterWiki: () => void
  onClose: () => void
  isExpanded: boolean
}>

type NavigationClickEvent = Readonly<{
  currentTarget: Readonly<{ dataset: Readonly<{ direction?: string }> }>
}>

type PropagationClickEvent = Readonly<{ stopPropagation: () => void }>

const EMPTY_COUNT = 0,
  MAX_AUTHOR_NAMES = 2,

  ModalArticleNavigation = ({
    onNavigate,
    onArticleNavigate,
  }: Readonly<{
    onNavigate?: (direction: ArticleNavigationDirection) => void
    onArticleNavigate: (direction: ArticleNavigationDirection) => void
  }>) => {
    const handleNavigationClick = useCallback((event: NavigationClickEvent): void => {
      const { direction } = event.currentTarget.dataset
      if (direction === "prev" || direction === "next") {onArticleNavigate(direction)}
    }, [onArticleNavigate])
    if (onNavigate === undefined) {return <div className="flex-1" />}
    return (
      <div className="flex flex-1 items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleNavigationClick}
          data-direction="prev"
          className="rounded-md border border-border/40 bg-card/60 px-4 text-xs uppercase tracking-wider text-foreground transition-all duration-300 ease-out hover:bg-card active:scale-95"
          title="Previous (ArrowLeft)"
        >
          Prev
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleNavigationClick}
          data-direction="next"
          className="rounded-md border border-border/40 bg-card/60 px-4 text-xs uppercase tracking-wider text-foreground transition-all duration-300 ease-out hover:bg-card active:scale-95"
          title="Next (ArrowRight)"
        >
          Next
        </Button>
      </div>
    )
  },

  ModalExpandIcon = ({ isExpanded }: Readonly<{ isExpanded: boolean }>) => {
    if (isExpanded) {return <Minimize2 className="h-4 w-4" />}
    return <Maximize2 className="h-4 w-4" />
  },

  ModalHeaderClose = ({ onClose }: Readonly<{ onClose: () => void }>) => (
    <div className="flex flex-1 items-center justify-end">
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="h-9 w-9 rounded-md border border-border/40 bg-card/60 text-foreground transition-all duration-300 ease-out hover:bg-card active:scale-95"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  ),

  ModalHeaderControls = ({
    onNavigate,
    onArticleNavigate,
    isExpanded,
    onToggleExpanded,
    onClose,
  }: Readonly<{
    onNavigate?: (direction: ArticleNavigationDirection) => void
    onArticleNavigate: (direction: ArticleNavigationDirection) => void
    isExpanded: boolean
    onToggleExpanded: () => void
    onClose: () => void
  }>) => (
    <div className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-border/40 bg-background/75 p-4 backdrop-blur-xl">
      <ModalArticleNavigation onNavigate={onNavigate} onArticleNavigate={onArticleNavigate} />
      <ModalHeaderExpand isExpanded={isExpanded} onToggleExpanded={onToggleExpanded} />
      <ModalHeaderClose onClose={onClose} />
    </div>
  ),

  ModalHeaderExpand = ({
    isExpanded,
    onToggleExpanded,
  }: Readonly<{ isExpanded: boolean; onToggleExpanded: () => void }>) => (
    <div className="flex flex-1 items-center justify-center">
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleExpanded}
        className="h-9 w-9 rounded-md border border-border/40 bg-card/60 text-foreground transition-all duration-300 ease-out hover:bg-card active:scale-95"
      >
        <ModalExpandIcon isExpanded={isExpanded} />
      </Button>
    </div>
  ),

  ModalHero = ({
    article,
    isExpanded,
    layoutIdPrefix,
    reporterName,
    onOpenSourceWiki,
    onOpenReporterWiki,
    onClose,
  }: ModalHeroDetailsProps) => {
    const heroImage = getHeroImage(article.image)
    return (
      <div className={getModalHeroClassName(isExpanded, heroImage !== undefined)}>
        <ModalHeroVisual image={heroImage} />
        <ModalHeroContent
          article={article}
          isExpanded={isExpanded}
          layoutIdPrefix={layoutIdPrefix}
          reporterName={reporterName}
          onOpenSourceWiki={onOpenSourceWiki}
          onOpenReporterWiki={onOpenReporterWiki}
          onClose={onClose}
        />
      </div>
    )
  },

  ModalHeroAuthors = ({ article, reporterName }: Readonly<{ article: NewsArticle; reporterName: string }>) => {
    if (reporterName !== "" || article.authors === undefined || article.authors.length === EMPTY_COUNT) {return false}
    return (
      <>
        <span>•</span>
        <span className="text-xs text-foreground/80">{article.authors.slice(EMPTY_COUNT, MAX_AUTHOR_NAMES).join(", ")}</span>
      </>
    )
  },

  ModalHeroBadges = ({ article }: Readonly<{ article: NewsArticle }>) => (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <Badge className={getCredibilityColor(article.credibility)}>
        {article.credibility.toUpperCase()} CREDIBILITY
      </Badge>
      <Badge className={getBiasColor(article.bias)}>{article.bias.toUpperCase()} BIAS</Badge>
      <ModalHeroCategory category={article.category} />
    </div>
  ),

  ModalHeroCategory = ({ category }: Readonly<{ category?: string }>) => {
    if (category === undefined || category === "") {return false}
    return <Badge variant="outline" className="text-xs uppercase">{category}</Badge>
  },

  ModalHeroContent = (props: ModalHeroDetailsProps) => (
    <div className="absolute inset-0 flex flex-col justify-end">
      <ModalHeroDetails
        article={props.article}
        isExpanded={props.isExpanded}
        layoutIdPrefix={props.layoutIdPrefix}
        reporterName={props.reporterName}
        onOpenSourceWiki={props.onOpenSourceWiki}
        onOpenReporterWiki={props.onOpenReporterWiki}
        onClose={props.onClose}
      />
    </div>
  ),

  ModalHeroDetails = ({
    article,
    isExpanded,
    layoutIdPrefix,
    reporterName,
    onOpenSourceWiki,
    onOpenReporterWiki,
    onClose,
  }: ModalHeroDetailsProps) => (
    <div className="mx-auto w-full max-w-6xl px-6 pb-10 md:px-8 md:pb-12">
      <ModalHeroBadges article={article} />
      <motion.h1
        layoutId={getModalHeroLayoutId(layoutIdPrefix, article.id, "title")}
        className={getModalHeroTitleClassName(isExpanded)}
      >
        {article.title}
      </motion.h1>
      <ModalHeroMeta
        article={article}
        reporterName={reporterName}
        onOpenSourceWiki={onOpenSourceWiki}
        onOpenReporterWiki={onOpenReporterWiki}
        onClose={onClose}
      />
    </div>
  ),

  ModalHeroMeta = ({
    article,
    reporterName,
    onOpenSourceWiki,
    onOpenReporterWiki,
    onClose,
  }: Readonly<{
    article: NewsArticle
    reporterName: string
    onOpenSourceWiki: () => void
    onOpenReporterWiki: () => void
    onClose: () => void
  }>) => (
    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
      <ModalHeroSourceLinks article={article} onOpenSourceWiki={onOpenSourceWiki} onClose={onClose} />
      <ModalHeroReporter reporterName={reporterName} onOpenReporterWiki={onOpenReporterWiki} onClose={onClose} />
      <ModalHeroAuthors article={article} reporterName={reporterName} />
      <span>•</span>
      <span>{formatDate(article.publishedAt)}</span>
      <span>•</span>
      <span>{article.country}</span>
      <ModalHeroTranslation article={article} />
    </div>
  ),

  ModalHeroReporter = ({
    reporterName,
    onOpenReporterWiki,
    onClose,
  }: Readonly<{
    reporterName: string
    onOpenReporterWiki: () => void
    onClose: () => void
  }>) => {
    const handleCloseLinkClick = useCallback((event: PropagationClickEvent): void => {
      event.stopPropagation()
      onClose()
    }, [onClose]),
      handleReporterClick = useCallback((event: PropagationClickEvent): void => {
        event.stopPropagation()
        onOpenReporterWiki()
      }, [onOpenReporterWiki])
    if (reporterName === "") {return false}
    return (
      <>
        <span>•</span>
        <button
          type="button"
          className="transition-colors hover:text-primary hover:underline"
          onClick={handleReporterClick}
          title="Open reporter wiki preview"
        >
          Reporter: {reporterName}
        </button>
        <Link
          href={`/wiki/reporters?search=${encodeURIComponent(reporterName)}`}
          className="text-muted-foreground transition-colors hover:text-primary"
          onClick={handleCloseLinkClick}
          title="Search reporter in wiki"
        >
          <BookOpen className="h-3.5 w-3.5" />
        </Link>
      </>
    )
  },

  ModalHeroSourceLinks = ({
    article,
    onOpenSourceWiki,
    onClose,
  }: Readonly<{
    article: NewsArticle
    onOpenSourceWiki: () => void
    onClose: () => void
  }>) => {
    const handleCloseLinkClick = useCallback((event: PropagationClickEvent): void => {
      event.stopPropagation()
      onClose()
      }, [onClose]),
      handleSourceClick = useCallback((event: PropagationClickEvent): void => {
        event.stopPropagation()
        onOpenSourceWiki()
      }, [onOpenSourceWiki])
    return (
      <>
        <button
          type="button"
          onClick={handleSourceClick}
          className="font-medium transition-colors hover:text-primary hover:underline"
        >
          {article.source}
        </button>
        <Link
          href={`/source/${encodeURIComponent(article.sourceId)}`}
          className="text-muted-foreground transition-colors hover:text-primary"
          onClick={handleCloseLinkClick}
          title="Open source page"
        >
          <LinkIcon className="h-3.5 w-3.5" />
        </Link>
        <Link
          href={`/wiki/source/${encodeURIComponent(article.source)}`}
          className="text-muted-foreground transition-colors hover:text-primary"
          onClick={handleCloseLinkClick}
          title="View wiki profile"
        >
          <BookOpen className="h-3.5 w-3.5" />
        </Link>
      </>
    )
  },

  ModalHeroTranslation = ({ article }: Readonly<{ article: NewsArticle }>) => {
    if (!article.translated) {return false}
    return (
      <>
        <span>•</span>
        <Badge variant="outline" className="text-xs">Translated from {article.originalLanguage.toUpperCase()}</Badge>
      </>
    )
  },

  ModalHeroVisual = ({ image }: Readonly<{ image: string | undefined }>) => {
    if (image === undefined) {return <div className="editorial-modal-fallback absolute inset-0" />}
    return (
      <>
        <motion.img src={image} alt="" className="h-full w-full object-cover opacity-70" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
      </>
    )
  },

  ModalProgressRail = ({
    trackRef,
    progress,
  }: Readonly<{
    trackRef: Readonly<RefObject<HTMLDivElement | null>>
    progress: number
  }>) => {
    const progressStyle = getProgressStyle(progress)
    return (
      <div
        ref={trackRef}
        role="scrollbar"
        aria-label="Article reading progress"
        aria-controls="article-detail-scroll-region"
        aria-valuemin={0}
        aria-valuemax={PROGRESS_MAX}
        aria-valuenow={Math.round(progress * PROGRESS_MAX)}
        className="absolute inset-y-24 right-2 z-10 hidden w-3 cursor-row-resize rounded-full bg-white/5 lg:block"
      >
        <div
          className="pointer-events-none w-full rounded-full bg-primary/80 transition-[height] duration-150"
          style={progressStyle}
        />
      </div>
    )
  },

  ModalSummaryQuote = ({ summary, isExpanded }: Readonly<{ summary: string; isExpanded: boolean }>) => (
    <div className={getSummaryClassName(isExpanded)}>
      <p className={`text-foreground/80 leading-relaxed italic ${getSummaryTextClassName(isExpanded)}`}>
        {summary}
      </p>
    </div>
  ),

  PROGRESS_MAX = 100,
  PROGRESS_MINIMUM_HEIGHT = 8,

  formatDate = (date: string): string => {
    const parsed = new Date(date)
    if (Number.isNaN(parsed.getTime())) {return date}
    return parsed.toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })
  },

  getBiasColor = (bias: string): string => {
    switch (bias) {
      case "left": {return "bg-blue-500/20 text-blue-400 border-blue-500/30"}
      case "center": {return "bg-gray-500/20 text-gray-400 border-gray-500/30"}
      case "right": {return "bg-red-500/20 text-red-400 border-red-500/30"}
      default: {return "bg-gray-500/20 text-gray-400 border-gray-500/30"}
    }
  },

  getCredibilityColor = (credibility: string): string => {
    switch (credibility) {
      case "high": {return "bg-primary/15 text-primary border-primary/30"}
      case "medium": {return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"}
      case "low": {return "bg-red-500/20 text-red-400 border-red-500/30"}
      default: {return "bg-gray-500/20 text-gray-400 border-gray-500/30"}
    }
  },

  getHeroImage = (src?: string): string | undefined => {
    if (hasRealImage(src)) {return src}
    return undefined
  },

  getModalHeroClassName = (isExpanded: boolean, hasImage: boolean): string => {
    const classes = ["relative", "overflow-hidden"]
    if (isExpanded) {classes.push("min-h-96 h-[60vh]")}
    if (!isExpanded) {classes.push("h-56")}
    if (hasImage) {classes.push("bg-card")}
    if (!hasImage) {classes.push("editorial-modal-fallback")}
    return classes.join(" ")
  },

  getModalHeroLayoutId = (
    layoutIdPrefix: string | undefined,
    articleId: number,
    suffix: string,
  ): string | undefined => {
    if (layoutIdPrefix === undefined) {return undefined}
    return `${layoutIdPrefix}-${suffix}-${articleId}`
  },

  getModalHeroTitleClassName = (isExpanded: boolean): string => {
    if (isExpanded) {return "mb-6 font-serif text-4xl leading-tight text-foreground md:text-6xl"}
    return "mb-6 font-serif text-2xl leading-tight text-foreground md:text-4xl"
  },

  getProgressStyle = (progress: number) => ({
    height: `${Math.max(progress * PROGRESS_MAX, PROGRESS_MINIMUM_HEIGHT)}%`,
  }),

  getSummaryClassName = (isExpanded: boolean): string => {
    if (isExpanded) {return "mb-12 border-l-4 border-primary bg-card/50 px-6 py-4"}
    return "mb-8 border-l-4 border-primary bg-card/50 px-5 py-4"
  },

  getSummaryTextClassName = (isExpanded: boolean): string => {
    if (isExpanded) {return "text-2xl"}
    return "text-lg"
  },

  hasRealImage = (src?: string): boolean => {
    const normalized = src?.trim().toLowerCase()
    return normalized !== undefined && normalized !== "" && normalized !== "none" &&
      !normalized.includes("/placeholder.svg") && !normalized.includes("/placeholder.jpg")
  }

export {
  ModalHeaderControls,
  ModalHero,
  ModalProgressRail,
  ModalSummaryQuote,
  formatDate,
}

export { ModalArticleReader } from "./article-detail-modal-reader"
