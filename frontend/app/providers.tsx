"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import dynamic from "next/dynamic"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "sonner"
import type { ReactNode} from "react";
import { useState } from "react"

const AppearanceSettingsSync = dynamic(
  () => import("@/components/appearance-settings-sync").then((mod) => mod.AppearanceSettingsSync),
  { ssr: false },
),

 ReadingQueueSidebar = dynamic(
  () => import("@/components/reading-queue-sidebar").then((mod) => mod.ReadingQueueSidebar),
  {
    loading: () => null,
    ssr: false,
  },
)

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 3,
            retryDelay: (attemptIndex) =>
              Math.min(1000 * 2 ** attemptIndex, 30_000),
            staleTime: 30 * 1000,
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
        <>
          {children}
          <Toaster />
          <ReadingQueueSidebar />
          <AppearanceSettingsSync />
        </>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
