"use client";

import {
  normalizeAppearanceSettings,
  resetAppearanceSettings,
  saveAppearanceSettings,
  } from "@/lib/appearance-settings";
import { parseStoredJson } from "@/lib/storage";
import type {
  AppearanceColorTokens,
  AppearanceLayoutTokens,
  AppearanceMotionTokens,
  AppearanceSettings,
  AppearanceShadowTokens,
  AppearanceTypographyTokens,
} from "@/lib/appearance-settings";
import { useCallback } from "react";
import { toast } from "sonner";

const useAppearanceSettingsActions = (
  settings: Readonly<AppearanceSettings>,
  save: (next: Readonly<AppearanceSettings>) => void,
) => {
  const updateColorField = useCallback(
      (token: keyof AppearanceColorTokens, value: string) => {
        save({ ...settings, colors: { ...settings.colors, [token]: value } });
      },
      [save, settings],
    ),
    updateLayout = useCallback(
      (patch: Readonly<Partial<AppearanceLayoutTokens>>) => {
        save({ ...settings, layout: { ...settings.layout, ...patch } });
      },
      [save, settings],
    ),
    updateMotion = useCallback(
      (patch: Readonly<Partial<AppearanceMotionTokens>>) => {
        save({ ...settings, motion: { ...settings.motion, ...patch } });
      },
      [save, settings],
    ),
    updateShadows = useCallback(
      (patch: Readonly<Partial<AppearanceShadowTokens>>) => {
        save({ ...settings, shadows: { ...settings.shadows, ...patch } });
      },
      [save, settings],
    ),
    updateTypography = useCallback(
      (patch: Readonly<Partial<AppearanceTypographyTokens>>) => {
        save({ ...settings, typography: { ...settings.typography, ...patch } });
      },
      [save, settings],
    );
  return { updateColorField, updateLayout, updateMotion, updateShadows, updateTypography };
};

const useAppearanceFileActions = (settings: Readonly<AppearanceSettings>) => {
  const handleExport = useCallback(() => {
      const anchor = document.createElement("a"),
        blob = new Blob([JSON.stringify(settings, undefined, 2)], { type: "application/json" }),
        url = URL.createObjectURL(blob);
      anchor.href = url;
      anchor.download = "scoop-appearance-settings.json";
      anchor.click();
      URL.revokeObjectURL(url);
    }, [settings]),
    handleImportFile = useCallback(async (file: Readonly<File>) => {
      try {
        const parsed = normalizeAppearanceSettings(parseStoredJson(await file.text()));
        if (parsed.version !== 1) {
          throw new Error("Unsupported settings version");
        }
        saveAppearanceSettings(parsed);
        toast.success("Appearance settings imported");
      } catch {
        toast.error("Could not import settings: expected an exported appearance JSON file");
      }
    }, []);
  return { handleExport, handleImportFile };
};

const useAppearanceReset = () => {
  const handleReset = useCallback(() => {
    resetAppearanceSettings();
    toast.success("Appearance restored to defaults");
  }, []);
  return { handleReset };
};

export { useAppearanceFileActions, useAppearanceReset, useAppearanceSettingsActions };
