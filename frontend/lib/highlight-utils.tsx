
import { Highlight } from "./api";
import React from "react";

/**
 * Calculates the absolute character offset of a point (node, offset) relative to a root element.
 * 
 * @param root The root element containing the text.
 * @param node The node where the selection starts or ends.
 * @param offset The offset within that node.
 * @returns The global character offset or -1 if the node is not inside root.
 */
export function getGlobalOffset(root: HTMLElement, node: Node, offset: number): number {
  // If node is the root itself, the offset refers to child index, not characters.
  // We need to sum up text lengths of all children before that index.
  if (node === root) {
      let globalOffset = 0;
      for (let i = 0; i < offset; i++) {
          globalOffset += root.childNodes[i].textContent?.length || 0;
      }
      return globalOffset;
  }

  let current: Node | null = node;
  let globalOffset = 0;

  // Add the local offset if it's a text node. 
  // If it's an element node (unlikely for selection anchor usually, but possible), 
  // 'offset' is child index, so we should sum children before it? 
  // Standard getSelection() usually gives text node for text selection.
  if (current.nodeType === Node.TEXT_NODE) {
      globalOffset += offset;
  } else {
      // If it's an element, offset is child index. 
      // This is rare for text selection but happens if selecting "element" as a whole.
      // For simplicity, let's just try to find the start of that element.
      // Or we can traverse children.
      // Let's iterate children up to offset.
      for (let i = 0; i < offset; i++) {
        globalOffset += current.childNodes[i].textContent?.length || 0;
      }
  }

  // Traverse up to the root
  while (current && current !== root) {
    let prev = current.previousSibling;
    while (prev) {
      globalOffset += prev.textContent?.length || 0;
      prev = prev.previousSibling;
    }
    current = current.parentNode;
  }
  
  if (current !== root) {
      return -1; // Node not found inside root
  }

  return globalOffset;
}

/**
 * Renders the text with highlights applied.
 * Uses a simple non-overlapping approach. If highlights overlap, visual results might be mixed,
 * but this handles the basic case of sequential highlights.
 */
export type HighlightStableId = string

export function highlightStableId(highlight: Highlight): HighlightStableId {
  if (highlight.id !== undefined && highlight.id !== null) {
    return `server:${highlight.id}`
  }
  const anyHighlight = highlight as unknown as { client_id?: string }
  if (anyHighlight.client_id) {
    return `client:${anyHighlight.client_id}`
  }
  return `range:${highlight.character_start}:${highlight.character_end}:${(highlight.highlighted_text || '').slice(0, 32)}`
}

export function renderHighlightedContent(
  text: string,
  highlights: Highlight[],
  onHighlightClick?: (id: HighlightStableId, element: HTMLElement) => void,
  activeHighlightId?: HighlightStableId | null
): React.ReactNode[] {
  if (!text) return [];
  if (!highlights || highlights.length === 0) return [text];

  // Sort highlights by start position
  const sortedHighlights = [...highlights].sort((a, b) => a.character_start - b.character_start);
  
  const nodes: React.ReactNode[] = [];
  let currentPosition = 0;

  sortedHighlights.forEach((highlight) => {
    const start = Math.max(highlight.character_start, currentPosition)
    const end = highlight.character_end

    if (start >= text.length) return
    if (end <= start) return

    if (start > currentPosition) {
      nodes.push(text.slice(currentPosition, start))
    }

    const highlightedText = text.slice(start, Math.min(end, text.length))
    const stableId = highlightStableId(highlight)

    nodes.push(
      <mark
        key={stableId}
        data-highlight-stable-id={stableId}
        className={`cursor-pointer transition-colors hover:opacity-80 rounded-sm px-0.5 mx-0.5 ${getHighlightColorClass(highlight.color)} ${stableId === activeHighlightId ? "ring-2 ring-primary/70" : ""}`}
        onClick={(e) => {
          e.stopPropagation()
          onHighlightClick?.(stableId, e.currentTarget)
        }}
        title={highlight.note || "Click to edit"}
      >
        {highlightedText}
      </mark>
    )

    currentPosition = Math.min(end, text.length)
  })

  // Add remaining text
  if (currentPosition < text.length) {
    nodes.push(text.slice(currentPosition));
  }

  return nodes;
}

export function getHighlightColorClass(color: string) {
    switch (color) {
      case "yellow":
        return "bg-yellow-200 dark:bg-yellow-900/60 text-yellow-900 dark:text-yellow-100";
      case "blue":
        return "bg-blue-200 dark:bg-blue-900/60 text-blue-900 dark:text-blue-100";
      case "red":
        return "bg-red-200 dark:bg-red-900/60 text-red-900 dark:text-red-100";
      case "green": // Adding extra colors just in case
        return "bg-green-200 dark:bg-green-900/60 text-green-900 dark:text-green-100";
      case "purple":
        return "bg-purple-200 dark:bg-purple-900/60 text-purple-900 dark:text-purple-100";
      default:
        return "bg-yellow-200 dark:bg-yellow-900/60 text-yellow-900 dark:text-yellow-100";
    }
  }
