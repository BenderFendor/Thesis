import type { Highlight } from "./api"
import { getRenderableHighlights } from "./highlight-processing"

const EMPTY_TEXT_LENGTH = 0,

 buildObsidianMarkdown = ({ article, fullArticleText, highlights }: Readonly<ObsidianMarkdownParams>): string => {
  const activeHighlights = highlights
    .filter((highlight) => highlight.character_end > highlight.character_start)
    .toSorted(
      (leftHighlight, rightHighlight) => leftHighlight.character_start - rightHighlight.character_start,
    ),
   fullContent = getFullArticleContent(article, fullArticleText),
   lines: string[] = [
    "---",
    `source: "${article.url}"`,
    formatAuthorLine(article.author),
    `published: "${article.publishedAt}"`,
    "tags:",
    '  - "news"',
    'backlinks: ""',
    "---",
    "",
  ]

  if (activeHighlights.length > EMPTY_TEXT_LENGTH) {
    lines.push("## Highlights\n")
    activeHighlights.forEach((highlight) => {
      const note = highlight.note?.trim(),
       text = highlight.highlighted_text.replaceAll(/\s+/gu, " ").trim()
      if (text.length === EMPTY_TEXT_LENGTH) {
        return
      }
      lines.push(`> ${text}`, "", `- Color: ${highlight.color}`)
      if (note !== undefined && note.length > EMPTY_TEXT_LENGTH) {
        lines.push(`- Note: ${note}`)
      }
      lines.push("")
    })
    lines.push("---", "")
  }

  lines.push("## Full Article\n", getMarkdownWithHighlights(fullContent, activeHighlights))

  return [...lines, "", "[[News Clippings]]"].join("\n")
 },

 formatAuthorLine = (author: string | undefined): string => {
  if (author === undefined || author.length === EMPTY_TEXT_LENGTH) {
    return '  - ""'
  }
  return `  - "[[${author}]]"`
 },

 getFullArticleContent = (
  article: Readonly<HighlightArticle>,
  fullArticleText: string | null | undefined,
): string => {
  let fullContent = fullArticleText ?? article.summary
  if (fullContent.length === EMPTY_TEXT_LENGTH && article.content !== undefined) {
    fullContent = article.content
  }
  return fullContent
 },

 getMarkdownWithHighlights = (
  text: string,
  highlights: readonly Readonly<Highlight>[],
): string => {
  if (text.length === EMPTY_TEXT_LENGTH) {
    return ""
  }

  const validHighlights = getRenderableHighlights(text.length, highlights)
  if (validHighlights.length === EMPTY_TEXT_LENGTH) {
    return text
  }

  let cursor = 0,
   result = ""

  validHighlights.forEach((highlight) => {
    const end = highlight.character_end,
     start = Math.max(cursor, highlight.character_start)
    if (end <= cursor) {
      return
    }
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

interface HighlightArticle {
  readonly author?: string
  readonly content?: string
  readonly publishedAt: string
  readonly summary: string
  readonly title: string
  readonly url: string
}

interface ObsidianMarkdownParams {
  readonly article: HighlightArticle
  readonly fullArticleText?: string | null
  readonly highlights: readonly Readonly<Highlight>[]
}

export { buildObsidianMarkdown, getMarkdownWithHighlights }
