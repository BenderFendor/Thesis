"use client";

import React from "react";
import {
  Root as ScrollAreaRoot,
  Viewport as ScrollAreaViewport,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  Corner as ScrollAreaCorner,
} from "@radix-ui/react-scroll-area";

import { cn } from "@/lib/utils";

type ScrollAreaProps = Pick<
  React.ComponentPropsWithoutRef<typeof ScrollAreaRoot>,
  "children" | "className"
>;
type ScrollBarProps = Pick<
  React.ComponentPropsWithoutRef<typeof ScrollAreaScrollbar>,
  "className" | "orientation"
>;

const ScrollArea = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaRoot>,
  ScrollAreaProps
>(({ className, children }, ref) => (
  <ScrollAreaRoot
    ref={ref}
    className={cn("relative overflow-hidden", className)}
  >
    <ScrollAreaViewport className="h-full w-full rounded-[inherit]">
      {children}
    </ScrollAreaViewport>
    <ScrollBar />
    <ScrollAreaCorner />
  </ScrollAreaRoot>
));
ScrollArea.displayName = ScrollAreaRoot.displayName;

const ScrollBar = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaScrollbar>,
  ScrollBarProps
>(({ className, orientation = "vertical" }, ref) => (
  <ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      orientation === "vertical" && "h-full w-2.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" && "h-2.5 flex-col border-t border-t-transparent p-[1px]",
      className,
    )}
  >
    <ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaScrollbar.displayName;

export { ScrollArea };
