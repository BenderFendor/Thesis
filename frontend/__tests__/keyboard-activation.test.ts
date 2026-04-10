import { activateCardFromKeyDown, shouldActivateCardFromKeyDown } from "@/lib/keyboard-activation"

describe("keyboard activation helpers", () => {
  const currentTarget = { id: "card" }
  const descendantTarget = { id: "button" }

  it("only activates for Enter and Space on the card itself", () => {
    expect(
      shouldActivateCardFromKeyDown({
        key: "Enter",
        currentTarget,
        target: currentTarget,
      } as never),
    ).toBe(true)

    expect(
      shouldActivateCardFromKeyDown({
        key: " ",
        currentTarget,
        target: currentTarget,
      } as never),
    ).toBe(true)

    expect(
      shouldActivateCardFromKeyDown({
        key: "Enter",
        currentTarget,
        target: descendantTarget,
      } as never),
    ).toBe(false)
  })

  it("does not activate nested controls", () => {
    const preventDefault = jest.fn()
    const onActivate = jest.fn()

    activateCardFromKeyDown(
      {
        key: "Enter",
        currentTarget,
        target: descendantTarget,
        preventDefault,
      } as never,
      onActivate,
    )

    expect(preventDefault).not.toHaveBeenCalled()
    expect(onActivate).not.toHaveBeenCalled()
  })
})
