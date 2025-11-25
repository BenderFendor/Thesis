"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "sonner"
import { ReadingQueueSidebar } from "@/components/reading-queue-sidebar"
import { ReactNode, useState } from "react"
import { cn } from "@/lib/utils"

interface ProvidersProps {
  children: ReactNode
  fontSans?: any
}

export function Providers({ children, fontSans }: ProvidersProps) {
  // Create query client with optimized defaults
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data considered fresh for 30 seconds
            staleTime: 30 * 1000,
            // Keep unused data in cache for 5 minutes
            gcTime: 5 * 60 * 1000,
            // Retry failed requests 3 times with exponential backoff
            retry: 3,
            retryDelay: (attemptIndex) =>
              Math.min(1000 * 2 ** attemptIndex, 30000),
            // Don't refetch on window focus (user controls refresh)
            refetchOnWindowFocus: false,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  )
}
