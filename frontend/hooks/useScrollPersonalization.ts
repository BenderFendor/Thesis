"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArticleTopic,
  BookmarkEntry,
  fetchBookmarks,
  fetchBulkArticleTopics,
  fetchLikedArticles,
  LikedEntry,
  NewsArticle,
} from "@/lib/api"
import {
  buildInterestProfile,
  FeedScoreBreakdown,
  InterestProfile,
  MAX_PERSONALIZATION_SEEDS,
  PersonalizationSeed,
  rankFeedArticles,
} from "@/lib/feed-ranking"

type PersonalizationStatus = "basic" | "loading" | "ready" | "fallback"

interface UseScrollPersonalizationOptions {
  articles: NewsArticle[]
  isFavorite: (sourceId: string) => boolean
  enabled?: boolean
}

interface UseScrollPersonalizationResult {
  rankedArticles: NewsArticle[]
  breakdowns: Record<number, FeedScoreBreakdown>
  status: PersonalizationStatus
  profile: InterestProfile | null
  topicsLoaded: number
  seedCount: number
}

const topicCache = new Map<number, ArticleTopic[]>()

function dedupeSeeds(bookmarks: BookmarkEntry[], likes: LikedEntry[]): PersonalizationSeed[] {
  const merged = new Map<number, PersonalizationSeed>()

  for (const bookmark of bookmarks) {
    const existing = merged.get(bookmark.articleId)
    merged.set(bookmark.articleId, {
      article: bookmark.article,
      liked: existing?.liked ?? false,
      bookmarked: true,
      createdAt: bookmark.createdAt,
    })
  }

  for (const liked of likes) {
    const existing = merged.get(liked.articleId)
    merged.set(liked.articleId, {
      article: liked.article,
      liked: true,
      bookmarked: existing?.bookmarked ?? false,
      createdAt: existing?.createdAt || liked.createdAt,
    })
  }

  return Array.from(merged.values())
    .sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return bTime - aTime
    })
    .slice(0, MAX_PERSONALIZATION_SEEDS)
}

function buildTopicMap(articleIds: number[]): Record<number, ArticleTopic[]> {
  return articleIds.reduce<Record<number, ArticleTopic[]>>((acc, articleId) => {
    const cached = topicCache.get(articleId)
    if (cached) {
      acc[articleId] = cached
    }
    return acc
  }, {})
}

export function useScrollPersonalization({
  articles,
  isFavorite,
  enabled = true,
}: UseScrollPersonalizationOptions): UseScrollPersonalizationResult {
  const basicRanking = useMemo(() => rankFeedArticles(articles, null, isFavorite), [articles, isFavorite])
  const [status, setStatus] = useState<PersonalizationStatus>("basic")
  const [profile, setProfile] = useState<InterestProfile | null>(null)
  const [personalizedBreakdowns, setPersonalizedBreakdowns] = useState<Record<number, FeedScoreBreakdown> | null>(null)
  const [personalizedArticles, setPersonalizedArticles] = useState<NewsArticle[] | null>(null)
  const [topicsLoaded, setTopicsLoaded] = useState(0)
  const [seedCount, setSeedCount] = useState(0)
  const requestVersionRef = useRef(0)

  useEffect(() => {
    requestVersionRef.current += 1
    const requestVersion = requestVersionRef.current

    if (!enabled) {
      return
    }

    let cancelled = false

    const load = async () => {
      setStatus("loading")

      try {
        const [bookmarks, likes] = await Promise.all([fetchBookmarks(), fetchLikedArticles()])
        if (cancelled || requestVersionRef.current !== requestVersion) return

        const seeds = dedupeSeeds(bookmarks, likes)
        setSeedCount(seeds.length)

        if (seeds.length === 0) {
          setProfile(null)
          setStatus("basic")
          setTopicsLoaded(0)
          setPersonalizedArticles(null)
          setPersonalizedBreakdowns(null)
          return
        }

        const articleIds = Array.from(new Set([...articles.map((article) => article.id), ...seeds.map((seed) => seed.article.id)]))
        const missingIds = articleIds.filter((articleId) => !topicCache.has(articleId))

        if (missingIds.length > 0) {
          try {
            const response = await fetchBulkArticleTopics(missingIds)
            if (cancelled || requestVersionRef.current !== requestVersion) return

            for (const [key, value] of Object.entries(response.articles || {})) {
              const articleId = Number(key)
              topicCache.set(articleId, value as ArticleTopic[])
            }
          } catch {
            if (cancelled || requestVersionRef.current !== requestVersion) return
            setProfile(null)
            setStatus("fallback")
            setTopicsLoaded(topicCache.size)
            return
          }
        }

        if (cancelled || requestVersionRef.current !== requestVersion) return

        const topicMap = buildTopicMap(articleIds)
        const nextProfile = buildInterestProfile(seeds, topicMap)
        const personalized = rankFeedArticles(articles, nextProfile, isFavorite)

        setProfile(nextProfile)
        setPersonalizedArticles(personalized.articles)
        setPersonalizedBreakdowns(personalized.breakdowns)
        setStatus(nextProfile ? "ready" : "basic")
        setTopicsLoaded(Object.keys(topicMap).length)
      } catch {
        if (cancelled || requestVersionRef.current !== requestVersion) return
        setStatus("fallback")
        setProfile(null)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [articles, enabled, isFavorite])

  return useMemo(
    () => ({
      rankedArticles: personalizedArticles || basicRanking.articles,
      breakdowns: personalizedBreakdowns || basicRanking.breakdowns,
      status: enabled ? status : "basic",
      profile: enabled ? profile : null,
      topicsLoaded: enabled ? topicsLoaded : 0,
      seedCount: enabled ? seedCount : 0,
    }),
    [basicRanking.articles, basicRanking.breakdowns, enabled, personalizedArticles, personalizedBreakdowns, profile, seedCount, status, topicsLoaded],
  )
}
