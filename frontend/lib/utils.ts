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
    localStorage.setItem("debug_mode", String(enabled))
  }
}

export function getDebugMode(): boolean {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("debug_mode")
    return stored === "true"
  }
  return DEBUG_MODE
}

export function get_logger(name: string) {
  return {
    debug: (...args: any[]) => {
      if (getDebugMode()) {
        console.log(`[${name}]`, ...args)
      }
    },
    error: (...args: any[]) => {
      console.error(`[${name}]`, ...args)
    },
    warn: (...args: any[]) => {
      console.warn(`[${name}]`, ...args)
    },
  }
}

// Debounce function for search input
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}
