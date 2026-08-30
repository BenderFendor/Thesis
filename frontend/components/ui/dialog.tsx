"use client";

import {
  Close,
  Content,
  Description,
  Overlay,
  Portal,
  Root,
  Title,
  Trigger,
} from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { createElement } from "react";

interface DialogRootProps {
  readonly children?: import("react").ReactNode;
  readonly onOpenChange?: (open: boolean) => void;
  readonly open?: boolean;
}

interface DialogTriggerProps {
  readonly asChild?: boolean;
  readonly children?: import("react").ReactNode;
}

interface DialogPortalProps {
  readonly children?: import("react").ReactNode;
  readonly container?: HTMLElement;
  readonly forceMount?: boolean;
}

interface DialogCloseProps {
  readonly asChild?: boolean;
  readonly children?: import("react").ReactNode;
}

interface DialogOverlayProps {
  readonly children?: import("react").ReactNode;
  readonly className?: string;
  readonly forceMount?: boolean;
}

interface DialogContentProps {
  readonly children?: import("react").ReactNode;
  readonly className?: string;
  readonly forceMount?: boolean;
  readonly onCloseAutoFocus?: (event: Readonly<Event>) => void;
  readonly onEscapeKeyDown?: (event: Readonly<Event>) => void;
  readonly onInteractOutside?: (event: Readonly<Event>) => void;
  readonly onOpenAutoFocus?: (event: Readonly<Event>) => void;
  readonly onPointerDownOutside?: (event: Readonly<Event>) => void;
  readonly showCloseButton?: boolean;
}

interface DialogHeaderProps {
  readonly children?: import("react").ReactNode;
  readonly className?: string;
}

interface DialogFooterProps {
  readonly children?: import("react").ReactNode;
  readonly className?: string;
}

interface DialogTitleProps {
  readonly children?: import("react").ReactNode;
  readonly className?: string;
}

interface DialogDescriptionProps {
  readonly children?: import("react").ReactNode;
  readonly className?: string;
}

const Dialog = (props: Readonly<DialogRootProps>) =>
  createElement(Root, props, props.children);

const DialogTrigger = (props: Readonly<DialogTriggerProps>) =>
  createElement(Trigger, props, props.children);

const DialogPortal = (props: Readonly<DialogPortalProps>) =>
  createElement(Portal, props, props.children);

const DialogClose = (props: Readonly<DialogCloseProps>) =>
  createElement(Close, props, props.children);

const DialogOverlay = ({ className, forceMount }: Readonly<DialogOverlayProps>) =>
  createElement(Overlay, {
    className: cn(
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
      className,
    ),
    forceMount,
  });

const DialogCloseButton = () => (
  <Close
    data-slot="dialog-close"
    className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
  >
    <XIcon />
    <span className="sr-only">Close</span>
  </Close>
);

const DialogContent = ({
  className,
  forceMount,
  onCloseAutoFocus,
  onEscapeKeyDown,
  onInteractOutside,
  onOpenAutoFocus,
  onPointerDownOutside,
  showCloseButton = true,
  ...props
}: Readonly<DialogContentProps>) => {
  const closeButton = showCloseButton ? createElement(DialogCloseButton) : undefined;
  const contentProps = {
    className: cn(
      "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
      className,
    ),
    forceMount,
    onCloseAutoFocus,
    onEscapeKeyDown,
    onInteractOutside,
    onOpenAutoFocus,
    onPointerDownOutside,
  };
  return createElement(
    Portal,
    { forceMount },
    createElement(Overlay, {
      className: cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
      ),
      forceMount,
    }),
    createElement(Content, contentProps, props.children, closeButton),
  );
};

const DialogHeader = ({ className }: Readonly<DialogHeaderProps>) =>
  createElement("div", {
    className: cn("flex flex-col gap-2 text-center sm:text-left", className),
  });

const DialogFooter = ({ className }: Readonly<DialogFooterProps>) =>
  createElement("div", {
    className: cn(
      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      className,
    ),
  });

const DialogTitle = ({ className }: Readonly<DialogTitleProps>) =>
  createElement(Title, {
    className: cn("text-lg leading-none font-semibold", className),
  });

const DialogDescription = ({ className }: Readonly<DialogDescriptionProps>) =>
  createElement(Description, {
    className: cn("text-sm text-muted-foreground", className),
  });

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
