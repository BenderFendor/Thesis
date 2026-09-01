"use client"

import {
  applyAppearanceSettings,
  getServerAppearanceSettings,
  loadAppearanceSettings,
  subscribeToAppearanceSettings,
} from "@/lib/appearance-settings"
import { useEffect, useSyncExternalStore } from "react"

/**
 * Bridges the persisted appearance settings to the DOM. Rendering stays pure;
 * the single effect below synchronizes an external system (root CSS custom
 * properties) after the snapshot changes, including cross-tab updates.
 * @returns {false} Nothing is rendered.
 */
const AppearanceSettingsSync = () => {
  const settings = useSyncExternalStore(
    subscribeToAppearanceSettings,
    loadAppearanceSettings,
    getServerAppearanceSettings,
  )

  useEffect(() => {
    applyAppearanceSettings(settings)
  }, [settings])

  return false
}

export { AppearanceSettingsSync }
