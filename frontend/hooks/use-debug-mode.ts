"use client";

import { getStorageSnapshot, subscribeToStorageKey } from "@/lib/storage";
import { useSyncExternalStore } from "react";

const DEBUG_MODE_DEFAULT = process.env.NEXT_PUBLIC_DEBUG_DEFAULT === "true",
 DEBUG_MODE_KEY = "thesis_debug_mode",
 useDebugMode = (): boolean =>
  useSyncExternalStore(
    (onChange) => subscribeToStorageKey(DEBUG_MODE_KEY, onChange),
    () => getStorageSnapshot<boolean>(DEBUG_MODE_KEY, DEBUG_MODE_DEFAULT),
    () => DEBUG_MODE_DEFAULT,
  );

export { useDebugMode };
