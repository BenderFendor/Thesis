import { describe, expect, it } from "@jest/globals";
import { render } from "@testing-library/react";

import { GlobeCanvas } from "@/components/interactive-globe-canvas";

interface ContainerRef {
  current: HTMLDivElement | null;
}

const renderGlobeCanvas = (containerRef: Readonly<ContainerRef>): void => {
  render(
    <GlobeCanvas containerRef={containerRef}>
      <span>globe</span>
    </GlobeCanvas>,
  );
};

describe("globeCanvas", () => {
  it("attaches the host ref used by the globe resize observer", () => {
    const containerRef: ContainerRef = { current: null };
    renderGlobeCanvas(containerRef);

    expect(containerRef.current).not.toBeNull();
    expect(containerRef.current).toHaveClass("h-full", "w-full");
  });
});
