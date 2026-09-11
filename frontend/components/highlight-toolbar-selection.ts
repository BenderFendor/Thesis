import type { Highlight } from "@/lib/api";
import { createHighlightFingerprint } from "@/lib/highlight-store";

interface HighlightNodeSnapshot {
  readonly asNode: () => Node;
  readonly nodeName: string;
}

interface HighlightRangeSnapshot {
  readonly commonAncestorContainer: HighlightNodeSnapshot;
  readonly endContainer: HighlightNodeSnapshot;
  readonly endOffset: number;
  readonly getBoundingClientRect: () => DOMRect;
  readonly startContainer: HighlightNodeSnapshot;
  readonly startOffset: number;
}

interface HighlightSelectionSnapshot {
  readonly anchorNode: HighlightNodeSnapshot | null;
  readonly focusNode: HighlightNodeSnapshot | null;
}

interface SelectionSnapshot {
  readonly range: HighlightRangeSnapshot;
  readonly selection: HighlightSelectionSnapshot;
  readonly text: string;
}

interface SelectionOffsets {
  readonly end: number;
  readonly start: number;
}

interface HighlightElementView {
  readonly clientHeight: number;
  readonly contains: HTMLElement["contains"];
  readonly getBoundingClientRect: () => DOMRect;
  readonly isConnected: boolean;
  readonly nodeName: string;
}

type ReadonlyHighlightElement = Readonly<HighlightElementView>;

const EMPTY_RANGE_COUNT = 0,
  FIRST_RANGE_INDEX = 0,
  createNodeSnapshot = <TNode extends Node>(node: Readonly<TNode>): HighlightNodeSnapshot => ({
    asNode: () => node,
    nodeName: node.nodeName,
  }),
  getHighlightElementView = <TElement extends HTMLElement>(
    element: Readonly<TElement>,
  ): ReadonlyHighlightElement => ({
    clientHeight: element.clientHeight,
    contains: (node) => element.contains(node),
    getBoundingClientRect: () => element.getBoundingClientRect(),
    isConnected: element.isConnected,
    nodeName: element.nodeName,
  }),
  getSelectionSnapshot = (): SelectionSnapshot | undefined => {
    const selection = globalThis.getSelection();
    if (selection === null || selection.rangeCount === EMPTY_RANGE_COUNT) {
      return void 0;
    }
    const text = selection.toString();
    if (selection.isCollapsed || text.trim().length === EMPTY_RANGE_COUNT) {
      return void 0;
    }
    const range = selection.getRangeAt(FIRST_RANGE_INDEX);
    return {
      range: {
        commonAncestorContainer: createNodeSnapshot(range.commonAncestorContainer),
        endContainer: createNodeSnapshot(range.endContainer),
        endOffset: range.endOffset,
        getBoundingClientRect: () => range.getBoundingClientRect(),
        startContainer: createNodeSnapshot(range.startContainer),
        startOffset: range.startOffset,
      },
      selection: {
        anchorNode: (() => {
          if (selection.anchorNode === null) {
            return null;
          }
          return createNodeSnapshot(selection.anchorNode);
        })(),
        focusNode: (() => {
          if (selection.focusNode === null) {
            return null;
          }
          return createNodeSnapshot(selection.focusNode);
        })(),
      },
      text,
    };
  };

const isDeletedHighlight = (highlight: Readonly<Highlight>): boolean =>
  "deleted" in highlight && highlight.deleted === true;

const hasExactDuplicate = (
  highlights: readonly Highlight[],
  highlightedText: string,
  offsets: Readonly<SelectionOffsets>,
): boolean => {
  const fingerprint = createHighlightFingerprint({
    character_end: offsets.end,
    character_start: offsets.start,
    highlighted_text: highlightedText,
  });
  return highlights.some((highlight) => {
    if (isDeletedHighlight(highlight)) {
      return false;
    }
    return (
      createHighlightFingerprint({
        character_end: highlight.character_end,
        character_start: highlight.character_start,
        highlighted_text: highlight.highlighted_text,
      }) === fingerprint
    );
  });
};

export {
  getHighlightElementView,
  getSelectionSnapshot,
  hasExactDuplicate,
  type HighlightElementView,
  type HighlightRangeSnapshot,
  type ReadonlyHighlightElement,
  type SelectionOffsets,
  type SelectionSnapshot,
};
