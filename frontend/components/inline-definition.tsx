"use client";

import React from "react";

export interface InlineDefinitionPopoverProps {
  result: {
    term: string;
    definition?: string | null;
    error?: string | null;
  } | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  anchorPosition: { x: number; y: number } | null;
}

export function InlineDefinitionPopover({
  result,
  open,
  setOpen,
  anchorPosition,
}: InlineDefinitionPopoverProps) {
  if (!open || !result) return null;

  const x = anchorPosition?.x ?? 0;
  const y = anchorPosition?.y ?? 0;

  return (
    <div
      style={{ position: "absolute", left: x, top: y }}
      className="z-50 max-w-xs rounded-md border bg-white p-3 shadow-lg text-sm"
      onClick={() => setOpen(false)}
    >
      <div className="font-semibold">{result.term}</div>
      <div className="mt-1 text-gray-700">
        {result.definition ?? result.error ?? "No definition available."}
      </div>
    </div>
  );
}

export default InlineDefinitionPopover;
// single component kept
