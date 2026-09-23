"use client";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";

const DEBUG_TAB_LABELS = [
  ["system", "System"],
  ["sources", "Sources"],
  ["storage", "Storage"],
  ["parser", "Parser Tester"],
  ["controls", "Controls"],
  ["llm", "LLM Calls"],
  ["errors", "Errors"],
  ["performance", "Performance"],
] as const;

export const DebugTabNavigation = (): React.ReactElement => (
  <TabsList className="grid w-full grid-cols-4 lg:grid-cols-8">
    {DEBUG_TAB_LABELS.map(([value, label]) => (
      <TabsTrigger key={value} value={value}>
        {label}
      </TabsTrigger>
    ))}
  </TabsList>
);
