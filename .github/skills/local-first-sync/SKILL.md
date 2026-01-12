---
name: local-first-sync
description: Implement a local-first + backend-sync data flow (create/update/delete) with tombstones, dedupe, and safe retry. Use when building offline-capable entities (highlights, annotations, queue items, notes) that must persist immediately in localStorage while syncing to a server.
---

# Local-First Sync

## Overview
This skill provides a reusable, minimal pattern for local-first persistence with background server sync, including dedupe/merge rules, tombstones for deletes, and a safe retry model that avoids infinite loops.

Use it when the user requires:
- Instant local persistence (works offline)
- Backend as eventual consistency store
- Create/update/delete support
- Explicit handling for failures and retries

## Assumptions (state explicitly)
- Whether backwards compatibility is required.
- Whether the backend supports idempotency keys or client-provided ids.
- What determines identity (server id, natural key, or fingerprint).

## Data Model
Store local records with:
- `client_id` (UUID)
- `server_id?`
- `sync_status`: `synced | pending | failed`
- `pending_op`: `create | update | delete`
- `last_error?` (string)
- `local_updated_at` (ISO)
- `deleted?` (tombstone)

Recommendation: keep local records as a superset of server records (so rendering code can stay simple).

## Storage Keys
- Prefer versioned keys: `entity:v1:<entity_scope_or_id>`
- Scope keys by natural grouping (e.g. `highlights:v1:${article_url}`) to avoid large global blobs.

## Core Workflow

### 1) Read path (open modal / load view)
1. Load local state immediately and render.
2. Fetch server state.
3. Merge + dedupe server into local.
4. Persist merged local state.
5. Kick off background sync for `pending/failed` ops.

### 2) Write path (create/update/delete)
Always do the local write first:
1. Create/update/delete in local store; mark `pending_op` and `sync_status=pending` (or keep tombstone for delete).
2. Render from local store.
3. Trigger background sync.

### 3) Sync loop (background)
For each record with `pending_op`:
- `create`: POST to server, then store returned `server_id` and clear pending fields.
- `update`: PATCH to server (requires `server_id`), clear pending fields.
- `delete`: DELETE on server if `server_id` exists; then remove local record.

Failure behavior:
- Mark local record `sync_status=failed` and set `last_error`.
- Do not tight-loop retries; retry on explicit user action (button) and optionally on reconnect.

## Merge + Dedupe Strategy
Identity approach (strong → weak):
1. `server_id`
2. Fingerprint of stable fields (example): `${start}:${end}:${normalized(text)}`

Merge rules (common default):
- Keep local tombstones: if local says `deleted` and `pending_op=delete`, do not resurrect from server.
- Prefer newer note/edit: compare `local_updated_at` vs server `updated_at` if available.
- Preserve local `client_id` and `sync_status`.

## UI Guidance
- Show sync state near the entity list: `Synced | Saving | Offline | Failed`.
- Add a `Retry sync` button when `failed`.
- Don’t block user writes when offline; queue them.

## Testing Checklist
- Dedupe: server merge doesn’t create duplicates.
- Tombstones: pending delete doesn’t resurrect.
- Offline: create/update/delete marks `pending` and persists locally.
- Failure: marks `failed` and records `last_error`.
- Retry: transitions `failed → pending → synced`.

## Debug Logging Guidance
- Log one-line summary per sync run (counts: pending/failed/synced).
- Log failing entity `client_id`, `server_id`, `pending_op`, and request URL.
- Avoid logging full article text or other large/PII payloads.
