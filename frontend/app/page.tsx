"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Globe,
  Grid3X3,
  Scroll,
  Settings,
  Bell,
  User,
  Building2,
  Gamepad2,
  Shirt,
  Palette,
  Laptop,
  Trophy,
  Activity,
} from "lucide-react"
import Link from "next/link"
import { GlobeView } from "@/components/globe-view"
import { GridView } from "@/components/grid-view"
import { ScrollView } from "@/components/scroll-view"
import Footer from "@/components/footer"
import { useNewsStream } from "@/hooks/useNewsStream"
import { NewsArticle } from "@/lib/api"

type ViewMode = "globe" | "grid" | "scroll"
type Category = "politics" | "games" | "fashion" | "hobbies" | "technology" | "sports"

const categories = [
  { id: "politics", label: "Politics", icon: Building2, description: "Political news and analysis" },
  { id: "games", label: "Games", icon: Gamepad2, description: "Gaming industry and esports" },
  { id: "fashion", label: "Fashion", icon: Shirt, description: "Fashion trends and industry news" },
  { id: "hobbies", label: "Hobbies", icon: Palette, description: "Hobby communities and trends" },
  { id: "technology", label: "Technology", icon: Laptop, description: "Tech innovations and startups" },
  { id: "sports", label: "Sports", icon: Trophy, description: "Sports news and updates" },
]

export default function NewsPage() {
  const [currentView, setCurrentView] = useState<ViewMode>("globe")
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<Category>("politics")
  const [articleCount, setArticleCount] = useState<number>(0)
  const [headerHidden, setHeaderHidden] = useState<boolean>(false)
  const [footerHidden, setFooterHidden] = useState<boolean>(true)
  const [isScrollingDown, setIsScrollingDown] = useState<boolean>(false)
  const headerRef = useRef<HTMLElement | null>(null)
  const navRef = useRef<HTMLElement | null>(null)
  const headerHeightRef = useRef<number>(0)
  const navHeightRef = useRef<number>(0)
  const lastScrollY = useRef<number>(0)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const ticking = useRef<boolean>(false)

  // New: State for articles per category to avoid reloading on view switches
  const [articlesByCategory, setArticlesByCategory] = useState<Record<Category, NewsArticle[]>>({
    politics: [],
    games: [],
    fashion: [],
    hobbies: [],
    technology: [],
    sports: [],
  })
  const [loading, setLoading] = useState(false)

  // New: Stream hook at page level - fetches once per category
  const streamHook = useNewsStream({
    onUpdate: useCallback((newArticles: NewsArticle[]) => {
      setArticlesByCategory((prev) => ({
        ...prev,
        [activeCategory]: newArticles,  // Update only the active category
      }))
      setLoading(false)
      console.log(`🔄 NewsPage: Stream updated ${newArticles.length} articles for ${activeCategory}`)
    }, [activeCategory]),
    onComplete: useCallback(() => {
      console.log(`🔄 NewsPage: Stream completed for ${activeCategory}`)
      setLoading(false)
    }, [activeCategory]),
    onError: useCallback((error: string) => {
      console.error(`NewsPage: Stream error for ${activeCategory}:`, error)
      setLoading(false)
    }, [activeCategory]),
  })

  // New: Start stream when category changes
  useEffect(() => {
    setLoading(true)
    console.log(`🔄 NewsPage: Starting stream for category: ${activeCategory}`)
    streamHook.startStream()  // This will fetch for the new category
  }, [activeCategory])  // Only restart on category change, not view change

  useEffect(() => {
    const header = headerRef.current
    const nav = navRef.current
    
    if (header) {
      headerHeightRef.current = header.getBoundingClientRect().height
    }
    if (nav) {
      navHeightRef.current = nav.getBoundingClientRect().height
    }

    const updateScrollState = () => {
      const currentScrollY = window.scrollY
      const scrollDelta = currentScrollY - lastScrollY.current
      const scrollThreshold = 10
      const hideThreshold = Math.max(headerHeightRef.current + navHeightRef.current + 50, 150)
      const documentHeight = document.body.offsetHeight
      const windowHeight = window.innerHeight
      const footerShowThreshold = 200 // Show footer when within 200px of bottom

      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }

      // Determine scroll direction with more sensitivity
      if (Math.abs(scrollDelta) > scrollThreshold) {
        const scrollingDown = scrollDelta > 0
        setIsScrollingDown(scrollingDown)
      }

      // Header/Nav visibility logic
      // Show at very top (first 100px)
      if (currentScrollY <= 100) {
        setHeaderHidden(false)
      }
      // Hide when scrolling in the middle content area
      else if (currentScrollY > hideThreshold && currentScrollY < documentHeight - windowHeight - footerShowThreshold) {
        setHeaderHidden(true)
      }
      // Show when near bottom (approaching footer)
      else if (currentScrollY >= documentHeight - windowHeight - footerShowThreshold) {
        setHeaderHidden(false)
      }

      // Footer visibility logic
      // Show footer only when very close to bottom or at bottom
      const distanceFromBottom = documentHeight - (currentScrollY + windowHeight)
      const isNearBottom = distanceFromBottom <= footerShowThreshold
      setFooterHidden(!isNearBottom)

      // Auto-show header temporarily when scroll stops (for navigation)
      scrollTimeoutRef.current = setTimeout(() => {
        // Only auto-show if user stopped scrolling in middle area and not actively scrolling down
        if (currentScrollY > hideThreshold && 
            currentScrollY < documentHeight - windowHeight - footerShowThreshold && 
            !isScrollingDown) {
          // Don't auto-show - keep it clean while reading articles
        }
      }, 2000)

      lastScrollY.current = currentScrollY
      ticking.current = false
    }

    const onScroll = () => {
      if (!ticking.current) {
        requestAnimationFrame(updateScrollState)
        ticking.current = true
      }
    }

    const onResize = () => {
      if (header) headerHeightRef.current = header.getBoundingClientRect().height
      if (nav) navHeightRef.current = nav.getBoundingClientRect().height
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize, { passive: true })
    
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [isScrollingDown])

  return (
    <div className="min-h-screen bg-background dark">
      {/* Header */}
      <header
        ref={headerRef}
        onMouseEnter={() => {
          // Only show on hover if near top or bottom of page
          const currentScrollY = window.scrollY
          const documentHeight = document.body.offsetHeight
          const windowHeight = window.innerHeight
          const isNearTop = currentScrollY <= 150
          const isNearBottom = currentScrollY >= documentHeight - windowHeight - 200
          
          if (isNearTop || isNearBottom) {
            setHeaderHidden(false)
          }
        }}
        onMouseLeave={() => {
          // Re-hide if in middle section
          const currentScrollY = window.scrollY
          const documentHeight = document.body.offsetHeight
          const windowHeight = window.innerHeight
          const isInMiddle = currentScrollY > 150 && currentScrollY < documentHeight - windowHeight - 200
          
          if (isInMiddle) {
            setHeaderHidden(true)
          }
        }}
        className="border-b border-border bg-card/50 backdrop-blur-sm fixed top-0 left-0 right-0 z-50 transform transition-transform duration-300"
        style={{
          transform: headerHidden
            ? `translateY(${-(headerHeightRef.current ? headerHeightRef.current - 8 : 65)}px)`
            : "translateY(0)"
        }}
      >
        <div className="container mx-auto px-4 py-4">
          {/* measure header height on mount */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Globe className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-bold font-serif text-foreground">Scoop</h1>
                <p className="text-xs text-muted-foreground">Multi-perspective news aggregation from around the globe</p>
              </div>
            </div>

            {/* Header Actions */}
            <div className="flex items-center gap-3">
              {/* View Toggle */}
              <div className="flex items-center gap-2 bg-muted rounded-lg p-1">
                <Button
                  variant={currentView === "globe" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setCurrentView("globe")}
                  className="gap-2"
                >
                  <Globe className="w-4 h-4" />
                  Globe
                </Button>
                <Button
                  variant={currentView === "grid" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setCurrentView("grid")}
                  className="gap-2"
                >
                  <Grid3X3 className="w-4 h-4" />
                  Grid
                </Button>
                <Button
                  variant={currentView === "scroll" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setCurrentView("scroll")}
                  className="gap-2"
                >
                  <Scroll className="w-4 h-4" />
                  Feed
                </Button>
              </div>

              {/* User Actions */}
              <div className="flex items-center gap-2">
                <Link href="/sources">
                  <Button variant="ghost" size="sm" className="gap-2">
                    <Activity className="w-4 h-4" />
                    Sources
                  </Button>
                </Link>
                <Button variant="ghost" size="sm" className="relative">
                  <Bell className="w-4 h-4" />
                  <Badge className="absolute -top-1 -right-1 w-2 h-2 p-0 bg-destructive" />
                </Button>
                <Button variant="ghost" size="sm">
                  <Settings className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm">
                  <User className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Category Navigation */}
      <nav 
        ref={navRef} 
        onMouseEnter={() => {
          // Only show on hover if near top or bottom of page
          const currentScrollY = window.scrollY
          const documentHeight = document.body.offsetHeight
          const windowHeight = window.innerHeight
          const isNearTop = currentScrollY <= 150
          const isNearBottom = currentScrollY >= documentHeight - windowHeight - 200
          
          if (isNearTop || isNearBottom) {
            setHeaderHidden(false)
          }
        }}
        onMouseLeave={() => {
          // Re-hide if in middle section
          const currentScrollY = window.scrollY
          const documentHeight = document.body.offsetHeight
          const windowHeight = window.innerHeight
          const isInMiddle = currentScrollY > 150 && currentScrollY < documentHeight - windowHeight - 200
          
          if (isInMiddle) {
            setHeaderHidden(true)
          }
        }}
        className="border-b border-border bg-background/95 backdrop-blur-sm fixed left-0 right-0 z-40 transform transition-all duration-300"
        style={{
          top: headerHidden 
            ? `${8}px` 
            : `${headerHeightRef.current || 73}px`,
          transform: headerHidden
            ? `translateY(${-(navHeightRef.current ? navHeightRef.current - 6 : 54)}px)`
            : "translateY(0)"
        }}
      >
        <div className="container mx-auto px-4">
          <Tabs value={activeCategory} onValueChange={(value) => setActiveCategory(value as Category)}>
            <TabsList className="grid w-full grid-cols-6 bg-transparent h-auto p-0">
              {categories.map((category) => {
                const IconComponent = category.icon
                return (
                  <TabsTrigger
                    key={category.id}
                    value={category.id}
                    className="flex flex-col items-center gap-1 py-3 px-2 rounded-md border-b-2 border-transparent data-[state=active]:border-emerald-500 data-[state=active]:bg-emerald-600/20 data-[state=active]:text-emerald-400"
                  >
                    <IconComponent className="w-5 h-5" />
                    <span className="text-xs font-medium">{category.label}</span>
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </Tabs>
        </div>
      </nav>

      {/* Main Content */}
      <main 
        className="container mx-auto px-4 py-6 transition-all duration-300" 
        style={{ 
          paddingTop: headerHidden 
            ? `${20}px` // minimal spacing when header is hidden
            : `${(headerHeightRef.current || 73) + (navHeightRef.current || 48) + 24}px`, // full headers + spacing
          paddingBottom: footerHidden ? '24px' : '120px' // Extra space when footer is visible
        }}
      >
        {/* Compact single-line header: title + subtitle + badges + hover-expand live controls */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-2xl font-bold font-serif text-foreground whitespace-nowrap">News Grid</h2>
            <span className="text-sm text-muted-foreground truncate hidden sm:inline-block">Browse news articles from around the world</span>
          </div>

          <div className="flex items-center gap-3">
            {/* compact badges */}
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline-flex text-sm text-muted-foreground bg-card/20 px-2 py-1 rounded-md">{articleCount} article{articleCount === 1 ? '' : 's'}</span>
            </div>

            {/* Live Stream Status - Always active */}
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-emerald-500" />
              <span className="text-sm text-muted-foreground hidden md:inline">Live Stream Active</span>
            </div>
          </div>
        </div>

        <Tabs value={activeCategory} onValueChange={(value) => setActiveCategory(value as Category)}>
          {categories.map((category) => {
            const IconComponent = category.icon
            return (
              <TabsContent key={category.id} value={category.id} className="mt-0">
                {/* Content Views - Pass articles as props */}
                <>
                  {currentView === "globe" && (
                    <GlobeView key={`${category.id}-globe`} articles={articlesByCategory[category.id as Category]} loading={loading} />
                  )}
                  {currentView === "grid" && <GridView key={`${category.id}-grid`} articles={articlesByCategory[category.id as Category]} loading={loading} onCountChange={setArticleCount} />}
                  {currentView === "scroll" && <ScrollView key={`${category.id}-scroll`} articles={articlesByCategory[category.id as Category]} loading={loading} />}
                </>
              </TabsContent>
            )
          })}
        </Tabs>
      </main>

      {/* Footer */}
      <Footer hidden={footerHidden} />
    </div>
  )
}
