"use client"

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "sonner"
import { ReadingQueueSidebar } from "@/components/reading-queue-sidebar"
import { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface ProvidersProps {
  children: ReactNode
  fontSans?: any
}

export function Providers({ children, fontSans }: ProvidersProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
      <Toaster />
      <ReadingQueueSidebar />
    </ThemeProvider>
  )
}
