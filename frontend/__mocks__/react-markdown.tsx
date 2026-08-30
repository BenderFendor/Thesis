import type { ReactNode } from "react";

interface ReactMarkdownMockProps {
  children?: ReactNode;
}

// Faithful test implementation: react-markdown is ESM-only and neither
// transformable by jest nor replaceable via a production DI seam (used
// directly by app/suearch/page.tsx) — replacing its default export with a
// plain pass-through keeps jest rendering the page without loading the
// untransformable package.
export default function ReactMarkdownMock({ children }: ReactMarkdownMockProps) {
  return <div>{children}</div>;
}
