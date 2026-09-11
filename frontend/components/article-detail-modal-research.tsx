import { RelatedArticles } from "@/components/related-articles"
import { SourceResearchPanel } from "@/components/source-research-panel"

interface ArticleDetailResearchLinksProps {
  readonly sourceName: string
  readonly website?: string
  readonly articleId: number
  readonly onArticleClick: (article: Readonly<{ readonly url: string }>) => void
}

const ArticleDetailResearchLinks = ({ sourceName, website, articleId, onArticleClick }: ArticleDetailResearchLinksProps) => (
  <>
    <SourceResearchPanel sourceName={sourceName} website={website} />
    <RelatedArticles articleId={articleId} onArticleClick={onArticleClick} limit={5} />
  </>
)

export { ArticleDetailResearchLinks }
