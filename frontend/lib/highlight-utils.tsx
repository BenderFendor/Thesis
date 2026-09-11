import type { Highlight } from "./api"
import type { ReactNode } from "react"
import { getRenderableHighlights } from "./highlight-processing"

type HighlightStableId = string

interface HighlightAnchorElement {
  readonly contains: HTMLElement["contains"]
  readonly getBoundingClientRect: () => DOMRect
}

interface HighlightPointerEvent {
  readonly currentTarget: HighlightAnchorElement
  readonly stopPropagation: () => void
}

interface HighlightKeyboardEvent {
  readonly currentTarget: HighlightAnchorElement
  readonly key: string
  readonly preventDefault: () => void
  readonly stopPropagation: () => void
}

type HighlightClickHandler = (
  stableId: HighlightStableId,
  element: HighlightAnchorElement,
) => void

interface HighlightHandlers {
  readonly handleClick: (event: Readonly<HighlightPointerEvent>) => void
  readonly handleKeyDown: (event: Readonly<HighlightKeyboardEvent>) => void
}

interface HighlightRenderState {
  cursor: number
  nodes: ReactNode[]
}

interface HighlightRange {
  readonly end: number
  readonly start: number
}

const EMPTY_TEXT_LENGTH = 0,
 FIRST_INDEX = 0,
 FIRST_TAB_INDEX = 0,
 HIGHLIGHT_COLOR_CLASSES = new Map<string, string>([
  ["blue", "bg-blue-200 dark:bg-blue-900/60 text-blue-900 dark:text-blue-100"],
  ["green", "bg-green-200 dark:bg-green-900/60 text-green-900 dark:text-green-100"],
  ["purple", "bg-purple-200 dark:bg-purple-900/60 text-purple-900 dark:text-purple-100"],
  ["red", "bg-red-200 dark:bg-red-900/60 text-red-900 dark:text-red-100"],
  ["yellow", "bg-yellow-200 dark:bg-yellow-900/60 text-yellow-900 dark:text-yellow-100"],
 ]),
 HIGHLIGHT_MARK_STYLE = { WebkitBoxDecorationBreak: "clone", boxDecorationBreak: "clone" } as const,
 HIGHLIGHT_PREVIEW_LENGTH = 32,

 createHighlightHandlers = (
  stableId: HighlightStableId,
  onHighlightClick: HighlightClickHandler | undefined,
): HighlightHandlers => {
  const activateHighlight = (element: HighlightAnchorElement): void => {
    onHighlightClick?.(stableId, element)
  },
   handleClick = (event: Readonly<HighlightPointerEvent>): void => {
    event.stopPropagation()
    activateHighlight(event.currentTarget)
  },
   handleKeyDown = (event: Readonly<HighlightKeyboardEvent>): void => {
    if (event.key !== "Enter" && event.key !== " ") {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    activateHighlight(event.currentTarget)
  }

  return { handleClick, handleKeyDown }
 },

 getActiveHighlightClassName = (
  stableId: HighlightStableId,
  activeHighlightId: HighlightStableId | null | undefined,
): string => {
  if (stableId === activeHighlightId) {
    return " ring-2 ring-primary/70"
  }
  return ""
 },

 getHighlightColorClass = (color: string): string =>
  HIGHLIGHT_COLOR_CLASSES.get(color) ?? HIGHLIGHT_COLOR_CLASSES.get("yellow") ?? "",

 getHighlightRange = (highlight: Readonly<Highlight>, cursor: number): HighlightRange => ({
  end: highlight.character_end,
  start: Math.max(cursor, highlight.character_start),
 }),

 highlightStableId = (highlight: Readonly<Highlight>): HighlightStableId => {
  if (highlight.id !== undefined) {
    return `server:${highlight.id}`
  }
  if (highlight.client_id !== undefined && highlight.client_id.length > EMPTY_TEXT_LENGTH) {
    return `client:${highlight.client_id}`
  }
  return `range:${highlight.character_start}:${highlight.character_end}:${highlight.highlighted_text.slice(FIRST_INDEX, HIGHLIGHT_PREVIEW_LENGTH)}`
 },

 renderHighlightedContent = (
  text: string,
  highlights: readonly Readonly<Highlight>[],
  onHighlightClick?: HighlightClickHandler,
  activeHighlightId?: HighlightStableId | null,
): ReactNode[] => renderTextWithHighlights(text, highlights, onHighlightClick, activeHighlightId),

 renderTextWithHighlights = (
  text: string,
  highlights: readonly Readonly<Highlight>[],
  onHighlightClick: HighlightClickHandler | undefined,
  activeHighlightId: HighlightStableId | null | undefined,
): ReactNode[] => {
  const renderState: HighlightRenderState = { cursor: FIRST_INDEX, nodes: [] },
   safeHighlights = getRenderableHighlights(text.length, highlights)
  if (text.length === EMPTY_TEXT_LENGTH) {
    return []
  }
  if (safeHighlights.length === EMPTY_TEXT_LENGTH) {
    return [text]
  }

  safeHighlights.forEach((highlight) => {
    const { end, start } = getHighlightRange(highlight, renderState.cursor),
     stableId = highlightStableId(highlight),
     { handleClick, handleKeyDown } = createHighlightHandlers(stableId, onHighlightClick)
    if (end <= renderState.cursor) {
      return
    }
    if (start > renderState.cursor) {
      renderState.nodes.push(text.slice(renderState.cursor, start))
    }
    renderState.nodes.push(
      <button
        key={stableId}
        type="button"
        data-highlight-stable-id={stableId}
        className={`appearance-none border-0 bg-transparent p-0 font-inherit text-inherit text-left cursor-pointer transition-colors hover:opacity-80 ${getHighlightColorClass(highlight.color)}${getActiveHighlightClassName(stableId, activeHighlightId)}`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        tabIndex={FIRST_TAB_INDEX}
        title={highlight.note ?? "Click to edit"}
        style={HIGHLIGHT_MARK_STYLE}
      >
        {text.slice(start, end)}
      </button>,
    )
    renderState.cursor = end
  })

  if (renderState.cursor < text.length) {
    renderState.nodes.push(text.slice(renderState.cursor))
  }
  return renderState.nodes
 }

export {
  getHighlightColorClass,
  highlightStableId,
  renderHighlightedContent,
}
export { getGlobalOffset } from "./highlight-offset"
export { buildObsidianMarkdown, getMarkdownWithHighlights } from "./highlight-markdown"
export type { HighlightStableId }
