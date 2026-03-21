"use client";

import { useSyncExternalStore } from "react";
import { getStorageSnapshot, subscribeToStorageKey } from "@/lib/storage";

const DEBUG_MODE_KEY = "thesis_debug_mode";
const DEBUG_MODE_DEFAULT = process.env.NEXT_PUBLIC_DEBUG_DEFAULT === "true";

export function useDebugMode(): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeToStorageKey(DEBUG_MODE_KEY, onChange),
    () => getStorageSnapshot<boolean>(DEBUG_MODE_KEY, DEBUG_MODE_DEFAULT),
    () => DEBUG_MODE_DEFAULT,
  );
}
