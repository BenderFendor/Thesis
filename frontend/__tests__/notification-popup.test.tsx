import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { NotificationsPopup, type Notification } from "@/components/notification-popup"

const notification: Notification = {
  id: "feed-error",
  title: "Feed unavailable",
  description: "The live index could not be loaded.",
  type: "error",
  action: {
    label: "Retry",
    type: "retry",
  },
}

describe("NotificationsPopup", () => {
  it("renders an accessible dialog and exposes notification actions", async () => {
    const user = userEvent.setup()
    const onAction = jest.fn()
    const onClear = jest.fn()
    const onClose = jest.fn()

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

  it("closes on Escape and renders the empty state", () => {
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
