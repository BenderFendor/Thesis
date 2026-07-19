"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Loader2, CheckCircle, AlertCircle, Rss } from "lucide-react";
import { promoteRssSource, validateRssUrl, type AddRssResponse } from "@/lib/api";

interface AddRssDialogProps {
  onSourceAdded?: () => void;
}

export function AddRssDialog({ onSourceAdded }: AddRssDialogProps) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [validating, setValidating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [validationResult, setValidationResult] = useState<AddRssResponse | null>(null);
  const [reviewName, setReviewName] = useState("");
  const [reviewCountry, setReviewCountry] = useState("");
  const [reviewSourceType, setReviewSourceType] = useState("");
  const [reviewPaywalled, setReviewPaywalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleValidate = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    setValidating(true);
    setError(null);
    setValidationResult(null);

    try {
      const result = await validateRssUrl(trimmed);
      setValidationResult(result);
      setReviewName(result.name);
      setReviewCountry(result.inferred?.country || "");
      setReviewSourceType(result.inferred?.source_type || "");
      setReviewPaywalled(result.inferred?.is_paywalled || false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setValidating(false);
    }
  };

  const handleAdd = async () => {
    if (!validationResult) return;

    setAdding(true);
    try {
      await promoteRssSource({
        url: url.trim(),
        name: reviewName.trim() || validationResult.name,
        country: reviewCountry.trim(),
        source_type: reviewSourceType.trim(),
        is_paywalled: reviewPaywalled,
      });
      setOpen(false);
      setUrl("");
      setValidationResult(null);
      setError(null);
      onSourceAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add source");
    } finally {
      setAdding(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setUrl("");
      setValidationResult(null);
      setReviewName("");
      setReviewCountry("");
      setReviewSourceType("");
      setReviewPaywalled(false);
      setError(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-[10px] font-mono uppercase tracking-[0.2em] border-white/10 rounded-none gap-1.5"
        >
          <Rss className="h-3.5 w-3.5" />
          Add RSS
        </Button>
      </DialogTrigger>
      <DialogContent className="border border-white/10 bg-[var(--news-bg-secondary)] text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-mono uppercase tracking-[0.2em]">
            Add RSS Source
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Paste an RSS feed URL to validate and add it to the source catalog.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Input
              placeholder="https://example.com/rss"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setValidationResult(null);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleValidate();
              }}
              className="h-9 rounded-none border-white/10 bg-[var(--news-bg-primary)] text-foreground font-mono text-xs"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-none border border-red-500/20 bg-red-500/5 p-3 text-xs">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" />
              <span className="text-red-300">{error}</span>
            </div>
          )}

          {validationResult && (
            <div className="rounded-none border border-green-500/20 bg-green-500/5 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-3.5 w-3.5 text-green-400" />
                <span className="text-xs font-medium text-green-300">Feed valid</span>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <div>
                  <span className="text-muted-foreground">Name: </span>
                  <span className="text-foreground">{validationResult.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Articles: </span>
                  <span className="text-foreground">{validationResult.article_count}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status: </span>
                  <span className="text-foreground">{validationResult.status}</span>
                </div>
                {validationResult.duplicate_candidates && validationResult.duplicate_candidates.length > 0 && (
                  <div className="text-amber-300">
                    Possible duplicate: {validationResult.duplicate_candidates[0]?.name}
                  </div>
                )}
              </div>
            </div>
          )}

          {validationResult && (
            <div className="space-y-2 rounded-none border border-white/10 bg-[var(--news-bg-primary)]/50 p-3">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                Review before promotion
              </div>
              <Input
                placeholder="Source name"
                value={reviewName}
                onChange={(event) => setReviewName(event.target.value)}
                className="h-9 rounded-none border-white/10 bg-[var(--news-bg-primary)] text-foreground font-mono text-xs"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Country code"
                  value={reviewCountry}
                  onChange={(event) => setReviewCountry(event.target.value)}
                  className="h-9 rounded-none border-white/10 bg-[var(--news-bg-primary)] text-foreground font-mono text-xs"
                />
                <Input
                  placeholder="Source type"
                  value={reviewSourceType}
                  onChange={(event) => setReviewSourceType(event.target.value)}
                  className="h-9 rounded-none border-white/10 bg-[var(--news-bg-primary)] text-foreground font-mono text-xs"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={reviewPaywalled}
                  onChange={(event) => setReviewPaywalled(event.target.checked)}
                />
                Paywalled source
              </label>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleValidate}
              disabled={!url.trim() || validating}
              className="flex-1 h-9 rounded-none border-white/10 text-xs font-mono uppercase tracking-[0.15em]"
            >
              {validating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Validate"
              )}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleAdd}
              disabled={!validationResult || adding}
              className="flex-1 h-9 rounded-none text-xs font-mono uppercase tracking-[0.15em] gap-1.5"
            >
              {adding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
