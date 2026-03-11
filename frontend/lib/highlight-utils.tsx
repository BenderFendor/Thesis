import React from "react"

import { Highlight } from "./api"
import { createHighlightFingerprint } from "./highlight-store"

export type HighlightStableId = string

export function getGlobalOffset(root: HTMLElement, node: Node, offset: number): number {
  if (!root.contains(node) && node !== root) {
    return -1
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let currentNode = walker.nextNode()
  let globalOffset = 0

  while (currentNode) {
    if (currentNode === node) {
      return globalOffset + Math.min(offset, currentNode.textContent?.length ?? 0)
    }

    if (node.nodeType === Node.ELEMENT_NODE && node === currentNode.parentNode) {
      const parent = node as HTMLElement
      const childOffset = Math.min(offset, parent.childNodes.length)
      for (let i = 0; i < childOffset; i += 1) {
        const child = parent.childNodes[i]
        if (child === currentNode) {
          return globalOffset
        }
        globalOffset += child.textContent?.length ?? 0
      }
    }

    globalOffset += currentNode.textContent?.length ?? 0
    currentNode = walker.nextNode()
  }

  return node === root ? Math.min(offset, root.textContent?.length ?? 0) : -1
}

export function highlightStableId(highlight: Highlight): HighlightStableId {
  if (highlight.id !== undefined && highlight.id !== null) {
    return `server:${highlight.id}`
  }
  const anyHighlight = highlight as Highlight & { client_id?: string }
  if (anyHighlight.client_id) {
    return `client:${anyHighlight.client_id}`
  }
  return `range:${highlight.character_start}:${highlight.character_end}:${(highlight.highlighted_text || "").slice(0, 32)}`
}

function getRenderableHighlights(textLength: number, highlights: Highlight[]): Highlight[] {
  const deduped = new Map<string, Highlight>()

  ;[...highlights]
    .filter((highlight) => highlight.character_end > highlight.character_start)
    .map((highlight) => ({
      ...highlight,
      character_start: Math.max(0, Math.min(highlight.character_start, textLength)),
      character_end: Math.max(0, Math.min(highlight.character_end, textLength)),
    }))
    .filter((highlight) => highlight.character_end > highlight.character_start)
    .sort((a, b) => a.character_start - b.character_start)
    .forEach((highlight) => {
      const key = createHighlightFingerprint(highlight)
      const existing = deduped.get(key)
      if (!existing) {
        deduped.set(key, highlight)
        return
      }

      if ((highlight.id ?? 0) > (existing.id ?? 0)) {
        deduped.set(key, highlight)
      }
    })

  return [...deduped.values()].sort((a, b) => a.character_start - b.character_start)
}

function renderTextWithHighlights(
  text: string,
  highlights: Highlight[],
  onHighlightClick?: (id: HighlightStableId, element: HTMLElement) => void,
  activeHighlightId?: HighlightStableId | null,
): React.ReactNode[] {
  if (!text) return []

  const safeHighlights = getRenderableHighlights(text.length, highlights)
  if (safeHighlights.length === 0) {
    return [text]
  }

  const nodes: React.ReactNode[] = []
  let cursor = 0

  safeHighlights.forEach((highlight) => {
    const start = Math.max(cursor, highlight.character_start)
    const end = highlight.character_end
    if (start > cursor) {
      nodes.push(text.slice(cursor, start))
    }

    const stableId = highlightStableId(highlight)
    nodes.push(
      <mark
        key={stableId}
        data-highlight-stable-id={stableId}
        className={`cursor-pointer rounded-sm transition-colors hover:opacity-80 ${getHighlightColorClass(highlight.color)} ${stableId === activeHighlightId ? "ring-2 ring-primary/70" : ""}`}
        onClick={(event) => {
          event.stopPropagation()
          onHighlightClick?.(stableId, event.currentTarget)
        }}
        title={highlight.note || "Click to edit"}
        style={{ WebkitBoxDecorationBreak: "clone", boxDecorationBreak: "clone" }}
      >
        {text.slice(start, end)}
      </mark>,
    )
    cursor = end
  })

  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }

  return nodes
}

export function renderHighlightedContent(
  text: string,
  highlights: Highlight[],
  onHighlightClick?: (id: HighlightStableId, element: HTMLElement) => void,
  activeHighlightId?: HighlightStableId | null,
): React.ReactNode[] {
  if (!text) return []

  return renderTextWithHighlights(text, highlights, onHighlightClick, activeHighlightId)
}

export function getHighlightColorClass(color: string) {
  switch (color) {
    case "yellow":
      return "bg-yellow-200 dark:bg-yellow-900/60 text-yellow-900 dark:text-yellow-100"
    case "blue":
      return "bg-blue-200 dark:bg-blue-900/60 text-blue-900 dark:text-blue-100"
    case "red":
      return "bg-red-200 dark:bg-red-900/60 text-red-900 dark:text-red-100"
    case "green":
      return "bg-green-200 dark:bg-green-900/60 text-green-900 dark:text-green-100"
    case "purple":
      return "bg-purple-200 dark:bg-purple-900/60 text-purple-900 dark:text-purple-100"
    default:
      return "bg-yellow-200 dark:bg-yellow-900/60 text-yellow-900 dark:text-yellow-100"
  }
}

export function getMarkdownWithHighlights(text: string, highlights: Highlight[]): string {
  if (!text) return ""

  const validHighlights = getRenderableHighlights(text.length, highlights || [])
  if (validHighlights.length === 0) return text

  let result = ""
  let cursor = 0

  validHighlights.forEach((highlight) => {
    const start = Math.max(cursor, highlight.character_start)
    const end = highlight.character_end
    if (start > cursor) {
      result += text.slice(cursor, start)
    }
    result += `==${text.slice(start, end)}==`
    cursor = end
  })

  if (cursor < text.length) {
    result += text.slice(cursor)
  }

  return result
}

export function buildObsidianMarkdown(params: {
  article: {
    url: string
    title: string
    author?: string
    publishedAt: string
    content?: string
    summary: string
  }
  fullArticleText?: string | null
  highlights: Highlight[]
}) {
  const { article, fullArticleText, highlights } = params
  const lines: string[] = [
    "---",
    `source: \"${article.url}\"`,
    "author:",
    article.author ? `  - \"[[${article.author}]]\"` : '  - ""',
    `published: \"${article.publishedAt}\"`,
    'tags:',
    '  - "news"',
    'backlinks: ""',
    "---",
    "",
  ]

  const activeHighlights = highlights
    .filter((highlight) => highlight.character_end > highlight.character_start)
    .sort((a, b) => a.character_start - b.character_start)

  if (activeHighlights.length > 0) {
    lines.push("## Highlights\n")
    activeHighlights.forEach((highlight) => {
      const text = highlight.highlighted_text.replace(/\s+/g, " ").trim()
      if (!text) return
      lines.push(`> ${text}`)
      lines.push("")
      lines.push(`- Color: ${highlight.color}`)
      if (highlight.note?.trim()) {
        lines.push(`- Note: ${highlight.note.trim()}`)
      }
      lines.push("")
    })
    lines.push("---", "")
  }

  lines.push("## Full Article\n")
  const fullContent = fullArticleText || article.content || article.summary || ""
  lines.push(getMarkdownWithHighlights(fullContent, activeHighlights))

  return [...lines, "", "[[News Clippings]]"].join("\n")
}
