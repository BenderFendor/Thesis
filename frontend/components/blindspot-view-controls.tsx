import type { ChangeEventHandler, ReactElement } from "react";
import { useCallback } from "react";
import type {
  BlindspotControlsProps,
  ReadonlyBlindspotLens,
  SortMode,
} from "@/components/blindspot-view-types";
import { SORT_OPTIONS } from "@/components/blindspot-view-helpers";
import type { DeepReadonly } from "@/lib/deep-readonly";

const BlindspotHeading = (): ReactElement => (
  <div className="space-y-1.5 lg:space-y-2">
    <h2 className="font-serif text-2xl font-medium tracking-tight text-foreground/90 lg:text-4xl">
      Media Blindspots
    </h2>
    <p className="max-w-xl text-sm italic leading-snug text-muted-foreground/50 lg:leading-relaxed">
      Detecting asymmetric reporting where one perspective is missing.
    </p>
  </div>
);

const BlindspotSelect = (
  props: DeepReadonly<{
    children: readonly Readonly<ReactElement>[];
    onChange: ChangeEventHandler<HTMLSelectElement>;
    value: string;
  }>,
): ReactElement => (
  <select
    value={props.value}
    onChange={props.onChange}
    className="min-w-0 flex-1 cursor-pointer border-none bg-transparent px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-foreground/80 focus:ring-0"
  >
    {props.children}
  </select>
);

const LensSelector = (
  props: DeepReadonly<{
    availableLenses: readonly ReadonlyBlindspotLens[];
    onChange: ChangeEventHandler<HTMLSelectElement>;
    value: ReadonlyBlindspotLens["id"];
  }>,
): ReactElement => (
  <BlindspotSelect value={props.value} onChange={props.onChange}>
    {props.availableLenses.map((lens) => (
      <option key={lens.id} value={lens.id} disabled={!lens.available} className="bg-[var(--card)]">
        {lens.label}
      </option>
    ))}
  </BlindspotSelect>
);

const SortSelector = (
  props: DeepReadonly<{
    onChange: ChangeEventHandler<HTMLSelectElement>;
    value: SortMode;
  }>,
): ReactElement => (
  <BlindspotSelect value={props.value} onChange={props.onChange}>
    {SORT_OPTIONS.map((option) => (
      <option key={option.value} value={option.value} className="bg-[var(--card)]">
        {option.label}
      </option>
    ))}
  </BlindspotSelect>
);

const SelectLabel = (props: DeepReadonly<{ children: string }>): ReactElement => (
  <span className="sr-only px-1.5 text-[8px] font-mono uppercase tracking-widest text-muted-foreground/40 lg:not-sr-only lg:px-2">
    {props.children}
  </span>
);

const SelectField = (
  props: DeepReadonly<{ children: Readonly<ReactElement>; label: string }>,
): ReactElement => (
  <div className="flex min-w-0 items-center gap-1.5 rounded-sm border border-white/5 bg-white/[0.03] p-1">
    <SelectLabel>{props.label}</SelectLabel>
    {props.children}
  </div>
);

const BlindspotSelectGroup = (props: Readonly<BlindspotControlsProps>): ReactElement => {
  const { availableLenses, onLensChange, onSortChange, selectedLens, sortMode } = props;
  const handleLensChange: ChangeEventHandler<HTMLSelectElement> = useCallback(
    (event) => {
      const lens = availableLenses.find((option) => option.id === event.currentTarget.value);
      if (lens !== undefined) {
        onLensChange(lens.id);
      }
    },
    [availableLenses, onLensChange],
  );
  const handleSortChange: ChangeEventHandler<HTMLSelectElement> = useCallback(
    (event) => {
      const option = SORT_OPTIONS.find((item) => item.value === event.currentTarget.value);
      if (option !== undefined) {
        onSortChange(option.value);
      }
    },
    [onSortChange],
  );
  return (
    <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:items-center lg:gap-4">
      <SelectField label="Perspective">
        <LensSelector
          availableLenses={availableLenses}
          onChange={handleLensChange}
          value={selectedLens}
        />
      </SelectField>
      <SelectField label="Rank By">
        <SortSelector onChange={handleSortChange} value={sortMode} />
      </SelectField>
    </div>
  );
};

const BlindspotControls = (props: Readonly<BlindspotControlsProps>): ReactElement => (
  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
    <BlindspotHeading />
    <BlindspotSelectGroup
      availableLenses={props.availableLenses}
      onLensChange={props.onLensChange}
      onSortChange={props.onSortChange}
      selectedLens={props.selectedLens}
      sortMode={props.sortMode}
    />
  </div>
);

export { BlindspotControls };
