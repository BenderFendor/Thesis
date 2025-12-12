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

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Check if debug mode is enabled.
 */
export function isDebugMode(): boolean {
    if (typeof window === 'undefined') {
        // Server-side: check env var
        return process.env.NEXT_PUBLIC_DEBUG_DEFAULT === 'true';
    }

    // Client-side: check localStorage first, then env var
    const localStorageValue = localStorage.getItem('thesis_debug_mode');
    if (localStorageValue !== null) {
        return localStorageValue === 'true';
    }

    return process.env.NEXT_PUBLIC_DEBUG_DEFAULT === 'true';
}

/**
 * Toggle debug mode in localStorage.
 */
export function setDebugMode(enabled: boolean): void {
    if (typeof window !== 'undefined') {
        localStorage.setItem('thesis_debug_mode', enabled ? 'true' : 'false');
    }
}

/**
 * Logger that respects debug mode settings.
 */
export const logger = {
    /**
     * Debug-level logging. Only outputs when debug mode is enabled.
     */
    debug: (msg: string, ...args: unknown[]): void => {
        if (isDebugMode()) {
            console.debug(`[DEBUG] ${msg}`, ...args);
        }
    },

    /**
     * Info-level logging. Only outputs when debug mode is enabled.
     */
    info: (msg: string, ...args: unknown[]): void => {
        if (isDebugMode()) {
            console.info(`[INFO] ${msg}`, ...args);
        }
    },

    /**
     * Warning-level logging. Always outputs (important for user awareness).
     */
    warn: (msg: string, ...args: unknown[]): void => {
        console.warn(`[WARN] ${msg}`, ...args);
    },

    /**
     * Error-level logging. Always outputs.
     */
    error: (msg: string, ...args: unknown[]): void => {
        console.error(`[ERROR] ${msg}`, ...args);
    },

    /**
     * Log raw data (objects/arrays) in debug mode only.
     * Useful for API response inspection.
     */
    data: (label: string, data: unknown): void => {
        if (isDebugMode()) {
            console.groupCollapsed(`[DATA] ${label}`);
            console.dir(data);
            console.groupEnd();
        }
    },

    /**
     * Log performance timing in debug mode only.
     */
    time: (label: string): void => {
        if (isDebugMode()) {
            console.time(`[PERF] ${label}`);
        }
    },

    /**
     * End performance timing in debug mode only.
     */
    timeEnd: (label: string): void => {
        if (isDebugMode()) {
            console.timeEnd(`[PERF] ${label}`);
        }
    },
};

export default logger;
