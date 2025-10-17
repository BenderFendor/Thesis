"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Globe } from "lucide-react";
import Link from "next/link";

export function AutoHideHeader() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      // Hide header when scrolling down past 100px
      if (currentScrollY > lastScrollY && currentScrollY > 100) {
        setIsHidden(true);
      } else {
        setIsHidden(false);
      }

      setIsScrolled(currentScrollY > 50);
      setLastScrollY(currentScrollY);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [lastScrollY]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full bg-background/95 backdrop-blur transition-all duration-300 border-b border-border/40",
        isScrolled && "shadow-sm",
        isHidden ? "-translate-y-full" : "translate-y-0"
      )}
    >
      <div className="container mx-auto px-4 flex items-center justify-between h-full">
        {/* Logo and branding */}
        <div className="flex items-center gap-3 py-3">
          <Globe
            className={cn(
              "text-primary transition-all",
              isScrolled ? "w-6 h-6" : "w-8 h-8"
            )}
          />
          {!isScrolled && (
            <div className="flex flex-col">
              <h1 className="font-serif text-2xl font-semibold">Scoop</h1>
              <p className="text-xs text-muted-foreground">
                Multi-perspective news aggregation
              </p>
            </div>
          )}
          {isScrolled && (
            <h1 className="font-serif text-lg font-semibold">Scoop</h1>
          )}
        </div>

        {/* Nav items remain visible */}
        <nav className="flex items-center gap-2">
          <Link
            href="/search"
            className="px-3 py-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Research
          </Link>
          <Link
            href="/sources"
            className="px-3 py-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Sources
          </Link>
        </nav>
      </div>
    </header>
  );
}
