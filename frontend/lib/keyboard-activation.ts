import type { KeyboardEvent } from "react"

export function isActivationKey(key: string): boolean {
  return key === "Enter" || key === " "
}

export function shouldActivateCardFromKeyDown(
  event: Pick<KeyboardEvent<HTMLElement>, "key" | "target" | "currentTarget">,
): boolean {
  return event.target === event.currentTarget && isActivationKey(event.key)
}

export function activateCardFromKeyDown(
  event: Pick<
    KeyboardEvent<HTMLElement>,
    "key" | "target" | "currentTarget" | "preventDefault"
  >,
  onActivate: () => void,
): void {
  if (!shouldActivateCardFromKeyDown(event)) {
    return
  }

  event.preventDefault()
  onActivate()
}
