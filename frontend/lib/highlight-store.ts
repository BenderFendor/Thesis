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
  return text.replace(/\s+/g, " ").trim().toLowerCase()
}

export function getHighlightsStorageKey(articleUrl: string) {
  return `highlights:v1:${articleUrl}`
}

export function createHighlightFingerprint(highlight: {
  character_start: number
  character_end: number
  highlighted_text: string
}) {
  return `${highlight.character_start}:${highlight.character_end}:${normalizeHighlightedText(
    highlight.highlighted_text
  )}`
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
  const key = getHighlightsStorageKey(articleUrl)
  const stored = getFromStorage<HighlightStoreState | null>(key, null)

  if (!stored || stored.version !== 1 || stored.article_url !== articleUrl) {
    return { version: 1, article_url: articleUrl, highlights: [] }
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
}: {
  articleUrl: string
  local: LocalHighlight[]
  server: Highlight[]
}): LocalHighlight[] {
  const localByServerId = new Map<number, LocalHighlight>()
  const localByFingerprint = new Map<string, LocalHighlight>()

  for (const item of local) {
    const serverId = getServerId(item)
    if (serverId) {
      localByServerId.set(serverId, item)
    }
    localByFingerprint.set(createHighlightFingerprint(item), item)
  }

  const merged: LocalHighlight[] = []
  const seen = new Set<string>()

  const upsert = (highlight: LocalHighlight) => {
    const key = highlight.client_id
    if (seen.has(key)) return
    seen.add(key)
    merged.push(highlight)
  }

  for (const serverHighlight of server) {
    const serverId = serverHighlight.id
    const serverFingerprint = createHighlightFingerprint(serverHighlight)

    const match =
      (serverId ? localByServerId.get(serverId) : undefined) ??
      localByFingerprint.get(serverFingerprint)

    if (!match) {
      upsert({
        ...serverHighlight,
        client_id: generateClientId(),
        server_id: serverId,
        sync_status: "synced",
        pending_op: undefined,
        deleted: false,
        last_error: undefined,
        local_updated_at: safeNowIso(),
      })
      continue
    }

    if (match.deleted && match.pending_op === "delete") {
      upsert(match)
      continue
    }

    const localIsNewer =
      Date.parse(match.local_updated_at) >=
      Date.parse(serverHighlight.updated_at ?? serverHighlight.created_at ?? "")

    const mergedNote = localIsNewer
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

  return merged
    .filter((item) => item.article_url === articleUrl)
    .sort((a, b) => a.character_start - b.character_start)
}

export function toRemoteHighlights(local: LocalHighlight[]): Highlight[] {
  return local
    .filter((item) => !item.deleted)
    .map(({ client_id, server_id, sync_status, pending_op, last_error, local_updated_at, deleted, ...rest }) => {
      const id = rest.id ?? server_id
      return id ? { ...rest, id } : rest
    })
}

export function markPending({
  highlight,
  op,
}: {
  highlight: LocalHighlight
  op: HighlightOp
}): LocalHighlight {
  return {
    ...highlight,
    sync_status: "pending",
    pending_op: op,
    local_updated_at: safeNowIso(),
    last_error: undefined,
    deleted: op === "delete" ? true : highlight.deleted,
  }
}

export function markSynced({
  highlight,
  server,
}: {
  highlight: LocalHighlight
  server: Highlight
}): LocalHighlight {
  return {
    ...highlight,
    ...server,
    id: server.id,
    server_id: server.id,
    sync_status: "synced",
    pending_op: undefined,
    last_error: undefined,
    deleted: false,
    local_updated_at: safeNowIso(),
  }
}

export function markFailed({
  highlight,
  error,
}: {
  highlight: LocalHighlight
  error: unknown
}): LocalHighlight {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "unknown error"

  return {
    ...highlight,
    sync_status: "failed",
    last_error: message,
    local_updated_at: safeNowIso(),
  }
}
