import type { Highlight } from "./api"
import { createHighlightFingerprint } from "./highlight-store"

const EMPTY_TEXT_LENGTH = 0,
 FIRST_INDEX = 0,

 clampHighlightToTextLength = (
  highlight: Readonly<Highlight>,
  textLength: number,
): Readonly<Highlight> => ({
  ...highlight,
  character_end: Math.max(EMPTY_TEXT_LENGTH, Math.min(highlight.character_end, textLength)),
  character_start: Math.max(EMPTY_TEXT_LENGTH, Math.min(highlight.character_start, textLength)),
}),

 getRenderableHighlights = (
  textLength: number,
  highlights: readonly Readonly<Highlight>[],
): readonly Readonly<Highlight>[] => {
  const deduped = new Map<string, Readonly<Highlight>>()

  highlights
    .filter((highlight) => highlight.character_end > highlight.character_start)
    .map((highlight) => clampHighlightToTextLength(highlight, textLength))
    .filter((highlight) => highlight.character_end > highlight.character_start)
    .toSorted(
      (leftHighlight, rightHighlight) => leftHighlight.character_start - rightHighlight.character_start,
    )
    .forEach((highlight) => {
      const existing = deduped.get(createHighlightFingerprint(highlight)),
       key = createHighlightFingerprint(highlight)
      if (existing === undefined) {
        deduped.set(key, highlight)
        return
      }

      if ((highlight.id ?? FIRST_INDEX) > (existing.id ?? FIRST_INDEX)) {
        deduped.set(key, highlight)
      }
    })

  return [...deduped.values()].toSorted(
    (leftHighlight, rightHighlight) => leftHighlight.character_start - rightHighlight.character_start,
  )
}

export { getRenderableHighlights }
