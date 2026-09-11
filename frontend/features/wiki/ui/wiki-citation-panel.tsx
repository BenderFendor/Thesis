import { hasText } from "@/lib/utils";
import { Panel } from "./wiki-primitives";
import type { ReactNode } from "react";

interface WikiCitation {
  readonly label: string;
  readonly note?: string;
  readonly url?: string;
}

interface WikiCitationPanelProps {
  readonly citations: readonly WikiCitation[];
  readonly eyebrow?: string;
  readonly title?: string;
}

const CitationRow = ({ citation }: Readonly<{ citation: WikiCitation }>) => (
  <div>
    {(() => {
  if (hasText(citation.url)) {
    return <a href={citation.url} target="_blank" rel="noreferrer" className="text-muted-foreground transition-colors hover:text-white">
        {citation.label}
      </a>;
  }
  return <span className="text-muted-foreground">{citation.label}</span>;
})()}
    {Boolean(citation.note) && <span className="ml-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        {citation.note}
      </span>}
  </div>
);

const WikiCitationPanel = ({
  citations,
  eyebrow = "Public references used for this page",
  title = "Citations",
}: WikiCitationPanelProps): ReactNode => (
  <Panel title={title} eyebrow={eyebrow}>
    <div className="space-y-2 rounded-2xl border border-white/5 bg-black/20 p-5 text-sm transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
      {citations.map((citation) => (
        <CitationRow
          key={`${citation.label}-${citation.url ?? citation.note ?? "reference"}`}
          citation={citation}
        />
      ))}
    </div>
  </Panel>
);

export { WikiCitationPanel };
