"use client";

import { useCallback } from "react";

const createPopoverStyle = (leftOffset: number, topOffset: number) =>
  ({ left: leftOffset, position: "absolute" as const, top: topOffset });

export interface InlineDefinitionPopoverProps {
  readonly result: Readonly<{
    readonly term: string;
    readonly definition?: string | null;
    readonly error?: string | null;
  }> | null;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly anchorPosition: Readonly<Record<"x" | "y", number>> | null;
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

  const leftOffset = anchorPosition?.x ?? 0,
    topOffset = anchorPosition?.y ?? 0;

  return (
    <button
      type="button"
      style={createPopoverStyle(leftOffset, topOffset)}
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
