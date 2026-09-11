"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "sonner";
import dynamic from "next/dynamic";
import type { ReactElement } from "react";
import { useMemo } from "react";

type ProviderChildren = Readonly<ReactElement> | readonly Readonly<ReactElement>[];
type ProviderProps = Readonly<{ readonly children: ProviderChildren }>;

const AppearanceSettingsSync = dynamic(
    async () => {
      const appearanceModule = await import("@/components/appearance-settings-sync");
      return appearanceModule.AppearanceSettingsSync;
    },
    { ssr: false },
  ),
  ReadingQueueSidebar = dynamic(
    async () => {
      const queueModule = await import("@/components/reading-queue-sidebar");
      return queueModule.ReadingQueueSidebar;
    },
    {
      loading: () => null,
      ssr: false,
    },
  );

const ProviderServices = ({
  children,
}: ProviderProps) => (
  <>
    {children}
    <Toaster />
    <ReadingQueueSidebar />
    <AppearanceSettingsSync />
  </>
);

export const Providers = ({
  children,
}: ProviderProps) => {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 3,
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30_000),
            staleTime: 30 * 1000,
          },
        },
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <ProviderServices>{children}</ProviderServices>
      </ThemeProvider>
    </QueryClientProvider>
  );
};
