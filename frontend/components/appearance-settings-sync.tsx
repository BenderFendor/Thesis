"use client"

import { useEffect, useSyncExternalStore } from "react"

import {
  applyAppearanceSettings,
  getServerAppearanceSettings,
  loadAppearanceSettings,
  subscribeToAppearanceSettings,
} from "@/lib/appearance-settings"

/**
 * Bridges the persisted appearance settings to the DOM. Rendering stays pure;
 * the single effect below synchronizes an external system (root CSS custom
 * properties) after the snapshot changes, including cross-tab updates.
 */
export function AppearanceSettingsSync() {
  const settings = useSyncExternalStore(
    subscribeToAppearanceSettings,
    loadAppearanceSettings,
    getServerAppearanceSettings,
  )

  useEffect(() => {
    applyAppearanceSettings(settings)
  }, [settings])

  return null
}
