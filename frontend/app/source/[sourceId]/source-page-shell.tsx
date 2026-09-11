import { AlertTriangle, ArrowLeft } from "lucide-react";
import { ArticleDetailModal } from "@/components/article-detail-modal";
import { Button } from "@/components/ui/button";
import { SourceCoverage } from "./source-page-coverage";
import { getSourceErrorMessage } from "./source-page-helpers";
import { SourceHeader } from "./source-page-header";
import { SourceSidebar } from "./source-page-sidebar";
import type { SourcePageLayoutProps } from "./source-page-types";

type SourcePageMainProps = Pick<
  SourcePageLayoutProps,
  "articles" | "articlesLoading" | "debugMode" | "onArticleClick" | "source" | "websiteHostname"
>;

const SourcePageGrid = ({
  source,
  websiteHostname,
  debugMode,
  articles,
  articlesLoading,
  onArticleClick,
}: Readonly<SourcePageMainProps>) => (
  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
    <SourceSidebar source={source} websiteHostname={websiteHostname} debugMode={debugMode} />
    <SourceCoverage
      articles={articles}
      articlesLoading={articlesLoading}
      onArticleClick={onArticleClick}
    />
  </div>
);

const SourcePageMain = (props: Readonly<SourcePageMainProps>) => (
  <main className="flex-1 max-w-[1600px] mx-auto w-full px-6 py-6">
    <SourcePageGrid
      articles={props.articles}
      articlesLoading={props.articlesLoading}
      debugMode={props.debugMode}
      onArticleClick={props.onArticleClick}
      source={props.source}
      websiteHostname={props.websiteHostname}
    />
  </main>
);

const SourcePageLoading = () => (
  <div className="min-h-screen bg-[var(--news-bg-primary)] flex items-center justify-center">
    <div className="flex flex-col items-center gap-4 text-foreground animate-in fade-in duration-500">
      <div className="h-px w-24 bg-gradient-to-r from-transparent via-primary/50 to-transparent animate-pulse" />
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
        Loading Source
      </div>
    </div>
  </div>
);

const SourcePageError = ({
  hasError,
  onBack,
}: Readonly<{ hasError: boolean; onBack: () => void }>) => (
  <div className="min-h-screen bg-[var(--news-bg-primary)] flex flex-col items-center justify-center gap-6">
    <div className="p-4 rounded-full bg-yellow-500/10 border border-yellow-500/20">
      <AlertTriangle className="w-6 h-6 text-yellow-500" />
    </div>
    <div className="text-center space-y-2">
      <p className="font-serif text-xl text-foreground">Source Unavailable</p>
      <p className="text-sm text-muted-foreground font-mono">{getSourceErrorMessage(hasError)}</p>
    </div>
    <Button
      variant="outline"
      onClick={onBack}
      className="border-white/10 bg-transparent hover:bg-white/5 text-[10px] font-mono uppercase tracking-[0.3em]"
    >
      <ArrowLeft className="w-3 h-3 mr-2" />
      Return
    </Button>
  </div>
);

const SourcePageLayout = (props: Readonly<SourcePageLayoutProps>) => (
  <div className="min-h-screen bg-[var(--news-bg-primary)] text-foreground flex flex-col">
    <SourceHeader
      source={props.source}
      isFavorite={props.isFavorite}
      toggleFavorite={props.toggleFavorite}
      onBack={props.onBack}
    />
    <SourcePageMain
      articles={props.articles}
      articlesLoading={props.articlesLoading}
      debugMode={props.debugMode}
      onArticleClick={props.onArticleClick}
      source={props.source}
      websiteHostname={props.websiteHostname}
    />
    <ArticleDetailModal
      article={props.selectedArticle}
      isOpen={props.modalOpen}
      onClose={props.onCloseModal}
    />
  </div>
);

export { SourcePageError, SourcePageLayout, SourcePageLoading };
