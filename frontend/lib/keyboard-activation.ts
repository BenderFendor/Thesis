interface KeyDownEvent {
  readonly currentTarget: Readonly<EventTarget>
  readonly key: string
  readonly target: Readonly<EventTarget> | null
}

interface KeyDownActivationEvent extends KeyDownEvent {
  readonly preventDefault: () => void
}

const activateCardFromKeyDown = (
  event: Readonly<KeyDownActivationEvent>,
  onActivate: () => void,
): void => {
  if (!shouldActivateCardFromKeyDown(event)) {
    return
  }
  event.preventDefault()
  onActivate()
},
  isActivationKey = (key: string): boolean => key === "Enter" || key === " ",
  shouldActivateCardFromKeyDown = (event: Readonly<KeyDownEvent>): boolean =>
  event.target === event.currentTarget && isActivationKey(event.key);

export { activateCardFromKeyDown, isActivationKey, shouldActivateCardFromKeyDown }
