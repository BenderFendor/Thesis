"use client";
import { hasText } from "@/lib/utils";

import { useCallback, useState } from "react";
import { getDefaultSources } from "@/lib/live-news-sources";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { z } from "zod";

interface LiveNewsPreferences {
  activeSourceIds: string[];
  layout: "2x2" | "3x3" | "auto";
  muteState: "all-muted" | "per-source";
}

const STORAGE_KEY = "scoop_live_news_prefs";
const LiveNewsPreferencesSchema = z.object({
  activeSourceIds: z.array(z.string()),
  layout: z.enum(["2x2", "3x3", "auto"]),
  muteState: z.enum(["all-muted", "per-source"]),
});

const parsePreferences = (raw: string): LiveNewsPreferences | null => {
  const parsed = LiveNewsPreferencesSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
};

const loadPreferences = (): LiveNewsPreferences | null => {
  if (globalThis.window === undefined) {
    return null;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!hasText(raw)) {
      return null;
    }
    return parsePreferences(raw);
  } catch {
    return null;
  }
};

const savePreferences = (prefs: DeepReadonly<LiveNewsPreferences>): void => {
  if (globalThis.window === undefined) {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // LocalStorage unavailable
  }
};

const DEFAULT_PREFERENCES: LiveNewsPreferences = {
  activeSourceIds: getDefaultSources().map((source) => source.id),
  layout: "3x3",
  muteState: "all-muted",
};

function useLiveNewsPreferences(): [
  LiveNewsPreferences,
  (patch: DeepReadonly<Partial<LiveNewsPreferences>>) => void,
  () => void,
] {
  const [prefs, setPrefs] = useState<LiveNewsPreferences>(
    () => loadPreferences() ?? { ...DEFAULT_PREFERENCES },
  );
  const updatePreferences = useCallback((patch: DeepReadonly<Partial<LiveNewsPreferences>>) => {
    setPrefs((prev) => {
      const next: LiveNewsPreferences = {
        ...prev,
        ...patch,
        activeSourceIds: (() => {
          if (patch.activeSourceIds) {
            return [...patch.activeSourceIds];
          }
          return prev.activeSourceIds;
        })(),
      };
      savePreferences(next);
      return next;
    });
  }, []);
  const resetToDefaults = useCallback(() => {
    const defaults = { ...DEFAULT_PREFERENCES };
    savePreferences(defaults);
    setPrefs(defaults);
  }, []);

  return [prefs, updatePreferences, resetToDefaults];
}
export { useLiveNewsPreferences };
export type { LiveNewsPreferences };
