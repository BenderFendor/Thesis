import type { KeyboardEvent } from "react"

type KeyDownEvent = Pick<KeyboardEvent<HTMLElement>, "key" | "target" | "currentTarget">
type KeyDownActivationEvent = Readonly<
  Pick<KeyboardEvent<HTMLElement>, "key" | "target" | "currentTarget" | "preventDefault">
>

const isActivationKey = (key: string): boolean => key === "Enter" || key === " "

const shouldActivateCardFromKeyDown = (event: Readonly<KeyDownEvent>): boolean =>
  event.target === event.currentTarget && isActivationKey(event.key)

const activateCardFromKeyDown = (
  event: Readonly<KeyDownActivationEvent>,
  onActivate: () => void,
): void => {
  if (!shouldActivateCardFromKeyDown(event)) {
    return
  }
  event.preventDefault()
  onActivate()
}

export { activateCardFromKeyDown, isActivationKey, shouldActivateCardFromKeyDown }
