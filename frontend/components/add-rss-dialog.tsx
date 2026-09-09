"use client";
import { hasText } from "@/lib/utils";

import { AlertCircle, CheckCircle, Loader2, Plus, Rss } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { promoteRssSource, validateRssUrl } from "@/lib/api";
import type { AddRssResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { useCallback, useState } from 'react';
import type { ChangeEventHandler, KeyboardEventHandler } from 'react';

interface AddRssDialogProps {
  readonly onSourceAdded?: () => void;
}

const RssValidationCard = ({
  result,
}: Readonly<{ result: DeepReadonly<AddRssResponse> }>) => (
  <div className="rounded-none border border-green-500/20 bg-green-500/5 p-3 space-y-2">
    <div className="flex items-center gap-2">
      <CheckCircle className="h-3.5 w-3.5 text-green-400" />
      <span className="text-xs font-medium text-green-300">Feed valid</span>
    </div>
    <div className="space-y-1 text-xs text-muted-foreground">
      <div>
        <span className="text-muted-foreground">Name: </span>
        <span className="text-foreground">{result.name}</span>
      </div>
      <div>
        <span className="text-muted-foreground">Articles: </span>
        <span className="text-foreground">{result.article_count}</span>
      </div>
      <div>
        <span className="text-muted-foreground">Status: </span>
        <span className="text-foreground">{result.status}</span>
      </div>
      {result.duplicate_candidates && result.duplicate_candidates.length > 0 && (
        <div className="text-amber-300">
          Possible duplicate: {result.duplicate_candidates[0]?.name}
        </div>
      )}
    </div>
  </div>
);

interface RssReviewFieldsProps {
  readonly name: string;
  readonly country: string;
  readonly sourceType: string;
  readonly paywalled: boolean;
  readonly onNameChange: (value: string) => void;
  readonly onCountryChange: (value: string) => void;
  readonly onSourceTypeChange: (value: string) => void;
  readonly onPaywalledChange: (value: boolean) => void;
}

const RssReviewFields = ({
  name,
  country,
  sourceType,
  paywalled,
  onNameChange,
  onCountryChange,
  onSourceTypeChange,
  onPaywalledChange,
}: Readonly<RssReviewFieldsProps>) => {
  const handleNameChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
      (event) =>{  onNameChange(event.target.value); },
      [onNameChange],
    );
  const handleCountryChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
      (event) =>{  onCountryChange(event.target.value); },
      [onCountryChange],
    );
  const handleSourceTypeChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
      (event) =>{  onSourceTypeChange(event.target.value); },
      [onSourceTypeChange],
    );
  const handlePaywalledChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
      (event) =>{  onPaywalledChange(event.target.checked); },
      [onPaywalledChange],
    );

  return (
    <div className="space-y-2 rounded-none border border-white/10 bg-[var(--news-bg-primary)]/50 p-3">
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
        Review before promotion
      </div>
      <Input
        placeholder="Source name"
        value={name}
        onChange={handleNameChange}
        className="h-9 rounded-none border-white/10 bg-[var(--news-bg-primary)] text-foreground font-mono text-xs"
      />
      <div className="grid grid-cols-2 gap-2">
        <Input
          placeholder="Country code"
          value={country}
          onChange={handleCountryChange}
          className="h-9 rounded-none border-white/10 bg-[var(--news-bg-primary)] text-foreground font-mono text-xs"
        />
        <Input
          placeholder="Source type"
          value={sourceType}
          onChange={handleSourceTypeChange}
          className="h-9 rounded-none border-white/10 bg-[var(--news-bg-primary)] text-foreground font-mono text-xs"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={paywalled} onChange={handlePaywalledChange} />
        Paywalled source
      </label>
    </div>
  );
};

interface RssActionButtonsProps {
  readonly validating: boolean;
  readonly adding: boolean;
  readonly canValidate: boolean;
  readonly canAdd: boolean;
  readonly onValidate: () => void;
  readonly onAdd: () => void;
}

const RssActionButtons = ({
  validating,
  adding,
  canValidate,
  canAdd,
  onValidate,
  onAdd,
}: Readonly<RssActionButtonsProps>) => (
  <div className="flex gap-2">
    <Button
      variant="outline"
      size="sm"
      onClick={onValidate}
      disabled={!canValidate || validating}
      className="flex-1 h-9 rounded-none border-white/10 text-xs font-mono uppercase tracking-[0.15em]"
    >
      {(() => {
  if (validating) {
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  }
  return "Validate";
})()}
    </Button>
    <Button
      variant="default"
      size="sm"
      onClick={onAdd}
      disabled={!canAdd || adding}
      className="flex-1 h-9 rounded-none text-xs font-mono uppercase tracking-[0.15em] gap-1.5"
    >
      {(() => {
  if (adding) {
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  }
  return <Plus className="h-3.5 w-3.5" />;
})()}
      Add
    </Button>
  </div>
);

export const AddRssDialog = ({ onSourceAdded }: AddRssDialogProps) => {
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
  const handleValidate = useCallback(async () => {
      const trimmed = url.trim();
      if (!trimmed) {
        return;
      }

      setValidating(true);
      setError(null);
      setValidationResult(null);

      try {
        const result = await validateRssUrl(trimmed);
        setValidationResult(result);
        setReviewName(result.name);
        setReviewCountry(result.inferred?.country ?? "");
        setReviewSourceType(result.inferred?.source_type ?? "");
        setReviewPaywalled(result.inferred?.is_paywalled ?? false);
      } catch (caughtError) {
        setError((() => {
  if (caughtError instanceof Error) {
    return caughtError.message;
  }
  return "Validation failed";
})());
      } finally {
        setValidating(false);
      }
    }, [
      setError,
      setReviewCountry,
      setReviewName,
      setReviewPaywalled,
      setReviewSourceType,
      setValidating,
      setValidationResult,
      url,
    ]);
  const handleAdd = useCallback(async () => {
      if (!validationResult) {
        return;
      }

      setAdding(true);
      try {
        await promoteRssSource({
          country: reviewCountry.trim(),
          is_paywalled: reviewPaywalled,
          name: reviewName.trim() || validationResult.name,
          source_type: reviewSourceType.trim(),
          url: url.trim(),
        });
        setOpen(false);
        setUrl("");
        setValidationResult(null);
        setError(null);
        onSourceAdded?.();
      } catch (caughtError) {
        setError((() => {
  if (caughtError instanceof Error) {
    return caughtError.message;
  }
  return "Failed to add source";
})());
      } finally {
        setAdding(false);
      }
    }, [
      onSourceAdded,
      reviewCountry,
      reviewName,
      reviewPaywalled,
      reviewSourceType,
      setAdding,
      setError,
      setOpen,
      setUrl,
      setValidationResult,
      url,
      validationResult,
    ]);
  const handleOpenChange = useCallback((next: boolean) => {
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
    }, [
      setError,
      setOpen,
      setReviewCountry,
      setReviewName,
      setReviewPaywalled,
      setReviewSourceType,
      setUrl,
      setValidationResult,
    ]);
  const handleUrlChange = useCallback<ChangeEventHandler<HTMLInputElement>>((event) => {
      setUrl(event.target.value);
      setValidationResult(null);
      setError(null);
    }, [setError, setUrl, setValidationResult]);
  const handleUrlKeyDown = useCallback<KeyboardEventHandler<HTMLInputElement>>(
      (event) => {
        if (event.key === "Enter") {
          void handleValidate();
        }
      },
      [handleValidate],
    );
  const handleValidateClick = useCallback(() => {
      void handleValidate();
    }, [handleValidate]);
  const handleAddClick = useCallback(() => {
      void handleAdd();
    }, [handleAdd]);

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
              onChange={handleUrlChange}
              onKeyDown={handleUrlKeyDown}
              className="h-9 rounded-none border-white/10 bg-[var(--news-bg-primary)] text-foreground font-mono text-xs"
            />
          </div>

          {hasText(error) && (
            <div className="flex items-start gap-2 rounded-none border border-red-500/20 bg-red-500/5 p-3 text-xs">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" />
              <span className="text-red-300">{error}</span>
            </div>
          )}

          {validationResult && <RssValidationCard result={validationResult} />}

          {validationResult && (
            <RssReviewFields
              name={reviewName}
              country={reviewCountry}
              sourceType={reviewSourceType}
              paywalled={reviewPaywalled}
              onNameChange={setReviewName}
              onCountryChange={setReviewCountry}
              onSourceTypeChange={setReviewSourceType}
              onPaywalledChange={setReviewPaywalled}
            />
          )}

          <RssActionButtons
            validating={validating}
            adding={adding}
            canValidate={Boolean(url.trim())}
            canAdd={Boolean(validationResult)}
            onValidate={handleValidateClick}
            onAdd={handleAddClick}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};
