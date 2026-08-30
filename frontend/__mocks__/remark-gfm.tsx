// Faithful test implementation: remark-gfm is ESM-only and cannot be
// transformed by jest. The page passes the plugin into ReactMarkdown's
// remarkPlugins; the mock markdown renderer ignores plugins, so a no-op
// plugin shape is all that is needed.
export default function remarkGfmMock() {
  return () => undefined;
}
