"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { type Highlight } from "@/lib/api";

interface HighlightNotePopoverProps {
  open: boolean;
  highlight: Highlight | null;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onSave: (highlightId: number, note: string) => Promise<void>;
}

export function HighlightNotePopover({
  open,
  highlight,
  anchorEl,
  onClose,
  onSave,
}: HighlightNotePopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const [noteDraft, setNoteDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!highlight) return;
    setNoteDraft(highlight.note || "");
  }, [open, highlight?.id]);

  useEffect(() => {
    if (!open) return;
    if (!anchorEl) return;

    const updatePosition = () => {
      if (!anchorEl) return;
      const rect = anchorEl.getBoundingClientRect();
      const viewportMargin = 12;
      const desiredLeft = rect.left + rect.width / 2;
      const desiredTop = rect.bottom + 10;

      const maxLeft = window.innerWidth - viewportMargin;
      const clampedLeft = Math.max(viewportMargin, Math.min(desiredLeft, maxLeft));
      const maxTop = window.innerHeight - viewportMargin;
      const clampedTop = Math.max(viewportMargin, Math.min(desiredTop, maxTop));

      setPosition({ top: clampedTop, left: clampedLeft });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, anchorEl]);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!popoverRef.current) return;
      const target = event.target as Node;

      if (popoverRef.current.contains(target)) return;
      if (anchorEl?.contains(target)) return;

      onClose();
    };

    const handleEscape = (event: KeyboardEvent) => {
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

  if (!mounted) return null;
  if (!open || !highlight || !anchorEl) return null;

  const handleSave = async () => {
    if (!highlight.id) return;
    try {
      setSaving(true);
      await onSave(highlight.id, noteDraft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const popover = (
    <div
      ref={popoverRef}
      className="fixed z-[110] w-[min(420px,calc(100vw-24px))]"
      style={{ top: position.top, left: position.left, transform: "translateX(-50%)" }}
      role="dialog"
      aria-label="Highlight note"
    >
      <div className="rounded-lg border border-border/60 bg-[var(--news-bg-secondary)]/95 backdrop-blur p-3 shadow-2xl">
        <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          Note
        </div>

        <div className="mt-2 text-xs text-foreground/80 line-clamp-3 whitespace-pre-wrap break-words">
          {highlight.highlighted_text}
        </div>

        <textarea
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          className="mt-3 w-full min-h-[96px] rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          placeholder="Add a note"
        />

        <div className="mt-3 flex items-center justify-end gap-2">
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
  );

  return createPortal(popover, document.body);
}
