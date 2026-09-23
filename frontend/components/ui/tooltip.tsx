"use client";

import React from "react";
import {
  Root as TooltipRoot,
  Content as TooltipContentPrimitive,
  Provider as TooltipProviderPrimitive,
  Trigger as TooltipTriggerPrimitive,
} from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

type TooltipContentProps = Pick<
  React.ComponentPropsWithoutRef<typeof TooltipContentPrimitive>,
  "children" | "className" | "side" | "sideOffset"
>;

const Tooltip = TooltipRoot,
  TooltipContent = React.forwardRef<
    React.ComponentRef<typeof TooltipContentPrimitive>,
    TooltipContentProps
  >(({ children, className, side, sideOffset = 4 }, ref) => (
    <TooltipContentPrimitive
      ref={ref}
      side={side}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-md border border-white/10 bg-[var(--news-bg-secondary)] px-3 py-1.5 text-xs text-foreground shadow-md",
        className,
      )}
    >
      {children}
    </TooltipContentPrimitive>
  )),
  TooltipProvider = TooltipProviderPrimitive,
  TooltipTrigger = TooltipTriggerPrimitive;
TooltipContent.displayName = TooltipContentPrimitive.displayName;

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
