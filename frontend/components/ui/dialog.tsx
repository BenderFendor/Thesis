"use client";

import {
  Root as DialogRoot,
  Trigger as DialogTriggerPrimitive,
  Portal as DialogPortalPrimitive,
  Overlay as DialogOverlayPrimitive,
  Content as DialogContentPrimitive,
  Close as DialogClosePrimitive,
  Title as DialogTitlePrimitive,
  Description as DialogDescriptionPrimitive,
} from "@radix-ui/react-dialog";
import React from "react";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog: React.FC<React.ComponentProps<typeof DialogRoot>> = (props) => {
  const dialogProps = { "data-slot": "dialog", ...props };
  return React.createElement(DialogRoot, dialogProps);
};

const DialogTrigger: React.FC<React.ComponentProps<typeof DialogTriggerPrimitive>> = (props) => {
  const triggerProps = { "data-slot": "dialog-trigger", ...props };
  return React.createElement(DialogTriggerPrimitive, triggerProps);
};

const DialogPortal: React.FC<React.ComponentProps<typeof DialogPortalPrimitive>> = (props) => {
  const portalProps = { "data-slot": "dialog-portal", ...props };
  return React.createElement(DialogPortalPrimitive, portalProps);
};

const DialogClose: React.FC<React.ComponentProps<typeof DialogClosePrimitive>> = (props) => {
  const closeProps = { "data-slot": "dialog-close", ...props };
  return React.createElement(DialogClosePrimitive, closeProps);
};

const DialogOverlay: React.FC<React.ComponentProps<typeof DialogOverlayPrimitive>> = ({
  className,
  ...props
}) =>
  {
    const overlayProps = {
      className: cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className,
      ),
      "data-slot": "dialog-overlay",
      ...props,
    };
    return React.createElement(DialogOverlayPrimitive, overlayProps);
  };

const DialogContent: React.FC<
  React.ComponentProps<typeof DialogContentPrimitive> & { showCloseButton?: boolean }
> = ({ className, children, showCloseButton = true, ...props }) => {
  const content = (
    <>
      {children}
      {showCloseButton && (
        <DialogClose
          data-slot="dialog-close"
          className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogClose>
      )}
    </>
  );
  const contentProps = {
    className: cn(
      "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
      className,
    ),
    "data-slot": "dialog-content",
    ...props,
  };
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      {React.createElement(DialogContentPrimitive, contentProps, content)}
    </DialogPortal>
  );
};

const DialogHeader: React.FC<React.ComponentProps<"div">> = ({ className, ...props }) =>
  {
    const headerProps = {
      className: cn("flex flex-col gap-2 text-center sm:text-left", className),
      "data-slot": "dialog-header",
      ...props,
    };
    return React.createElement("div", headerProps);
  };

const DialogTitle: React.FC<React.ComponentProps<typeof DialogTitlePrimitive>> = ({
  className,
  ...props
}) =>
  {
    const titleProps = {
      className: cn("text-lg leading-none font-semibold", className),
      "data-slot": "dialog-title",
      ...props,
    };
    return React.createElement(DialogTitlePrimitive, titleProps);
  };

const DialogDescription: React.FC<React.ComponentProps<typeof DialogDescriptionPrimitive>> = ({
  className,
  ...props
}) =>
  {
    const descriptionProps = {
      className: cn("text-muted-foreground text-sm", className),
      "data-slot": "dialog-description",
      ...props,
    };
    return React.createElement(DialogDescriptionPrimitive, descriptionProps);
  };

export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};
