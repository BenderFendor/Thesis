interface ArticleCore {
  id: string
  title: string
  source: string
  sourceId: string
  url: string
  summary?: string
  publishedAt: string
  imageUrl?: string
  author?: string
  category?: string
}

interface SourceCore {
  id: string
  name: string
  category?: string
  country?: string
  biasRating?: string
  fundingType?: string
  ownershipLabel?: string
}

interface ClusterCore {
  id: string
  topic: string
  articles: ArticleCore[]
  dominantSource?: string
  articleCount: number
}

interface QueuedItem {
  id: string
  url: string
  title: string
  source: string
  addedAt: string
}

interface HighlightCore {
  id: string
  articleId: string
  text: string
  note?: string
  createdAt: string
}

export type {
  ArticleCore,
  ClusterCore,
  HighlightCore,
  QueuedItem,
  SourceCore,
}
