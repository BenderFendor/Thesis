import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Logger utility for debug mode control
let DEBUG_MODE = false

export function setDebugMode(enabled: boolean) {
  DEBUG_MODE = enabled
  if (typeof window !== "undefined") {
    localStorage.setItem("thesis_debug_mode", String(enabled))
  }
}

export function getDebugMode(): boolean {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("thesis_debug_mode")
    if (stored !== null) {
      return stored === "true"
    }
  }
  return DEBUG_MODE
}

export function get_logger(name: string) {
  return {
    debug: (...args: unknown[]) => {
      if (getDebugMode()) {
        console.log(`[${name}]`, ...args)
      }
    },
    error: (...args: unknown[]) => {
      console.error(`[${name}]`, ...args)
    },
    warn: (...args: unknown[]) => {
      console.warn(`[${name}]`, ...args)
    },
  }
}

// Debounce function for search input
export function debounce<TArgs extends unknown[], TResult>(
  func: (...args: TArgs) => TResult,
  wait: number
): (...args: TArgs) => void {
  let timeout: NodeJS.Timeout | null = null

  return (...args: TArgs) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}
