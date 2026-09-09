"use client";

import { useCallback } from "react";

const createPopoverStyle = (x: number, y: number) =>
  ({ left: x, position: "absolute" as const, top: y });

export interface InlineDefinitionPopoverProps {
  readonly result: Readonly<{
    readonly term: string;
    readonly definition?: string | null;
    readonly error?: string | null;
  }> | null;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly anchorPosition: Readonly<{ readonly x: number; readonly y: number }> | null;
}

export const InlineDefinitionPopover = ({
  result,
  open,
  setOpen,
  anchorPosition,
}: Readonly<InlineDefinitionPopoverProps>) => {
  const closePopover = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  if (!open || !result) {
    return null;
  }

  const x = anchorPosition?.x ?? 0,
    y = anchorPosition?.y ?? 0;

  return (
    <button
      type="button"
      style={createPopoverStyle(x, y)}
      className="z-50 max-w-xs rounded-md border bg-white p-3 text-left text-sm shadow-lg"
      onClick={closePopover}
    >
      <div className="font-semibold">{result.term}</div>
      <div className="mt-1 text-gray-700">
        {result.definition ?? result.error ?? "No definition available."}
      </div>
    </button>
  );
};

// Single component kept
