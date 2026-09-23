import type { ReactElement, RefObject } from "react";

interface GlobeCanvasProps {
  readonly children: Readonly<ReactElement>;
  readonly containerRef: Readonly<RefObject<HTMLDivElement | null>>;
}

const GlobeCanvas = ({ children, containerRef }: Readonly<GlobeCanvasProps>): ReactElement => (
  <div
    ref={containerRef}
    className="relative h-full w-full overflow-hidden bg-[var(--news-bg-primary)]"
  >
    {children}
  </div>
);

export { GlobeCanvas };
