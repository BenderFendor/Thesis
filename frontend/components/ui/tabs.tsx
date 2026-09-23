"use client";

import React from "react";
import {
  Root as TabsRoot,
  List as TabsListPrimitive,
  Trigger as TabsTriggerPrimitive,
  Content as TabsContentPrimitive,
} from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

type TabsProps = Pick<
  React.ComponentProps<typeof TabsRoot>,
  "children" | "className" | "onValueChange" | "value"
>;

type TabsListProps = Pick<React.ComponentProps<typeof TabsListPrimitive>, "children" | "className">;

type TabsTriggerProps = Pick<
  React.ComponentProps<typeof TabsTriggerPrimitive>,
  "children" | "className" | "disabled" | "onClick" | "value"
>;

type TabsContentProps = Pick<
  React.ComponentProps<typeof TabsContentPrimitive>,
  "children" | "className" | "value"
>;

const Tabs: React.FC<TabsProps> = ({ children, className, onValueChange, value }) => (
  <TabsRoot
    data-slot="tabs"
    className={cn("flex flex-col gap-2", className)}
    onValueChange={onValueChange}
    value={value}
  >
    {children}
  </TabsRoot>
);

const TabsList: React.FC<TabsListProps> = ({ children, className }) => (
  <TabsListPrimitive
    data-slot="tabs-list"
    className={cn(
      "bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]",
      className,
    )}
  >
    {children}
  </TabsListPrimitive>
);

const TabsTrigger: React.FC<TabsTriggerProps> = ({
  children,
  className,
  disabled,
  onClick,
  value,
}) => (
  <TabsTriggerPrimitive
    data-slot="tabs-trigger"
    className={cn(
      "data-[state=active]:bg-background dark:data-[state=active]:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 text-foreground dark:text-muted-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      className,
    )}
    disabled={disabled}
    onClick={onClick}
    value={value}
  >
    {children}
  </TabsTriggerPrimitive>
);

const TabsContent: React.FC<TabsContentProps> = ({
  children,
  className,
  value,
}) => (
  <TabsContentPrimitive
    data-slot="tabs-content"
    className={cn("flex-1 outline-none", className)}
    value={value}
  >
    {children}
  </TabsContentPrimitive>
);

export { Tabs, TabsList, TabsTrigger, TabsContent };
