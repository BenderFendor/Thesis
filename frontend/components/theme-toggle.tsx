"use client"

import { Moon, Sun } from "lucide-react"
import { useCallback, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { useTheme } from "next-themes"

const ThemeToggle = () => {
  const { resolvedTheme, setTheme } = useTheme(),
   hydrationReady = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  ),
   isDark = resolvedTheme === "dark",
   toggleTheme = useCallback(() => {
    if (isDark) {
      setTheme("light")
      return
    }

    setTheme("dark")
  }, [isDark, setTheme])

  if (!hydrationReady) {
    return <ThemeTogglePlaceholder />
  }

  let themeLabel = "Switch to dark mode"
  if (isDark) {
    themeLabel = "Switch to light mode"
  }

  return <ThemeToggleButton isDark={isDark} label={themeLabel} onClick={toggleTheme} />
},

 ThemeToggleButton = ({ isDark, label, onClick }: Readonly<{
  readonly isDark: boolean;
  readonly label: string;
  readonly onClick: () => void;
}>) => {
  let icon = <Moon className="h-4 w-4" />
  if (isDark) {
    icon = <Sun className="h-4 w-4" />
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onClick}
      className="h-9 w-9 rounded-sm border-border/70 bg-background/70 text-foreground transition-all duration-300 ease-out hover:bg-card active:scale-95"
      aria-label={label}
      title={label}
    >
      {icon}
    </Button>
  )
},

 ThemeTogglePlaceholder = () => (
  <div className="h-9 w-9 border border-border/70 bg-background/60" aria-hidden="true" />
);

export { ThemeToggle }
