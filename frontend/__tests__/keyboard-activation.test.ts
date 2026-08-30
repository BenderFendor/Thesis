import { describe, expect, it, jest } from '@jest/globals';
import { activateCardFromKeyDown, shouldActivateCardFromKeyDown } from "@/lib/keyboard-activation"

describe("keyboard activation helpers", () => {
  const currentTarget = { id: "card" },
   descendantTarget = { id: "button" }

  it("only activates for Enter and Space on the card itself", () => {expect.hasAssertions();
    expect(
      shouldActivateCardFromKeyDown({
        currentTarget,
        key: "Enter",
        target: currentTarget,
      } as never),
    ).toBe(true)

    expect(
      shouldActivateCardFromKeyDown({
        currentTarget,
        key: " ",
        target: currentTarget,
      } as never),
    ).toBe(true)

    expect(
      shouldActivateCardFromKeyDown({
        currentTarget,
        key: "Enter",
        target: descendantTarget,
      } as never),
    ).toBe(false)
  })

  it("does not activate nested controls", () => {expect.hasAssertions();
    const preventDefault = jest.fn(),
     onActivate = jest.fn()

    activateCardFromKeyDown(
      {
        currentTarget,
        key: "Enter",
        preventDefault,
        target: descendantTarget,
      } as never,
      onActivate,
    )

    expect(preventDefault).not.toHaveBeenCalled()
    expect(onActivate).not.toHaveBeenCalled()
  })
})
