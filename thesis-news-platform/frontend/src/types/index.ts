export interface NewsArticle {
  title: string;
  link: string;
  description: string;
  published: string;
  source: string;
  category: string;
}

export interface NewsResponse {
  articles: NewsArticle[];
  total: number;
  sources: string[];
}

export interface SourceInfo {
  name: string;
  url: string;
  category: string;
  country: string;
  funding_type?: string;
  bias_rating?: string;
}

export type Category = 'general' | 'politics' | 'technology' | 'sports' | 'business' | 'entertainment';
