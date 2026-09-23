"use client";

import { GlobalNavigation } from "@/components/global-navigation";
import {
  getServerAppearanceSettings,
  loadAppearanceSettings,
  normalizeAppearanceSettings,
  saveAppearanceSettings,
  subscribeToAppearanceSettings,
} from "@/lib/appearance-settings";
import type { AppearanceSettings } from "@/lib/appearance-settings";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  useAppearanceFileActions,
  useAppearanceReset,
  useAppearanceSettingsActions,
} from "./settings-actions";
import { AppearanceSettingsContent } from "./settings-sections";

const AppearanceSettingsPage = () => {
  const settings = useSyncExternalStore(
    subscribeToAppearanceSettings,
    loadAppearanceSettings,
    getServerAppearanceSettings,
  );
  const save = useCallback((next: Readonly<AppearanceSettings>) => {
    saveAppearanceSettings(normalizeAppearanceSettings(next));
  }, []);
  const {
    updateColorField,
    updateLayout,
    updateMotion,
    updateShadows,
    updateTypography,
  } = useAppearanceSettingsActions(settings, save);
  const { handleExport, handleImportFile } = useAppearanceFileActions(settings);
  const { handleReset } = useAppearanceReset();
  const actions = useMemo(
    () => ({
      handleExport,
      handleImportFile,
      handleReset,
      updateColorField,
      updateLayout,
      updateMotion,
      updateShadows,
      updateTypography,
    }),
    [
      handleExport,
      handleImportFile,
      handleReset,
      updateColorField,
      updateLayout,
      updateMotion,
      updateShadows,
      updateTypography,
    ],
  );

  return (
    <div className="flex min-h-screen overflow-hidden bg-background text-foreground">
      <GlobalNavigation />
      <main className="relative z-10 flex-1 overflow-y-auto">
        <AppearanceSettingsContent actions={actions} settings={settings} />
      </main>
    </div>
  );
};

export default AppearanceSettingsPage;
