import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from "@testing-library/react"
import type { Notification } from '@/components/notification-popup';

import { NotificationsPopup } from '@/components/notification-popup';
import userEvent from "@testing-library/user-event"

const notification: Notification = {
  action: {
    label: "Retry",
    type: "retry",
  },
  description: "The live index could not be loaded.",
  id: "feed-error",
  title: "Feed unavailable",
  type: "error",
}

describe("notificationsPopup", () => {
  it("renders an accessible dialog and exposes notification actions", async () => {expect.hasAssertions();
    const onAction = jest.fn(),
     onClear = jest.fn(),
     onClose = jest.fn(),
     user = userEvent.setup()

    render(
      <NotificationsPopup
        notifications={[notification]}
        onAction={onAction}
        onClear={onClear}
        onClearAll={jest.fn()}
        onClose={onClose}
      />,
    )

    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(onAction).toHaveBeenCalledWith("retry", notification)

    await user.click(screen.getByRole("button", { name: "Clear Feed unavailable" }))
    expect(onClear).toHaveBeenCalledWith("feed-error")

    await user.click(screen.getByRole("button", { name: "Close notifications" }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("closes on Escape and renders the empty state", () => {expect.hasAssertions();
    const onClose = jest.fn()

    render(
      <NotificationsPopup
        notifications={[]}
        onClear={jest.fn()}
        onClearAll={jest.fn()}
        onClose={onClose}
      />,
    )

    expect(screen.getByText("You're all caught up.")).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
