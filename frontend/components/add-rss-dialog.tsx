"use client";
import { hasText } from "@/lib/utils";

import { AlertCircle, CheckCircle, Loader2, Plus, Rss } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { AddRssResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { useAddRssDialogController } from "./add-rss-dialog-controller";
import type { RssDialogController } from "./add-rss-dialog-controller";
import { useCallback } from "react";
import type { ChangeEventHandler, KeyboardEventHandler } from "react";

interface AddRssDialogProps {
  readonly onSourceAdded?: () => void;
}

interface RssResultRowProps {
  readonly label: string;
  readonly value: number | string;
}

const RssResultRow = ({ label, value }: RssResultRowProps) => (
  <div>
    <span className="text-muted-foreground">{label}: </span>
    <span className="text-foreground">{value}</span>
  </div>
);

const RssValidationHeader = () => (
  <div className="flex items-center gap-2">
    <CheckCircle className="h-3.5 w-3.5 text-green-400" />
    <span className="text-xs font-medium text-green-300">Feed valid</span>
  </div>
);

const RssValidationDetails = ({ result }: Readonly<{ result: DeepReadonly<AddRssResponse> }>) => (
  <div className="space-y-1 text-xs text-muted-foreground">
    <RssResultRow label="Name" value={result.name} />
    <RssResultRow label="Articles" value={result.article_count} />
    <RssResultRow label="Status" value={result.status} />
    {result.duplicate_candidates && result.duplicate_candidates.length > 0 && (
      <div className="text-amber-300">
        Possible duplicate: {result.duplicate_candidates[0]?.name}
      </div>
    )}
  </div>
);

const RssValidationCard = ({ result }: Readonly<{ result: DeepReadonly<AddRssResponse> }>) => (
  <div className="space-y-2 rounded-none border border-green-500/20 bg-green-500/5 p-3">
    <RssValidationHeader />
    <RssValidationDetails result={result} />
  </div>
);

interface RssReviewInputProps {
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly value: string;
}

const RssReviewInput = ({ onChange, placeholder, value }: Readonly<RssReviewInputProps>) => {
  const handleChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
    (event) => {
      onChange(event.target.value);
    },
    [onChange],
  );
  return (
    <Input
      placeholder={placeholder}
      value={value}
      onChange={handleChange}
      className="h-9 rounded-none border-white/10 bg-[var(--news-bg-primary)] text-foreground font-mono text-xs"
    />
  );
};

const RssPaywallInput = ({
  onChange,
  value,
}: Readonly<{ onChange: (value: boolean) => void; value: boolean }>) => {
  const handleChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
    (event) => {
      onChange(event.target.checked);
    },
    [onChange],
  );
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <input type="checkbox" checked={value} onChange={handleChange} />
      Paywalled source
    </label>
  );
};

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
}: Readonly<RssReviewFieldsProps>) => (
  <div className="space-y-2 rounded-none border border-white/10 bg-[var(--news-bg-primary)]/50 p-3">
    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      Review before promotion
    </div>
    <RssReviewInput placeholder="Source name" value={name} onChange={onNameChange} />
    <div className="grid grid-cols-2 gap-2">
      <RssReviewInput placeholder="Country code" value={country} onChange={onCountryChange} />
      <RssReviewInput placeholder="Source type" value={sourceType} onChange={onSourceTypeChange} />
    </div>
    <RssPaywallInput value={paywalled} onChange={onPaywalledChange} />
  </div>
);

interface RssActionButtonsProps {
  readonly validating: boolean;
  readonly adding: boolean;
  readonly canValidate: boolean;
  readonly canAdd: boolean;
  readonly onValidate: () => void;
  readonly onAdd: () => void;
}

const RssValidateButtonContent = ({ validating }: Readonly<{ validating: boolean }>) => {
  if (validating) {
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  }
  return "Validate";
};

const RssValidateButton = ({
  canValidate,
  onValidate,
  validating,
}: Readonly<Pick<RssActionButtonsProps, "canValidate" | "onValidate" | "validating">>) => (
  <Button
    variant="outline"
    size="sm"
    onClick={onValidate}
    disabled={!canValidate || validating}
    className="flex-1 h-9 rounded-none border-white/10 text-xs font-mono uppercase tracking-[0.15em]"
  >
    <RssValidateButtonContent validating={validating} />
  </Button>
);

const RssAddButtonContent = ({ adding }: Readonly<{ adding: boolean }>) => {
  if (adding) {
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  }
  return <Plus className="h-3.5 w-3.5" />;
};

const RssAddButton = ({
  adding,
  canAdd,
  onAdd,
}: Readonly<Pick<RssActionButtonsProps, "adding" | "canAdd" | "onAdd">>) => (
  <Button
    variant="default"
    size="sm"
    onClick={onAdd}
    disabled={!canAdd || adding}
    className="flex-1 h-9 rounded-none text-xs font-mono uppercase tracking-[0.15em] gap-1.5"
  >
    <RssAddButtonContent adding={adding} />
    Add
  </Button>
);

const RssActionButtons = (props: RssActionButtonsProps) => (
  <div className="flex gap-2">
    <RssValidateButton
      canValidate={props.canValidate}
      onValidate={props.onValidate}
      validating={props.validating}
    />
    <RssAddButton adding={props.adding} canAdd={props.canAdd} onAdd={props.onAdd} />
  </div>
);

const RssDialogTrigger = () => (
  <Button
    variant="outline"
    size="sm"
    className="h-8 gap-1.5 rounded-none border-white/10 text-[10px] font-mono uppercase tracking-[0.2em]"
  >
    <Rss className="h-3.5 w-3.5" />
    Add RSS
  </Button>
);

const RssUrlField = ({
  onChange,
  onKeyDown,
  url,
}: Readonly<{
  onChange: ChangeEventHandler<HTMLInputElement>;
  onKeyDown: KeyboardEventHandler<HTMLInputElement>;
  url: string;
}>) => (
  <div className="space-y-2">
    <Input
      placeholder="https://example.com/rss"
      value={url}
      onChange={onChange}
      onKeyDown={onKeyDown}
      className="h-9 rounded-none border-white/10 bg-[var(--news-bg-primary)] text-foreground font-mono text-xs"
    />
  </div>
);

const RssErrorMessage = ({ error }: Readonly<{ error: string | null }>) => {
  if (!hasText(error)) {
    return null;
  }
  return (
    <div className="flex items-start gap-2 rounded-none border border-red-500/20 bg-red-500/5 p-3 text-xs">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" />
      <span className="text-red-300">{error}</span>
    </div>
  );
};

const RssDialogForm = ({
  controller,
}: Readonly<{ controller: DeepReadonly<RssDialogController> }>) => (
  <div className="space-y-4">
    <RssUrlField
      url={controller.url}
      onChange={controller.handleUrlChange}
      onKeyDown={controller.handleUrlKeyDown}
    />
    <RssErrorMessage error={controller.error} />
    {controller.validationResult && <RssValidationCard result={controller.validationResult} />}
    {controller.validationResult && (
      <RssReviewFields
        name={controller.reviewName}
        country={controller.reviewCountry}
        sourceType={controller.reviewSourceType}
        paywalled={controller.reviewPaywalled}
        onNameChange={controller.handleReviewNameChange}
        onCountryChange={controller.handleReviewCountryChange}
        onSourceTypeChange={controller.handleReviewSourceTypeChange}
        onPaywalledChange={controller.handleReviewPaywalledChange}
      />
    )}
    <RssActionButtons
      validating={controller.validating}
      adding={controller.adding}
      canValidate={Boolean(controller.url.trim())}
      canAdd={Boolean(controller.validationResult)}
      onValidate={controller.handleValidateClick}
      onAdd={controller.handleAddClick}
    />
  </div>
);

const RssDialogContent = ({
  controller,
}: Readonly<{ controller: DeepReadonly<RssDialogController> }>) => (
  <DialogContent className="border border-white/10 bg-[var(--news-bg-secondary)] text-foreground sm:max-w-md">
    <DialogTitle className="text-sm font-mono uppercase tracking-[0.2em]">
      Add RSS Source
    </DialogTitle>
    <DialogDescription className="text-xs text-muted-foreground">
      Paste an RSS feed URL to validate and add it to the source catalog.
    </DialogDescription>
    <RssDialogForm controller={controller} />
  </DialogContent>
);

export const AddRssDialog = ({ onSourceAdded }: AddRssDialogProps) => {
  const controller = useAddRssDialogController(onSourceAdded);
  return (
    <Dialog open={controller.open} onOpenChange={controller.handleOpenChange}>
      <DialogTrigger asChild>
        <RssDialogTrigger />
      </DialogTrigger>
      <RssDialogContent controller={controller} />
    </Dialog>
  );
};
