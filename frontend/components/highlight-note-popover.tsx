"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Highlight } from '@/lib/api';
import { highlightStableId } from "@/lib/highlight-utils";
import Link from "next/link";
import { Search } from "lucide-react";

interface HighlightNotePopoverProps {
  open: boolean;
  highlight: Highlight | null;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onSave: (highlightId: string, note: string) => Promise<void>;
  articleTitle?: string;
  articleSource?: string;
}

export function HighlightNotePopover({
  open,
  highlight,
  anchorEl,
  onClose,
  onSave,
  articleTitle,
  articleSource,
}: HighlightNotePopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(undefined),
   textareaRef = useRef<HTMLTextAreaElement>(undefined),
   [position, setPosition] = useState<{ top: number; left: number }>({
    left: 0,
    top: 0,
  }),
   [noteDraft, setNoteDraft] = useState(""),
   [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {return;}
    if (!highlight) {return;}
    setNoteDraft(highlight.note ?? "");
  }, [open, highlight]);

  useEffect(() => {
    if (!open) {return;}

    const focusTimer = globalThis.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);

    return () =>{  globalThis.clearTimeout(focusTimer); };
  }, [open, highlight]);

  useEffect(() => {
    if (!open) {return;}
    if (!anchorEl) {return;}

    const updatePosition = () => {
      if (!anchorEl) {return;}
      const rect = anchorEl.getBoundingClientRect(),
       viewportMargin = 12,
       desiredLeft = rect.left + rect.width / 2,
       desiredTop = rect.bottom + 10,

       maxLeft = globalThis.innerWidth - viewportMargin,
       clampedLeft = Math.max(viewportMargin, Math.min(desiredLeft, maxLeft)),
       maxTop = globalThis.innerHeight - viewportMargin,
       clampedTop = Math.max(viewportMargin, Math.min(desiredTop, maxTop));

      setPosition({ left: clampedLeft, top: clampedTop });
    };

    updatePosition();
    globalThis.addEventListener("resize", updatePosition);
    globalThis.addEventListener("scroll", updatePosition, true);

    return () => {
      globalThis.removeEventListener("resize", updatePosition);
      globalThis.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, anchorEl]);

  useEffect(() => {
    if (!open) {return;}

    const handleClickOutside = (event: MouseEvent) => {
      if (!popoverRef.current) {return;}
      const target = event.target as Node;

      if (popoverRef.current.contains(target)) {return;}
      if (anchorEl?.contains(target)) {return;}

      onClose();
    },

     handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose, anchorEl]);

  if (!open || !highlight || !anchorEl) {return ;}

  const researchQuery = (() => {
    if (!highlight || !articleTitle) {return }

    const parts = [`Context: ${articleTitle}`]
    if (articleSource) {
      parts[0] += ` by ${articleSource}`
    }
    parts.push("", "Explain this highlighted passage:", "", `> ${highlight.highlighted_text}`)

    return encodeURIComponent(parts.join("\n"))
  })(),

   handleSave = async () => {
    try {
      setSaving(true);
      await onSave(highlightStableId(highlight), noteDraft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={popoverRef}
      className="fixed z-[110] w-[min(420px,calc(100vw-24px))]"
      style={{ left: position.left, top: position.top, transform: "translateX(-50%)" }}
      role="dialog"
      aria-label="Highlight note"
      onMouseDown={(event) =>{  event.stopPropagation(); }}
      onPointerDown={(event) =>{  event.stopPropagation(); }}
    >
      <div className="rounded-lg border border-border/60 bg-[var(--news-bg-secondary)]/95 backdrop-blur p-3 shadow-2xl">
        <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          Note
        </div>

        <div className="mt-2 text-xs text-foreground/80 line-clamp-3 whitespace-pre-wrap break-words">
          {highlight.highlighted_text}
        </div>

        <textarea
          ref={textareaRef}
          value={noteDraft}
          onChange={(e) =>{  setNoteDraft(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void handleSave()
            }
          }}
          className="mt-3 w-full min-h-[96px] rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          placeholder="Add a note"
        />

        <div className="mt-3 flex items-center justify-between gap-2">
          {researchQuery ? (
            <Link
              href={`/search?query=${researchQuery}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-primary/15 hover:border-primary/40 hover:text-primary"
            >
              <Search className="h-3 w-3" />
              Research this
            </Link>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
