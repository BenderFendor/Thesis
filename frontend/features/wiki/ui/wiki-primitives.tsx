import type { ReactElement } from "react";

interface PanelProps {
  readonly children: Readonly<ReactElement> | readonly Readonly<ReactElement>[];
  readonly eyebrow: string;
  readonly title: string;
}

interface SidebarCardProps {
  readonly children: Readonly<ReactElement> | readonly Readonly<ReactElement>[];
  readonly title: string;
}

interface SidebarFactProps {
  readonly label: string;
  readonly value: string;
}

const Panel = ({ children, eyebrow, title }: Readonly<Pick<PanelProps, "children" | "eyebrow" | "title">>) => (
  <section>
    <div className="mb-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {eyebrow}
      </div>
      <h2 className="mt-1 font-serif text-2xl">{title}</h2>
    </div>
    {children}
  </section>
);

const SidebarCard = ({ children, title }: Readonly<Pick<SidebarCardProps, "children" | "title">>) => (
  <div className="mt-4 rounded-2xl border border-white/5 bg-black/20 p-4 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
    <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {title}
    </div>
    {children}
  </div>
);

const SidebarFact = ({ label, value }: SidebarFactProps) => (
  <div className="mt-2 flex items-start justify-between gap-3 text-[10px] font-mono uppercase tracking-widest">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right">{value}</span>
  </div>
);

export { Panel, SidebarCard, SidebarFact };
