"use client"

import { useState } from "react"
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

  return (
    <div className="min-h-screen bg-background dark">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
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
      <nav className="border-b border-border bg-background/95 backdrop-blur-sm sticky top-[73px] z-40">
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
      <main className="container mx-auto px-4 py-6">
        <Tabs value={activeCategory} onValueChange={(value) => setActiveCategory(value as Category)}>
          {categories.map((category) => {
            const IconComponent = category.icon
            return (
              <TabsContent key={category.id} value={category.id} className="mt-0">
                {/* Content Views */}
                <>
                  {currentView === "globe" && (
                    <GlobeView key={activeCategory + "-globe"} />
                  )}
                  {currentView === "grid" && <GridView key={activeCategory + "-grid"} />}
                  {currentView === "scroll" && <ScrollView key={activeCategory + "-scroll"} />}
                </>
              </TabsContent>
            )
          })}
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/30 mt-12">
        <div className="container mx-auto px-4 py-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center">
                  <Globe className="w-4 h-4 text-primary-foreground" />
                </div>
                <span className="font-semibold">GlobalNews</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Multi-perspective news aggregation platform bringing you diverse viewpoints from around the world.
              </p>
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold text-sm">Categories</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {categories.slice(0, 3).map((category) => (
                  <li key={category.id}>
                    <button
                      onClick={() => setActiveCategory(category.id as Category)}
                      className="hover:text-foreground transition-colors"
                    >
                      {category.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold text-sm">Features</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>Interactive 3D Globe</li>
                <li>Source Credibility</li>
                <li>Multi-View Interface</li>
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold text-sm">About</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>Privacy Policy</li>
                <li>Terms of Service</li>
                <li>Contact Us</li>
              </ul>
            </div>
          </div>

          <div className="border-t border-border mt-8 pt-6 text-center text-sm text-muted-foreground">
            <p>&copy; 2024 GlobalNews. Built with Next.js and Three.js.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
