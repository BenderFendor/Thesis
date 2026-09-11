import { activateCardFromKeyDown, shouldActivateCardFromKeyDown } from "@/lib/keyboard-activation";
import { describe, expect, it, jest } from "@jest/globals";

describe("keyboard activation helpers", () => {
  const currentTarget = new EventTarget(),
    descendantTarget = new EventTarget();

  it("only activates for Enter and Space on the card itself", () => {
    expect.hasAssertions();
    const enterEvent: Parameters<typeof shouldActivateCardFromKeyDown>[0] = {
      currentTarget,
      key: "Enter",
      target: currentTarget,
    };
    expect(shouldActivateCardFromKeyDown(enterEvent)).toBe(true);

    const spaceEvent: Parameters<typeof shouldActivateCardFromKeyDown>[0] = {
      currentTarget,
      key: " ",
      target: currentTarget,
    };
    expect(shouldActivateCardFromKeyDown(spaceEvent)).toBe(true);

    const descendantEvent: Parameters<typeof shouldActivateCardFromKeyDown>[0] = {
      currentTarget,
      key: "Enter",
      target: descendantTarget,
    };
    expect(shouldActivateCardFromKeyDown(descendantEvent)).toBe(false);
  });

  it("does not activate nested controls", () => {
    expect.hasAssertions();
    const onActivate = jest.fn<() => void>(),
      preventDefault = jest.fn<() => void>();

    const descendantEvent: Parameters<typeof activateCardFromKeyDown>[0] = {
        currentTarget,
        key: "Enter",
        preventDefault,
        target: descendantTarget,
      };
    activateCardFromKeyDown(descendantEvent, onActivate);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });
});
