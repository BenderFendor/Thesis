import type { ReactElement } from "react";

interface GlobeCanvasProps {
  readonly children: Readonly<ReactElement>;
}

const GlobeCanvas = ({ children }: Readonly<GlobeCanvasProps>): ReactElement => (
  <div className="relative h-full w-full overflow-hidden bg-[var(--news-bg-primary)]">{children}</div>
);

export { GlobeCanvas };
