"use client";

import { Button } from "@/components/ui/button";
import type {
  AppearanceColorTokens,
} from "@/lib/appearance-settings";
import type { ReactElement, ReactNode } from "react";
import { useCallback, useId } from "react";

interface SettingsSectionProps {
  readonly children: Readonly<ReactElement> | readonly Readonly<ReactElement>[];
  readonly description?: string;
  readonly title: string;
}

interface InputChangeEvent {
  readonly target: Readonly<{ readonly value: string }>;
}

const SettingsSection = ({ children, description, title }: Readonly<Pick<
  SettingsSectionProps,
  "children" | "description" | "title"
>>) => {
  let descriptionNode: ReactNode = null;
  if (description !== undefined) {
    descriptionNode = <p className="mt-1 text-sm text-muted-foreground">{description}</p>;
  }
  return (
    <section className="rounded-md border border-border/70 bg-card/60 p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {title}
        </h2>
        {descriptionNode}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
};

interface SliderControlProps {
  readonly disabled?: boolean;
  readonly display: string;
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly onChange: (value: number) => void;
  readonly step: number;
  readonly value: number;
}

const SliderControl = ({
  disabled,
  display,
  label,
  max,
  min,
  onChange,
  step,
  value,
}: SliderControlProps) => {
  const handleChange = useCallback(
      (event: InputChangeEvent) => {
        onChange(Number(event.target.value));
      },
      [onChange],
    ),
    id = useId();
  let displayClassName = "text-muted-foreground";
  if (disabled === true) {
    displayClassName = "text-muted-foreground/50";
  }
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm text-foreground">
          {label}
        </label>
        <span className={`font-mono text-xs ${displayClassName}`}>{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        className="w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
};

interface ColorControlProps {
  readonly label: string;
  readonly onChange: (token: keyof AppearanceColorTokens, value: string) => void;
  readonly token: keyof AppearanceColorTokens;
  readonly value: string;
}

const ColorControl = ({ label, onChange, token, value }: ColorControlProps) => {
  const handleChange = useCallback(
      (event: InputChangeEvent) => {
        onChange(token, event.target.value);
      },
      [onChange, token],
    ),
    id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm text-foreground">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs uppercase text-muted-foreground">{value}</span>
        <input
          id={id}
          type="color"
          value={value}
          onChange={handleChange}
          className="h-9 w-14 cursor-pointer rounded-sm border border-border bg-transparent p-1"
          aria-label={`${label} color`}
        />
      </div>
    </div>
  );
};

interface SegmentedOption {
  readonly label: string;
  readonly value: string;
}

interface SegmentedControlProps {
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly SegmentedOption[];
  readonly value: string;
}

const SegmentedOptionButton = ({
  onChange,
  option,
  selected,
}: Readonly<{
  readonly onChange: (value: string) => void;
  readonly option: SegmentedOption;
  readonly selected: boolean;
}>) => {
  const handleClick = useCallback(() => {
    onChange(option.value);
  }, [onChange, option.value]);
  let variant: "default" | "outline" = "outline";
  if (selected) {
    variant = "default";
  }
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      aria-pressed={selected}
      onClick={handleClick}
    >
      {option.label}
    </Button>
  );
};

const SegmentedControl = ({ label, onChange, options, value }: SegmentedControlProps) => (
  <fieldset className="space-y-2">
    <legend className="text-sm text-foreground">{label}</legend>
    <div className="flex gap-2">
      {options.map((option) => (
        <SegmentedOptionButton
          key={`${label}-${option.value}`}
          onChange={onChange}
          option={option}
          selected={option.value === value}
        />
      ))}
    </div>
  </fieldset>
);

export { ColorControl, SegmentedControl, SettingsSection, SliderControl };
