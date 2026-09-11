"use client";

import React from "react";
import {
  Root as SheetRoot,
  Trigger as SheetTriggerPrimitive,
  Close as SheetClosePrimitive,
  Portal as SheetPortalPrimitive,
  Overlay as SheetOverlayPrimitive,
  Content as SheetContentPrimitive,
  Title as SheetTitlePrimitive,
  Description as SheetDescriptionPrimitive,
} from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";

type SheetRootProps = Pick<
  React.ComponentProps<typeof SheetRoot>,
  "defaultOpen" | "modal" | "onOpenChange" | "open"
> & {
  readonly children?: React.ReactNode;
};

type SheetTriggerProps = Pick<React.ComponentProps<typeof SheetTriggerPrimitive>, "asChild"> & {
  readonly children?: React.ReactNode;
};

type SheetCloseProps = Pick<React.ComponentProps<typeof SheetClosePrimitive>, "asChild"> & {
  readonly children?: React.ReactNode;
};

interface SheetClassNameProps {
  readonly children?: React.ReactNode;
  readonly className?: string;
}

const Sheet: React.FC<SheetRootProps> = ({ children, defaultOpen, modal, onOpenChange, open }) => (
  <SheetRoot
    data-slot="sheet"
    defaultOpen={defaultOpen}
    modal={modal}
    onOpenChange={onOpenChange}
    open={open}
  >
    {children}
  </SheetRoot>
);

const SheetTrigger: React.FC<SheetTriggerProps> = ({ asChild, children }) => (
  <SheetTriggerPrimitive data-slot="sheet-trigger" asChild={asChild}>
    {children}
  </SheetTriggerPrimitive>
);

const SheetClose: React.FC<SheetCloseProps> = ({ asChild, children }) => (
  <SheetClosePrimitive data-slot="sheet-close" asChild={asChild}>
    {children}
  </SheetClosePrimitive>
);

const SheetPortal: React.FC<{ readonly children?: React.ReactNode }> = ({ children }) => (
  <SheetPortalPrimitive data-slot="sheet-portal">{children}</SheetPortalPrimitive>
);

const SheetOverlay: React.FC = () => (
  <SheetOverlayPrimitive
    data-slot="sheet-overlay"
    className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50"
  />
);

const SheetContent: React.FC<SheetClassNameProps> = ({ children, className }) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetContentPrimitive
      data-slot="sheet-content"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right fixed inset-y-0 right-0 z-50 flex flex-col bg-background sm:max-w-md border-l shadow-lg",
        className,
      )}
    >
      {children}
    </SheetContentPrimitive>
  </SheetPortal>
);

const SheetHeader: React.FC<SheetClassNameProps> = ({ children, className }) => (
  <div
    data-slot="sheet-header"
    className={cn("flex flex-col space-y-2 text-center sm:text-left", className)}
  >
    {children}
  </div>
);

const SheetTitle: React.FC<SheetClassNameProps> = ({ children, className }) => (
  <SheetTitlePrimitive
    data-slot="sheet-title"
    className={cn("text-lg font-semibold text-foreground", className)}
  >
    {children}
  </SheetTitlePrimitive>
);

const SheetDescription: React.FC<SheetClassNameProps> = ({ children, className }) => (
  <SheetDescriptionPrimitive
    data-slot="sheet-description"
    className={cn("text-sm text-muted-foreground", className)}
  >
    {children}
  </SheetDescriptionPrimitive>
);

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
};
