import { getFromStorage, saveToStorage } from "@/lib/storage"
import type { Highlight } from "@/lib/api"

type HighlightSyncStatus = "synced" | "pending" | "failed"

type HighlightOp = "create" | "update" | "delete"

interface LocalHighlight extends Highlight {
  readonly client_id: string
  readonly server_id?: number
  readonly sync_status: HighlightSyncStatus
  readonly pending_op?: HighlightOp
  readonly last_error?: string
  readonly local_updated_at: string
  readonly deleted?: boolean
}

interface HighlightStoreState {
  version: 1
  article_url: string
  highlights: LocalHighlight[]
}

const normalizeHighlightedText = (text: string) => 
  text.replaceAll(/\s+/gu, " ").trim().toLowerCase()


const getHighlightsStorageKey = (articleUrl: string) => 
  `highlights:v1:${articleUrl}`


const createHighlightFingerprint = (highlight:Readonly< {
  character_start: number
  character_end: number
  highlighted_text: string
}>) => 
  `${highlight.character_start}:${highlight.character_end}:${normalizeHighlightedText(
    highlight.highlighted_text
  )}`


const getHighlightRecencyValue = (highlight: Partial<LocalHighlight>) => {
  const timestamp =
    highlight.updated_at ??
    highlight.created_at ??
    highlight.local_updated_at ??
    "",

   parsed = Date.parse(timestamp)
  return Number.isNaN(parsed) ? 0 : parsed
}

const dedupeLocalHighlights = (highlights:readonly  LocalHighlight[]): LocalHighlight[] => {
  const byFingerprint = new Map<string, LocalHighlight>()

  for (const highlight of highlights) {
    const fingerprint = createHighlightFingerprint(highlight),
     existing = byFingerprint.get(fingerprint)

    if (!existing) {
      byFingerprint.set(fingerprint, highlight)
      continue
    }

    const existingHasServerId = Boolean(getServerId(existing)),
     nextHasServerId = Boolean(getServerId(highlight))

    if (nextHasServerId && !existingHasServerId) {
      byFingerprint.set(fingerprint, highlight)
      continue
    }

    if (nextHasServerId === existingHasServerId) {
      if (getHighlightRecencyValue(highlight) >= getHighlightRecencyValue(existing)) {
        byFingerprint.set(fingerprint, highlight)
      }
    }
  }

  return [...byFingerprint.values()].toSorted((a, b) => a.character_start - b.character_start)
}

const safeNowIso = () => 
  new Date().toISOString()


const generateClientId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }

  return `client_${Math.random().toString(16).slice(2)}_${Date.now()}`
}

function getServerId(highlight: Partial<LocalHighlight>) {
  return highlight.server_id ?? highlight.id
}

const loadHighlightStore = (articleUrl: string): HighlightStoreState => {
  const key = getHighlightsStorageKey(articleUrl),
   stored = getFromStorage<HighlightStoreState | null>(key, null)

  if (stored?.version !== 1 || stored.article_url !== articleUrl) {
    return { article_url: articleUrl, highlights: [], version: 1 }
  }

  return stored
}

const saveHighlightStore = (state: HighlightStoreState) => {
  const key = getHighlightsStorageKey(state.article_url)
  saveToStorage(key, state)
}

interface HighlightIndexes {
  localByServerId: Map<number, LocalHighlight>
  localByFingerprint: Map<string, LocalHighlight>
}

const indexLocalHighlights = (local:readonly  LocalHighlight[]): HighlightIndexes => {
  const localByFingerprint = new Map<string, LocalHighlight>(),
   localByServerId = new Map<number, LocalHighlight>()
  for (const item of local) {
    const serverId = getServerId(item)
    if (serverId) {
      localByServerId.set(serverId, item)
    }
    localByFingerprint.set(createHighlightFingerprint(item), item)
  }
  return { localByFingerprint, localByServerId }
}

const appendUniqueHighlight = (
  merged: LocalHighlight[],
  seen: Set<string>,
  highlight: LocalHighlight,
): void => {
  if (seen.has(highlight.client_id)) {
    return
  }
  seen.add(highlight.client_id)
  merged.push(highlight)
}

const mergeServerHighlight = (
  serverHighlight: Highlight,
  indexes: HighlightIndexes,
): LocalHighlight => {
  const match = findServerHighlightMatch(serverHighlight, indexes),
   serverId = serverHighlight.id

  if (!match) {
    return createSyncedHighlight(serverHighlight, serverId)
  }

  if (match.deleted && match.pending_op === "delete") {
    return match
  }

  return mergeExistingHighlight(serverHighlight, match, serverId)
}

function findServerHighlightMatch(
  serverHighlight: Highlight,
  indexes: HighlightIndexes,
): LocalHighlight | undefined {
  const serverId = serverHighlight.id
  return (
    (serverId ? indexes.localByServerId.get(serverId) : undefined) ??
    indexes.localByFingerprint.get(createHighlightFingerprint(serverHighlight))
  )
}

function createSyncedHighlight(serverHighlight: Highlight, serverId: number | undefined): LocalHighlight {
  return {
    ...serverHighlight,
    client_id: generateClientId(),
    deleted: false,
    last_error: undefined,
    local_updated_at: safeNowIso(),
    pending_op: undefined,
    server_id: serverId,
    sync_status: "synced",
  }
}

function mergeExistingHighlight(
  serverHighlight: Highlight,
  match: LocalHighlight,
  serverId: number | undefined,
): LocalHighlight {
  const localIsNewer =
    Date.parse(match.local_updated_at) >=
    Date.parse(serverHighlight.updated_at ?? serverHighlight.created_at ?? ""),
   mergedNote = localIsNewer
    ? match.note ?? serverHighlight.note
    : serverHighlight.note ?? match.note
  return {
    ...serverHighlight,
    note: mergedNote,
    ...match,
    highlighted_text: serverHighlight.highlighted_text,
    color: serverHighlight.color,
    character_start: serverHighlight.character_start,
    character_end: serverHighlight.character_end,
    server_id: serverId,
    sync_status: match.sync_status,
    pending_op: match.pending_op,
    deleted: match.deleted,
    last_error: match.last_error,
  }
}

const appendUnmatchedLocalHighlights = (
  local:readonly  LocalHighlight[],
  indexes: HighlightIndexes,
  merged: LocalHighlight[],
  seen: Set<string>,
): void => {
  for (const item of local) {
    if (item.deleted || item.pending_op) {
      appendUniqueHighlight(merged, seen, item)
      continue
    }

    const serverId = getServerId(item)
    if (serverId && indexes.localByServerId.has(serverId)) {
      continue
    }

    const fingerprint = createHighlightFingerprint(item)
    if (indexes.localByFingerprint.get(fingerprint) === item) {
      appendUniqueHighlight(merged, seen, item)
    }
  }
}

const mergeHighlights = ({
  articleUrl,
  local,
  server,
}:Readonly< {
  articleUrl: string
  local: LocalHighlight[]
  server: Highlight[]
}>): LocalHighlight[] => {
  const indexes = indexLocalHighlights(local),
   merged: LocalHighlight[] = [],
   seen = new Set<string>()

  for (const serverHighlight of server) {
    appendUniqueHighlight(merged, seen, mergeServerHighlight(serverHighlight, indexes))
  }

  appendUnmatchedLocalHighlights(local, indexes, merged, seen)

  return dedupeLocalHighlights(
    merged
      .filter((item) => item.article_url === articleUrl)
      .toSorted((a, b) => a.character_start - b.character_start),
  )
}

const toRemoteHighlights = (local:readonly  LocalHighlight[]): Highlight[] => 
  dedupeLocalHighlights(local)
    .filter((item) => !item.deleted)
    .map(({ client_id, server_id, sync_status, pending_op, last_error, local_updated_at, deleted, ...rest }) => {
      void sync_status
      void pending_op
      void last_error
      void local_updated_at
      void deleted
      const id = rest.id ?? server_id
      return id ? Object.assign(rest, {
	client_id,
	id
}) : Object.assign(rest, { client_id })
    })


const markPending = ({
  highlight,
  op,
}:Readonly< {
  highlight: LocalHighlight
  op: HighlightOp
}>): LocalHighlight => (
  {
    ...highlight,
    deleted: op === "delete" ? true : highlight.deleted,
    last_error: undefined,
    local_updated_at: safeNowIso(),
    pending_op: op,
    sync_status: "pending",
  }
)

const markSynced = ({
  highlight,
  server,
}:Readonly< {
  highlight: LocalHighlight
  server: Highlight
}>): LocalHighlight => (
  {
    ...highlight,
    ...server,
    deleted: false,
    id: server.id,
    last_error: undefined,
    local_updated_at: safeNowIso(),
    pending_op: undefined,
    server_id: server.id,
    sync_status: "synced",
  }
)

const markFailed = ({
  highlight,
  error,
}:Readonly< {
  highlight: LocalHighlight
  error: unknown
}>): LocalHighlight => {
  const message =
    error instanceof Error
      ? error.message
      : (typeof error === "string"
        ? error
        : "unknown error")

  return {
    ...highlight,
    last_error: message,
    local_updated_at: safeNowIso(),
    sync_status: "failed",
  }
}
export { createHighlightFingerprint, dedupeLocalHighlights, generateClientId, loadHighlightStore, saveHighlightStore, mergeHighlights, toRemoteHighlights, markPending, markSynced, markFailed };
export type { LocalHighlight };
