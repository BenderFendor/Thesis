import { activateCardFromKeyDown, shouldActivateCardFromKeyDown } from "@/lib/keyboard-activation"
import { describe, expect, it, jest } from '@jest/globals';

describe("keyboard activation helpers", () => {
  const currentTarget = new EventTarget(),
   descendantTarget = new EventTarget()

  it("only activates for Enter and Space on the card itself", () => {expect.hasAssertions();
    expect(
      shouldActivateCardFromKeyDown({
        currentTarget,
        key: "Enter",
        target: currentTarget,
      }),
    ).toBe(true)

    expect(
      shouldActivateCardFromKeyDown({
        currentTarget,
        key: " ",
        target: currentTarget,
      }),
    ).toBe(true)

    expect(
      shouldActivateCardFromKeyDown({
        currentTarget,
        key: "Enter",
        target: descendantTarget,
      }),
    ).toBe(false)
  })

  it("does not activate nested controls", () => {expect.hasAssertions();
    const onActivate = jest.fn(),
     preventDefault = jest.fn()

    activateCardFromKeyDown(
      {
        currentTarget,
        key: "Enter",
        preventDefault,
        target: descendantTarget,
      },
      onActivate,
    )

    expect(preventDefault).not.toHaveBeenCalled()
    expect(onActivate).not.toHaveBeenCalled()
  })
})
