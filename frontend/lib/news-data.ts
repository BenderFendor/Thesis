// Mock RSS feed data structure
export interface NewsSource {
  id: string
  name: string
  country: string
  url: string
  rssUrl: string
  credibility: "high" | "medium" | "low"
  bias: "left" | "center" | "right"
  category: string[]
  language: string
  funding: string[]
}

export interface NewsArticle {
  id: number
  title: string
  source: string
  sourceId: string
  country: string
  credibility: "high" | "medium" | "low"
  bias: "left" | "center" | "right"
  summary: string
  content?: string
  image: string
  publishedAt: string
  category: string
  url: string
  likes: number
  comments: number
  shares: number
  tags: string[]
  originalLanguage: string
  translated: boolean
}

// Mock RSS news sources
export const newsSources: NewsSource[] = [
  {
    id: "reuters",
    name: "Reuters",
    country: "United States",
    url: "https://reuters.com",
    rssUrl: "https://feeds.reuters.com/reuters/topNews",
    credibility: "high",
    bias: "center",
    category: ["politics", "economy", "world"],
    language: "en",
    funding: ["Thomson Reuters Corporation", "Subscription Revenue", "Financial Data Services"],
  },
  {
    id: "bbc",
    name: "BBC News",
    country: "United Kingdom",
    url: "https://bbc.com/news",
    rssUrl: "http://feeds.bbci.co.uk/news/rss.xml",
    credibility: "high",
    bias: "center",
    category: ["politics", "world", "technology"],
    language: "en",
    funding: ["BBC License Fee", "UK Government Funding", "Public Broadcasting"],
  },
  {
    id: "rfa",
    name: "Radio Free Asia",
    country: "United States",
    url: "https://rfa.org",
    rssUrl: "https://www.rfa.org/english/rss2.xml",
    credibility: "medium",
    bias: "center",
    category: ["politics", "world", "human-rights"],
    language: "en",
    funding: ["U.S. Government", "Broadcasting Board of Governors", "Federal Appropriations"],
  },
  {
    id: "dw",
    name: "Deutsche Welle",
    country: "Germany",
    url: "https://dw.com",
    rssUrl: "https://rss.dw.com/xml/rss-en-all",
    credibility: "high",
    bias: "center",
    category: ["politics", "economy", "world"],
    language: "en",
    funding: ["German Government", "Public Broadcasting", "Federal Budget"],
  },
  {
    id: "propublica",
    name: "ProPublica",
    country: "United States",
    url: "https://propublica.org",
    rssUrl: "https://feeds.propublica.org/propublica/main",
    credibility: "high",
    bias: "center",
    category: ["politics", "investigations", "accountability"],
    language: "en",
    funding: ["Private Donations", "Sandler Foundation", "Independent Journalism"],
  },
  {
    id: "nhk",
    name: "NHK World",
    country: "Japan",
    url: "https://nhk.or.jp",
    rssUrl: "https://www3.nhk.or.jp/rss/news/cat0.xml",
    credibility: "high",
    bias: "center",
    category: ["technology", "politics", "world"],
    language: "en",
    funding: ["NHK License Fee", "Public Broadcasting", "Japanese Government"],
  },
  {
    id: "lemonde",
    name: "Le Monde",
    country: "France",
    url: "https://lemonde.fr",
    rssUrl: "https://www.lemonde.fr/rss/une.xml",
    credibility: "high",
    bias: "center",
    category: ["politics", "world", "culture"],
    language: "fr",
    funding: ["Subscription Revenue", "Private Investment", "Advertising"],
  },
  {
    id: "folha",
    name: "Folha de S.Paulo",
    country: "Brazil",
    url: "https://folha.uol.com.br",
    rssUrl: "https://feeds.folha.uol.com.br/poder/rss091.xml",
    credibility: "high",
    bias: "center",
    category: ["politics", "environment", "world"],
    language: "pt",
    funding: ["Subscription Revenue", "Advertising", "Private Ownership"],
  },
  {
    id: "thehindu",
    name: "The Hindu",
    country: "India",
    url: "https://thehindu.com",
    rssUrl: "https://www.thehindu.com/news/national/feeder/default.rss",
    credibility: "high",
    bias: "center",
    category: ["politics", "technology", "world"],
    language: "en",
    funding: ["Subscription Revenue", "Advertising", "Private Ownership"],
  },
  {
    id: "abc-au",
    name: "ABC News Australia",
    country: "Australia",
    url: "https://abc.net.au/news",
    rssUrl: "https://www.abc.net.au/news/feed/51120/rss.xml",
    credibility: "high",
    bias: "center",
    category: ["politics", "environment", "world"],
    language: "en",
    funding: ["Australian Government", "Public Broadcasting", "Federal Budget"],
  },
  {
    id: "xinhua",
    name: "Xinhua News",
    country: "China",
    url: "https://xinhuanet.com",
    rssUrl: "http://www.xinhuanet.com/english/rss/worldrss.xml",
    credibility: "medium",
    bias: "left",
    category: ["politics", "economy", "world"],
    language: "en",
    funding: ["Chinese Government", "State Media", "Communist Party of China"],
  },
  {
    id: "rt",
    name: "RT",
    country: "Russia",
    url: "https://rt.com",
    rssUrl: "https://www.rt.com/rss/",
    credibility: "medium",
    bias: "right",
    category: ["politics", "world", "energy"],
    language: "en",
    funding: ["Russian Government", "State Media", "Federal Budget"],
  },
]

// Mock RSS feed articles
export const mockNewsArticles: NewsArticle[] = [
  {
    id: 1,
    title: "Congressional Budget Negotiations Continue as Deadline Approaches",
    source: "Reuters",
    sourceId: "reuters",
    country: "United States",
    credibility: "high",
    bias: "center",
    summary: "Lawmakers work to reach agreement on federal spending as government shutdown looms...",
    content:
      "Lawmakers are working around the clock to reach an agreement on federal spending as the government shutdown deadline looms. The negotiations have intensified with both parties making concessions on key issues including infrastructure spending, healthcare funding, and defense allocations. Sources close to the talks suggest that a breakthrough could come within the next 48 hours, though significant challenges remain on contentious issues such as immigration policy and climate change initiatives.",
    image: "/us-capitol-building.jpg",
    publishedAt: "2 hours ago",
    category: "Politics",
    url: "https://reuters.com/article/us-congress-budget",
    likes: 1247,
    comments: 89,
    shares: 156,
    tags: ["congress", "budget", "government", "politics"],
    originalLanguage: "en",
    translated: false,
  },
  {
    id: 2,
    title: "Parliament Debates New Climate Policies in Historic Session",
    source: "BBC News",
    sourceId: "bbc",
    country: "United Kingdom",
    credibility: "high",
    bias: "center",
    summary: "MPs discuss comprehensive environmental legislation that could reshape UK energy policy...",
    content:
      "In a landmark parliamentary session, MPs are debating comprehensive environmental legislation that could fundamentally reshape the UK's energy policy for the next decade. The proposed Climate Action Framework includes ambitious targets for carbon neutrality by 2035, significant investments in renewable energy infrastructure, and new regulations for industrial emissions. Environmental groups have praised the initiative while business leaders express concerns about implementation costs and timeline feasibility.",
    image: "/uk-parliament-westminster.jpg",
    publishedAt: "4 hours ago",
    category: "Environment",
    url: "https://bbc.com/news/uk-politics-climate",
    likes: 892,
    comments: 134,
    shares: 203,
    tags: ["climate", "parliament", "environment", "policy"],
    originalLanguage: "en",
    translated: false,
  },
  {
    id: 3,
    title: "Economic Growth Exceeds Expectations in Q4 Report",
    source: "Deutsche Welle",
    sourceId: "dw",
    country: "Germany",
    credibility: "high",
    bias: "center",
    summary: "Latest quarterly figures show robust economic performance despite global challenges...",
    content:
      "Germany's economy has shown remarkable resilience with Q4 growth figures exceeding all analyst predictions. The 2.8% quarterly growth rate represents the strongest performance in over five years, driven by robust manufacturing output, increased consumer spending, and a surge in technology sector investments. Economists attribute this success to strategic government policies, strong international trade relationships, and innovative approaches to digital transformation across traditional industries.",
    image: "/german-economy-financial-district.jpg",
    publishedAt: "6 hours ago",
    category: "Economy",
    url: "https://dw.com/en/germany-economy-growth",
    likes: 654,
    comments: 78,
    shares: 112,
    tags: ["economy", "germany", "growth", "finance"],
    originalLanguage: "en",
    translated: true,
  },
  {
    id: 4,
    title: "Technology Innovation Summit Concludes with Major Announcements",
    source: "NHK World",
    sourceId: "nhk",
    country: "Japan",
    credibility: "high",
    bias: "center",
    summary: "Leaders discuss future of AI and robotics development in landmark conference...",
    content:
      "The Tokyo Technology Innovation Summit has concluded with groundbreaking announcements in artificial intelligence and robotics development. Leading tech companies unveiled collaborative initiatives that promise to revolutionize healthcare, transportation, and manufacturing sectors. Key highlights include a new AI-powered medical diagnosis system, autonomous vehicle safety protocols, and sustainable manufacturing robots. Industry leaders emphasized the importance of ethical AI development and international cooperation in technology advancement.",
    image: "/tokyo-technology-conference.jpg",
    publishedAt: "8 hours ago",
    category: "Technology",
    url: "https://nhk.or.jp/world/en/news/tech-summit",
    likes: 1456,
    comments: 267,
    shares: 389,
    tags: ["technology", "AI", "robotics", "innovation"],
    originalLanguage: "ja",
    translated: true,
  },
  {
    id: 5,
    title: "Education Reform Proposals Unveiled by Government",
    source: "Le Monde",
    sourceId: "lemonde",
    country: "France",
    credibility: "high",
    bias: "center",
    summary: "Government announces comprehensive changes to education system affecting millions...",
    content:
      "The French government has unveiled comprehensive education reform proposals that could affect millions of students across the country. The initiative focuses on modernizing curriculum standards, integrating digital learning technologies, and improving teacher training programs. Key components include mandatory coding classes from elementary level, enhanced language learning opportunities, and increased funding for rural schools. Education unions have expressed cautious optimism while calling for more detailed implementation timelines.",
    image: "/french-education-system-school.jpg",
    publishedAt: "10 hours ago",
    category: "Education",
    url: "https://lemonde.fr/education/article/reform-proposals",
    likes: 723,
    comments: 145,
    shares: 198,
    tags: ["education", "reform", "france", "policy"],
    originalLanguage: "fr",
    translated: true,
  },
  {
    id: 6,
    title: "Amazon Conservation Efforts Expand with New Funding",
    source: "Folha de S.Paulo",
    sourceId: "folha",
    country: "Brazil",
    credibility: "high",
    bias: "center",
    summary: "Government announces increased funding for forest protection and indigenous rights...",
    content:
      "The Brazilian government has announced a significant expansion of Amazon conservation efforts with new funding totaling $2.5 billion over the next five years. The comprehensive program includes enhanced forest monitoring systems, support for indigenous communities, and sustainable development initiatives. Environmental scientists have welcomed the announcement while emphasizing the need for transparent implementation and international oversight. The initiative represents a major shift in Brazil's approach to environmental protection and climate change mitigation.",
    image: "/amazon-rainforest-conservation.jpg",
    publishedAt: "12 hours ago",
    category: "Environment",
    url: "https://folha.uol.com.br/ambiente/amazon-conservation",
    likes: 1089,
    comments: 234,
    shares: 445,
    tags: ["amazon", "conservation", "environment", "brazil"],
    originalLanguage: "pt",
    translated: true,
  },
  {
    id: 7,
    title: "Digital Infrastructure Investment Reaches Rural Areas",
    source: "The Hindu",
    sourceId: "thehindu",
    country: "India",
    credibility: "high",
    bias: "center",
    summary: "Major initiative to expand internet connectivity nationwide shows promising results...",
    content:
      "India's ambitious digital infrastructure program has achieved significant milestones in connecting rural communities to high-speed internet. The initiative, which has invested over $15 billion in fiber optic networks and 5G infrastructure, has successfully connected 75% of targeted rural areas ahead of schedule. Government officials report that the program has already facilitated the creation of over 500,000 digital jobs and enabled access to online education and healthcare services for millions of citizens in previously underserved regions.",
    image: "/india-digital-infrastructure-rural.jpg",
    publishedAt: "14 hours ago",
    category: "Technology",
    url: "https://thehindu.com/news/national/digital-infrastructure",
    likes: 876,
    comments: 156,
    shares: 289,
    tags: ["digital", "infrastructure", "india", "rural"],
    originalLanguage: "en",
    translated: false,
  },
  {
    id: 8,
    title: "Climate Action Plan Receives Bipartisan Support",
    source: "ABC News Australia",
    sourceId: "abc-au",
    country: "Australia",
    credibility: "high",
    bias: "center",
    summary: "New environmental policies gain backing from both major political parties...",
    content:
      "Australia's new Climate Action Plan has received unprecedented bipartisan support in Parliament, marking a significant shift in the country's approach to environmental policy. The comprehensive plan includes targets for 50% renewable energy by 2030, substantial investments in clean technology research, and support for communities affected by the transition away from fossil fuels. Both major political parties have endorsed the framework, citing economic opportunities and environmental necessity as key factors in their decision.",
    image: "/australia-climate-action-renewable-energy.jpg",
    publishedAt: "16 hours ago",
    category: "Environment",
    url: "https://abc.net.au/news/climate-action-plan",
    likes: 1234,
    comments: 198,
    shares: 367,
    tags: ["climate", "australia", "renewable", "bipartisan"],
    originalLanguage: "en",
    translated: false,
  },
  {
    id: 9,
    title: "Economic Policy Adjustments Proposed by Central Bank",
    source: "Xinhua News",
    sourceId: "xinhua",
    country: "China",
    credibility: "medium",
    bias: "left",
    summary: "Central bank considers new monetary policy measures to address inflation concerns...",
    content:
      "The People's Bank of China has announced a series of monetary policy adjustments aimed at maintaining economic stability while addressing rising inflation concerns. The proposed measures include targeted interest rate modifications, enhanced support for small and medium enterprises, and new guidelines for financial institutions. Economic analysts suggest these changes reflect the government's commitment to balanced growth and financial stability in the face of global economic uncertainties.",
    image: "/china-central-bank-economic-policy.jpg",
    publishedAt: "18 hours ago",
    category: "Economy",
    url: "https://xinhuanet.com/english/economic-policy",
    likes: 567,
    comments: 89,
    shares: 134,
    tags: ["economy", "china", "monetary", "policy"],
    originalLanguage: "zh",
    translated: true,
  },
  {
    id: 10,
    title: "Energy Sector Modernization Plans Announced",
    source: "RT",
    sourceId: "rt",
    country: "Russia",
    credibility: "medium",
    bias: "right",
    summary: "Government outlines comprehensive strategy for renewable energy transition...",
    content:
      "The Russian government has unveiled an ambitious energy sector modernization plan that includes significant investments in renewable energy infrastructure and nuclear technology. The strategy aims to diversify the country's energy portfolio while maintaining its position as a major energy exporter. Key components include wind and solar projects in southern regions, advanced nuclear reactor development, and enhanced energy efficiency measures across industrial sectors.",
    image: "/russia-energy-sector-renewable.jpg",
    publishedAt: "20 hours ago",
    category: "Energy",
    url: "https://rt.com/business/energy-modernization",
    likes: 445,
    comments: 67,
    shares: 98,
    tags: ["energy", "russia", "renewable", "modernization"],
    originalLanguage: "ru",
    translated: true,
  },
]

// Helper functions for data filtering and processing
export function getArticlesByCountry(country: string): NewsArticle[] {
  return mockNewsArticles.filter((article) => article.country === country)
}

export function getArticlesByCategory(category: string): NewsArticle[] {
  return mockNewsArticles.filter((article) => article.category.toLowerCase() === category.toLowerCase())
}

export function getArticlesBySource(sourceId: string): NewsArticle[] {
  return mockNewsArticles.filter((article) => article.sourceId === sourceId)
}

export function getSourceById(sourceId: string): NewsSource | undefined {
  return newsSources.find((source) => source.id === sourceId)
}

export function getSourcesByCountry(country: string): NewsSource[] {
  return newsSources.filter((source) => source.country === country)
}

export function getSourcesByCredibility(credibility: "high" | "medium" | "low"): NewsSource[] {
  return newsSources.filter((source) => source.credibility === credibility)
}

// Simulate RSS feed fetching
export async function fetchRSSFeed(sourceId: string): Promise<NewsArticle[]> {
  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 1000))

  // Return filtered articles for the source
  return getArticlesBySource(sourceId)
}

// Simulate real-time updates
export function getLatestArticles(limit = 10): NewsArticle[] {
  return mockNewsArticles
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit)
}
