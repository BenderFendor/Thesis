import { createStorageSchema, getFromStorage, saveToStorage } from "@/lib/storage";
import type { Highlight } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { hasText } from "@/lib/utils";
import { z } from "zod";

type HighlightSyncStatus = "synced" | "pending" | "failed";

type HighlightOp = "create" | "update" | "delete";

interface LocalHighlight extends Highlight {
  readonly client_id: string;
  readonly server_id?: number;
  readonly sync_status: HighlightSyncStatus;
  readonly pending_op?: HighlightOp;
  readonly last_error?: string;
  readonly local_updated_at: string;
  readonly deleted?: boolean;
}

type ReadonlyHighlight = DeepReadonly<Highlight>;
type ReadonlyLocalHighlight = DeepReadonly<LocalHighlight>;

interface HighlightStoreState {
  version: 1;
  article_url: string;
  highlights: LocalHighlight[];
}

const LocalHighlightSchema = z
  .object({
    article_url: z.string(),
    character_end: z.number(),
    character_start: z.number(),
    client_id: z.string(),
    color: z.enum(["yellow", "blue", "red", "green", "purple"]),
    created_at: z.string().optional(),
    deleted: z.boolean().optional(),
    highlighted_text: z.string(),
    id: z.number().optional(),
    last_error: z.string().optional(),
    local_updated_at: z.string(),
    note: z.string().optional(),
    pending_op: z.enum(["create", "update", "delete"]).optional(),
    server_id: z.number().optional(),
    sync_status: z.enum(["synced", "pending", "failed"]),
    updated_at: z.string().optional(),
    user_id: z.number().optional(),
  })
  .passthrough();

const HighlightStoreSchema = z.object({
  article_url: z.string(),
  highlights: z.array(LocalHighlightSchema),
  version: z.literal(1),
});

const HighlightStoreValueSchema = createStorageSchema<HighlightStoreState | null>(
  HighlightStoreSchema.nullable(),
);

const normalizeHighlightedText = (text: string) =>
  text.replaceAll(/\s+/gu, " ").trim().toLowerCase();

const getHighlightsStorageKey = (articleUrl: string) => `highlights:v1:${articleUrl}`;

const createHighlightFingerprint = (
  highlight: Readonly<{
    character_start: number;
    character_end: number;
    highlighted_text: string;
  }>,
) =>
  `${highlight.character_start}:${highlight.character_end}:${normalizeHighlightedText(
    highlight.highlighted_text,
  )}`;

const getHighlightRecencyValue = (highlight: DeepReadonly<Partial<LocalHighlight>>) => {
  const timestamp =
      highlight.updated_at ?? highlight.created_at ?? highlight.local_updated_at ?? "";
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
  return 0;
}
return parsed;
};

const shouldReplaceDuplicate = (
  existing: Readonly<LocalHighlight>,
  next: Readonly<LocalHighlight>,
): boolean => {
  const existingHasServerId = Boolean(getServerId(existing));
  const nextHasServerId = Boolean(getServerId(next));
  if (nextHasServerId && !existingHasServerId) {
    return true;
  }
  return (
    nextHasServerId === existingHasServerId &&
    getHighlightRecencyValue(next) >= getHighlightRecencyValue(existing)
  );
};

const dedupeLocalHighlights = (highlights: readonly LocalHighlight[]): LocalHighlight[] => {
  const byFingerprint = new Map<string, LocalHighlight>();

  for (const highlight of highlights) {
    const fingerprint = createHighlightFingerprint(highlight);
    const existing = byFingerprint.get(fingerprint);

    if (existing === undefined || shouldReplaceDuplicate(existing, highlight)) {
      byFingerprint.set(fingerprint, highlight);
    }
  }

  return [...byFingerprint.values()].toSorted(
    (firstHighlight, secondHighlight) => firstHighlight.character_start - secondHighlight.character_start,
  );
};

const safeNowIso = () => new Date().toISOString();

const generateClientId = () => {
  const cryptoRuntime = globalThis.crypto;
  if (cryptoRuntime?.randomUUID !== undefined) {
    return cryptoRuntime.randomUUID();
  }

  return `client_${Math.random().toString(16).slice(2)}_${Date.now()}`;
};

function getServerId(highlight: Partial<LocalHighlight>) {
  return highlight.server_id ?? highlight.id;
}

const loadHighlightStore = (articleUrl: string): HighlightStoreState => {
  const key = getHighlightsStorageKey(articleUrl),
    stored = getFromStorage<HighlightStoreState | null>(key, null, HighlightStoreValueSchema);

  if (stored?.version !== 1 || stored.article_url !== articleUrl) {
    return { article_url: articleUrl, highlights: [], version: 1 };
  }

  return stored;
};

const saveHighlightStore = (state: DeepReadonly<HighlightStoreState>) => {
  const key = getHighlightsStorageKey(state.article_url);
  saveToStorage(key, state);
};

interface HighlightIndexes {
  readonly localByServerId: ReadonlyMap<number, LocalHighlight>;
  readonly localByFingerprint: ReadonlyMap<string, LocalHighlight>;
}

type HighlightAccumulator = Readonly<{
  push: (highlight: LocalHighlight) => number;
}>;

const indexLocalHighlights = (local: readonly LocalHighlight[]): HighlightIndexes => {
  const localByFingerprint = new Map<string, LocalHighlight>(),
    localByServerId = new Map<number, LocalHighlight>();
  for (const item of local) {
    const serverId = getServerId(item);
    if (serverId !== undefined && serverId !== 0) {
      localByServerId.set(serverId, item);
    }
    localByFingerprint.set(createHighlightFingerprint(item), item);
  }
  return { localByFingerprint, localByServerId };
};

const appendUniqueHighlight = (
  merged: HighlightAccumulator,
  seen: Set<string>,
  highlight: LocalHighlight,
): void => {
  if (seen.has(highlight.client_id)) {
    return;
  }
  seen.add(highlight.client_id);
  merged.push(highlight);
};

const mergeServerHighlight = (
  serverHighlight: ReadonlyHighlight,
  indexes: HighlightIndexes,
): LocalHighlight => {
  const match = findServerHighlightMatch(serverHighlight, indexes),
    serverId = serverHighlight.id;

  if (!match) {
    return createSyncedHighlight(serverHighlight, serverId);
  }

  if (match.deleted === true && match.pending_op === "delete") {
    return match;
  }

  return mergeExistingHighlight(serverHighlight, match, serverId);
};

function findServerHighlightMatch(
  serverHighlight: ReadonlyHighlight,
  indexes: HighlightIndexes,
): LocalHighlight | undefined {
  const serverId = serverHighlight.id;
  return (
    ((() => {
  if (serverId !== undefined && serverId !== 0) {
    return indexes.localByServerId.get(serverId);
  }
  return void 0;
})()) ??
    indexes.localByFingerprint.get(createHighlightFingerprint(serverHighlight))
  );
}

function createSyncedHighlight(
  serverHighlight: ReadonlyHighlight,
  serverId: number | undefined,
): LocalHighlight {
  return {
    ...serverHighlight,
    client_id: generateClientId(),
    deleted: false,
    last_error: undefined,
    local_updated_at: safeNowIso(),
    pending_op: undefined,
    server_id: serverId,
    sync_status: "synced",
  };
}

function mergeExistingHighlight(
  serverHighlight: ReadonlyHighlight,
  match: ReadonlyLocalHighlight,
  serverId: number | undefined,
): LocalHighlight {
  const localIsNewer =
      Date.parse(match.local_updated_at) >=
      Date.parse(serverHighlight.updated_at ?? serverHighlight.created_at ?? ""),
    mergedNote = (() => {
  if (localIsNewer) {
    return match.note ?? serverHighlight.note;
  }
  return serverHighlight.note ?? match.note;
})();
  const mergedOverrides = {
    character_end: serverHighlight.character_end,
    character_start: serverHighlight.character_start,
    color: serverHighlight.color,
    deleted: match.deleted,
    highlighted_text: serverHighlight.highlighted_text,
    last_error: match.last_error,
    note: mergedNote,
    pending_op: match.pending_op,
    server_id: serverId,
    sync_status: match.sync_status,
  };
  return {
    ...serverHighlight,
    ...match,
    ...mergedOverrides,
  };
}

const appendUnmatchedLocalHighlights = (
  local: readonly ReadonlyLocalHighlight[],
  indexes: HighlightIndexes,
  merged: HighlightAccumulator,
  seen: Set<string>,
): void => {
  for (const item of local) {
    if (item.deleted === true || hasText(item.pending_op)) {
      appendUniqueHighlight(merged, seen, item);
    } else {
      const serverId = getServerId(item);
      if (
        !(serverId !== undefined && serverId !== 0 && indexes.localByServerId.has(serverId))
      ) {
        const fingerprint = createHighlightFingerprint(item);
        if (indexes.localByFingerprint.get(fingerprint) === item) {
          appendUniqueHighlight(merged, seen, item);
        }
      }
    }
  }
};

const mergeHighlights = ({
  articleUrl,
  local,
  server,
}: Readonly<{
  articleUrl: string;
  local: readonly ReadonlyLocalHighlight[];
  server: readonly ReadonlyHighlight[];
}>): LocalHighlight[] => {
  const indexes = indexLocalHighlights(local),
    merged: LocalHighlight[] = [],
    seen = new Set<string>();

  for (const serverHighlight of server) {
    appendUniqueHighlight(merged, seen, mergeServerHighlight(serverHighlight, indexes));
  }

  appendUnmatchedLocalHighlights(local, indexes, merged, seen);

  return dedupeLocalHighlights(
    merged
      .filter((item) => item.article_url === articleUrl)
      .toSorted(
        (firstHighlight, secondHighlight) =>
          firstHighlight.character_start - secondHighlight.character_start,
      ),
  );
};

const toRemoteHighlights = (local: readonly ReadonlyLocalHighlight[]): Highlight[] =>
  dedupeLocalHighlights(local)
    .filter((item) => item.deleted !== true)
    .map(
      ({
        client_id,
        server_id,
        sync_status,
        pending_op,
        last_error,
        local_updated_at,
        deleted,
        ...rest
      }) => {
        void sync_status;
        void pending_op;
        void last_error;
        void local_updated_at;
        void deleted;
        const id = rest.id ?? server_id;
        if (id !== undefined && id !== 0) {
  return Object.assign(rest, {
    client_id,
    id
  });
}
return Object.assign(rest, {
  client_id
});
      },
    );

const markPending = ({
  highlight,
  op,
}: Readonly<{
  highlight: ReadonlyLocalHighlight;
  op: HighlightOp;
}>): LocalHighlight => ({
  ...highlight,
  deleted: (() => {
  if (op === "delete") {
    return true;
  }
  return highlight.deleted;
})(),
  last_error: undefined,
  local_updated_at: safeNowIso(),
  pending_op: op,
  sync_status: "pending",
});

const markSynced = ({
  highlight,
  server,
}: Readonly<{
  highlight: ReadonlyLocalHighlight;
  server: ReadonlyHighlight;
}>): LocalHighlight => ({
  ...highlight,
  ...server,
  deleted: false,
  id: server.id,
  last_error: undefined,
  local_updated_at: safeNowIso(),
  pending_op: undefined,
  server_id: server.id,
  sync_status: "synced",
});

const markFailed = ({
  highlight,
  error,
}: Readonly<{
  highlight: ReadonlyLocalHighlight;
  error: unknown;
}>): LocalHighlight => {
  let message = "unknown error";
  if (error instanceof Error) {
    message = error.message;
  } else {
    const parsed = z.string().safeParse(error);
    if (parsed.success) {
      message = parsed.data;
    }
  }

  return {
    ...highlight,
    last_error: message,
    local_updated_at: safeNowIso(),
    sync_status: "failed",
  };
};
export {
  createHighlightFingerprint,
  dedupeLocalHighlights,
  generateClientId,
  loadHighlightStore,
  saveHighlightStore,
  mergeHighlights,
  toRemoteHighlights,
  markPending,
  markSynced,
  markFailed,
};
export type { LocalHighlight };
