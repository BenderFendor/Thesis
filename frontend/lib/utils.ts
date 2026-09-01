import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

type ClassValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | readonly ClassValue[];

interface DebugLogger {
  debug: (...args: readonly unknown[]) => void;
  error: (...args: readonly unknown[]) => void;
  warn: (...args: readonly unknown[]) => void;
}

interface TimerBox {
  value?: NodeJS.Timeout;
}

const DEBUG_MODE_STORAGE_KEY = "thesis_debug_mode",
 ZERO = 0,
 cn = (...inputs: readonly ClassValue[]): string => twMerge(clsx(inputs)),
 debounce = <TArgs extends unknown[]>(
  func: (...args: TArgs) => void,
  wait: number,
): ((...args: TArgs) => void) => {
  const timer: TimerBox = {};
  return (...args: TArgs) => {
    if (timer.value !== undefined) {
      globalThis.clearTimeout(timer.value);
    }
    timer.value = globalThis.setTimeout(() => {
      func(...args);
    }, wait);
  };
},
 debugState = { enabled: false },
getDebugMode = (): boolean => {
  if ("window" in globalThis) {
    const stored = globalThis.localStorage.getItem(DEBUG_MODE_STORAGE_KEY);
    if (stored !== null) {
      return stored === "true";
    }
  }
  return debugState.enabled;
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
 serializeSources = (sources?: readonly string[]): string | undefined => {
  if (sources !== undefined && sources.length > ZERO) {
    return sources.toSorted().join(",");
  }
  return undefined;
},
setDebugMode = (enabled: boolean): void => {
  debugState.enabled = enabled;
  if ("window" in globalThis) {
    globalThis.localStorage.setItem(
      DEBUG_MODE_STORAGE_KEY,
      String(enabled),
    );
  }
};

export {
  cn,
  debounce,
  getDebugMode,
  getLogger,
  serializeSources,
  setDebugMode,
};
