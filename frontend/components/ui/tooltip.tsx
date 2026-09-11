"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

type TooltipContentProps = Pick<
 React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>,
 "children" | "className" | "side" | "sideOffset"
>

const Tooltip = TooltipPrimitive.Root,

 TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(({ children, className, side, sideOffset = 4 }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    side={side}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md border border-white/10 bg-[var(--news-bg-secondary)] px-3 py-1.5 text-xs text-foreground shadow-md",
      className
    )}
  >
    {children}
  </TooltipPrimitive.Content>
)),

 TooltipProvider = TooltipPrimitive.Provider,

 TooltipTrigger = TooltipPrimitive.Trigger
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
