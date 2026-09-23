import { Cpu } from "lucide-react";
import { useCallback } from "react";
import type { ChangeEventHandler, ReactElement } from "react";
import type { ResearchModelCatalog } from "../model/types";

interface ResearchModelSelectorProps {
  readonly catalog: ResearchModelCatalog;
  readonly hasError: boolean;
  readonly isLoading: boolean;
  readonly onChange: (modelId: string) => void;
  readonly selectedModelId?: string;
}

const getSelectorLabel = (
  catalog: ResearchModelCatalog,
  isLoading: boolean,
  hasError: boolean,
): string => {
  if (isLoading) {
    return "Loading models";
  }
  if (hasError || catalog.models.length === 0) {
    return "Models unavailable";
  }
  return "Model";
};

const ResearchModelSelector = ({
  catalog,
  hasError,
  isLoading,
  onChange,
  selectedModelId,
}: Readonly<ResearchModelSelectorProps>) => {
  const selectedModel = catalog.models.find((model) => model.id === selectedModelId);
  const selectorLabel = getSelectorLabel(catalog, isLoading, hasError);
  const isDisabled = isLoading || hasError || catalog.models.length === 0;
  const modelOptions = catalog.models.map((model) => (
    <option key={model.id} value={model.id}>
      {model.label} · {model.model}
    </option>
  ));
  let emptyOption: ReactElement | null = null;
  if (catalog.models.length === 0) {
    emptyOption = <option value="">{selectorLabel}</option>;
  }
  const handleChange = useCallback<ChangeEventHandler<HTMLSelectElement>>(
    (event) => {
      onChange(event.target.value);
    },
    [onChange],
  );
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60 md:inline">
        {selectorLabel}
      </span>
      <select
        aria-label="Research model"
        className="h-8 max-w-[13rem] rounded-full border border-border/30 bg-background/60 px-3 text-xs text-foreground/90 outline-none transition-colors hover:border-border/60 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isDisabled}
        onChange={handleChange}
        title={selectedModel?.model ?? selectorLabel}
        value={selectedModelId ?? ""}
      >
        {emptyOption}
        {modelOptions}
      </select>
    </div>
  );
};

export { ResearchModelSelector };
