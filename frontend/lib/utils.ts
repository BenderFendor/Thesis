import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

type ClassValue = string | number | bigint | boolean | null | undefined | readonly ClassValue[];

interface DebugLogger {
  debug: (...args: readonly unknown[]) => void;
  error: (...args: readonly unknown[]) => void;
  warn: (...args: readonly unknown[]) => void;
}

const DEBUG_MODE_STORAGE_KEY = "thesis_debug_mode",
  cn = (...inputs: readonly ClassValue[]): string => twMerge(clsx(inputs)),
  getDebugMode = (): boolean => {
    if ("window" in globalThis) {
      const stored = globalThis.localStorage.getItem(DEBUG_MODE_STORAGE_KEY);
      if (stored !== null) {
        return stored === "true";
      }
    }
    return false;
  },
  getLogger = (name: string): DebugLogger => ({
    debug: (...args: readonly unknown[]) => {
      if (getDebugMode()) {
        globalThis.console.log(`[${name}]`, ...args);
      }
    },
    error: (...args: readonly unknown[]) => {
      globalThis.console.error(`[${name}]`, ...args);
    },
    warn: (...args: readonly unknown[]) => {
      globalThis.console.warn(`[${name}]`, ...args);
    },
  }),
  hasText = (value: string | null | undefined): value is string =>
    value !== null && value !== undefined && value !== "",
  serializeSources = (sources?: readonly string[]): string | undefined => {
    if (sources !== undefined && sources.length > 0) {
      return sources.toSorted().join(",");
    }
    return void 0;
  };

export { cn, getLogger, hasText, serializeSources };
