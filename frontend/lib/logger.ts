/**
 * Frontend logger with debug mode support.
 *
 * Debug mode can be enabled via:
 * - localStorage.setItem('thesis_debug_mode', 'true')
 * - NEXT_PUBLIC_DEBUG_DEFAULT=true environment variable
 *
 * In User Mode: No debug panels, no console spam, no raw JSON dumps.
 * In Debug Mode: Enable debug panels + verbose logs + raw payload viewers.
 */

import { saveToStorage } from "@/lib/storage";

type LogData =
  | string
  | number
  | boolean
  | null
  | readonly LogData[]
  | { readonly [key: string]: LogData };

/**
 * Check if debug mode is enabled.
 * @returns {boolean} Whether debug logging is enabled.
 */
const isDebugMode = (): boolean => {
  if (globalThis.window === undefined) {
    // Server-side: check env var
    return process.env.NEXT_PUBLIC_DEBUG_DEFAULT === "true";
  }

  // Client-side: check localStorage first, then env var
  const localStorageValue = localStorage.getItem("thesis_debug_mode");
  if (localStorageValue !== null) {
    return localStorageValue === "true";
  }

  return process.env.NEXT_PUBLIC_DEBUG_DEFAULT === "true";
};

/**
 * Toggle debug mode in localStorage.
 * @param {boolean} enabled Whether debug logging should be enabled.
 * @returns {void}
 */
const setDebugMode = (enabled: boolean): void => {
  if (globalThis.window !== undefined) {
    saveToStorage("thesis_debug_mode", enabled);
  }
};

/**
 * Logger that respects debug mode settings.
 */
const logger = {
  /**
   * Log raw data (objects/arrays) in debug mode only.
   * Useful for API response inspection.
   * @param {string} label Log label.
   * @param {LogData} data Data to print.
   * @returns {void}
   */
  data: (label: string, data: LogData): void => {
    if (isDebugMode()) {
      console.groupCollapsed(`[DATA] ${label}`);
      console.dir(data);
      console.groupEnd();
    }
  },

  /**
   * Debug-level logging. Only outputs when debug mode is enabled.
   * @param {string} msg Message to print.
   * @param {readonly unknown[]} args Additional values to print.
   * @returns {void}
   */
  debug: (msg: string, ...args: readonly unknown[]): void => {
    if (isDebugMode()) {
      console.debug(`[DEBUG] ${msg}`, ...args);
    }
  },

  /**
   * Error-level logging. Always outputs.
   * @param {string} msg Message to print.
   * @param {readonly unknown[]} args Additional values to print.
   * @returns {void}
   */
  error: (msg: string, ...args: readonly unknown[]): void => {
    console.error(`[ERROR] ${msg}`, ...args);
  },

  /**
   * Info-level logging. Only outputs when debug mode is enabled.
   * @param {string} msg Message to print.
   * @param {readonly unknown[]} args Additional values to print.
   * @returns {void}
   */
  info: (msg: string, ...args: readonly unknown[]): void => {
    if (isDebugMode()) {
      console.info(`[INFO] ${msg}`, ...args);
    }
  },

  /**
   * Log performance timing in debug mode only.
   * @param {string} label Timer label.
   * @returns {void}
   */
  time: (label: string): void => {
    if (isDebugMode()) {
      console.time(`[PERF] ${label}`);
    }
  },

  /**
   * End performance timing in debug mode only.
   * @param {string} label Timer label.
   * @returns {void}
   */
  timeEnd: (label: string): void => {
    if (isDebugMode()) {
      console.timeEnd(`[PERF] ${label}`);
    }
  },

  /**
   * Warning-level logging. Always outputs (important for user awareness).
   * @param {string} msg Message to print.
   * @param {readonly unknown[]} args Additional values to print.
   * @returns {void}
   */
  warn: (msg: string, ...args: readonly unknown[]): void => {
    console.warn(`[WARN] ${msg}`, ...args);
  },
};

export { setDebugMode, logger };
