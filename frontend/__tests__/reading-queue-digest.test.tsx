import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";

import { QueueDigestView } from "@/components/reading-queue-digest";
import { Sheet } from "@/components/ui/sheet";

const noop = (): void => undefined;

describe("queueDigestView", () => {
  it("shows the digest failure returned by the queue mutation", () => {  expect.hasAssertions();

    render(
      <Sheet open>
        <QueueDigestView
          articleCount={2}
          digestError="Queue digest failed (503)"
          digestLoading={false}
          onClose={noop}
          onEmbedClose={noop}
          onNavigateArticle={noop}
          onOpenArticle={noop}
        />
      </Sheet>,
    );

    expect(screen.getByText("Queue digest failed (503)")).toBeInTheDocument();
  });
});
