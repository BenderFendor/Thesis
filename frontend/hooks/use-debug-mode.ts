"use client";

import { createStorageSchema, getStorageSnapshot, subscribeToStorageKey } from "@/lib/storage";
import { setDebugMode } from "@/lib/logger";
import { useCallback, useSyncExternalStore } from "react";
import { z } from "zod";

const DEBUG_MODE_DEFAULT = process.env.NEXT_PUBLIC_DEBUG_DEFAULT === "true";
const DEBUG_MODE_KEY = "thesis_debug_mode";
const BooleanSchema = createStorageSchema(z.boolean());
const useDebugMode = (): boolean =>
    useSyncExternalStore(
      (onChange) => subscribeToStorageKey(DEBUG_MODE_KEY, onChange),
      () => getStorageSnapshot(DEBUG_MODE_KEY, DEBUG_MODE_DEFAULT, BooleanSchema),
      () => DEBUG_MODE_DEFAULT,
    );
const useDebugModeToggle = () => {
    const toggleDebugMode = useCallback(() => {
      const currentMode = getStorageSnapshot(DEBUG_MODE_KEY, DEBUG_MODE_DEFAULT, BooleanSchema);
      setDebugMode(!currentMode);
    }, []);
    return { toggleDebugMode };
  };

export { useDebugMode, useDebugModeToggle };
