import { getFromStorage, saveToStorage } from "@/lib/storage"
import type { Highlight } from "@/lib/api"

export type HighlightSyncStatus = "synced" | "pending" | "failed"

export type HighlightOp = "create" | "update" | "delete"

export interface LocalHighlight extends Highlight {
  client_id: string
  server_id?: number
  sync_status: HighlightSyncStatus
  pending_op?: HighlightOp
  last_error?: string
  local_updated_at: string
  deleted?: boolean
}

export interface HighlightStoreState {
  version: 1
  article_url: string
  highlights: LocalHighlight[]
}

function normalizeHighlightedText(text: string) {
  return text.replaceAll(/\s+/gu, " ").trim().toLowerCase()
}

export function getHighlightsStorageKey(articleUrl: string) {
  return `highlights:v1:${articleUrl}`
}

export function createHighlightFingerprint(highlight:Readonly< {
  character_start: number
  character_end: number
  highlighted_text: string
}>) {
  return `${highlight.character_start}:${highlight.character_end}:${normalizeHighlightedText(
    highlight.highlighted_text
  )}`
}

function getHighlightRecencyValue(highlight: Partial<LocalHighlight>) {
  const timestamp =
    highlight.updated_at ??
    highlight.created_at ??
    highlight.local_updated_at ??
    "",

   parsed = Date.parse(timestamp)
  return Number.isNaN(parsed) ? 0 : parsed
}

export function dedupeLocalHighlights(highlights:readonly  LocalHighlight[]): LocalHighlight[] {
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

function safeNowIso() {
  return new Date().toISOString()
}

export function generateClientId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }

  return `client_${Math.random().toString(16).slice(2)}_${Date.now()}`
}

function getServerId(highlight: Partial<LocalHighlight>) {
  return highlight.server_id ?? highlight.id
}

export function loadHighlightStore(articleUrl: string): HighlightStoreState {
  const key = getHighlightsStorageKey(articleUrl),
   stored = getFromStorage<HighlightStoreState | null>(key, undefined)

  if (stored?.version !== 1 || stored.article_url !== articleUrl) {
    return { article_url: articleUrl, highlights: [], version: 1 }
  }

  return stored
}

export function saveHighlightStore(state: HighlightStoreState) {
  const key = getHighlightsStorageKey(state.article_url)
  saveToStorage(key, state)
}

export function mergeHighlights({
  articleUrl,
  local,
  server,
}:Readonly< {
  articleUrl: string
  local: LocalHighlight[]
  server: Highlight[]
}>): LocalHighlight[] {
  const localByServerId = new Map<number, LocalHighlight>(),
   localByFingerprint = new Map<string, LocalHighlight>()

  for (const item of local) {
    const serverId = getServerId(item)
    if (serverId) {
      localByServerId.set(serverId, item)
    }
    localByFingerprint.set(createHighlightFingerprint(item), item)
  }

  const merged: LocalHighlight[] = [],
   seen = new Set<string>(),

   upsert = (highlight: LocalHighlight) => {
    const key = highlight.client_id
    if (seen.has(key)) {return}
    seen.add(key)
    merged.push(highlight)
  }

  for (const serverHighlight of server) {
    const serverId = serverHighlight.id,
     serverFingerprint = createHighlightFingerprint(serverHighlight),

     match =
      (serverId ? localByServerId.get(serverId) : undefined) ??
      localByFingerprint.get(serverFingerprint)

    if (!match) {
      upsert({
        ...serverHighlight,
        client_id: generateClientId(),
        deleted: false,
        last_error: undefined,
        local_updated_at: safeNowIso(),
        pending_op: undefined,
        server_id: serverId,
        sync_status: "synced",
      })
      continue
    }

    if (match.deleted && match.pending_op === "delete") {
      upsert(match)
      continue
    }

    const localIsNewer =
      Date.parse(match.local_updated_at) >=
      Date.parse(serverHighlight.updated_at ?? serverHighlight.created_at ?? ""),

     mergedNote = localIsNewer
      ? match.note ?? serverHighlight.note
      : serverHighlight.note ?? match.note

    upsert({
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
    })
  }

  for (const item of local) {
    if (item.deleted) {
      upsert(item)
      continue
    }

    if (item.pending_op) {
      upsert(item)
      continue
    }

    const serverId = getServerId(item)
    if (serverId && localByServerId.has(serverId)) {
      continue
    }

    const fingerprint = createHighlightFingerprint(item)
    if (localByFingerprint.get(fingerprint) !== item) {
      continue
    }

    upsert(item)
  }

  return dedupeLocalHighlights(
    merged
    .filter((item) => item.article_url === articleUrl)
    .toSorted((a, b) => a.character_start - b.character_start)
  )
}

export function toRemoteHighlights(local:readonly  LocalHighlight[]): Highlight[] {
  return dedupeLocalHighlights(local)
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
}

export function markPending({
  highlight,
  op,
}:Readonly< {
  highlight: LocalHighlight
  op: HighlightOp
}>): LocalHighlight {
  return {
    ...highlight,
    deleted: op === "delete" ? true : highlight.deleted,
    last_error: undefined,
    local_updated_at: safeNowIso(),
    pending_op: op,
    sync_status: "pending",
  }
}

export function markSynced({
  highlight,
  server,
}:Readonly< {
  highlight: LocalHighlight
  server: Highlight
}>): LocalHighlight {
  return {
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
}

export function markFailed({
  highlight,
  error,
}:Readonly< {
  highlight: LocalHighlight
  error: unknown
}>): LocalHighlight {
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
