"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  APPEARANCE_RANGES,
} from "@/lib/appearance-settings";
import type {
  AppearanceColorTokens,
  AppearanceLayoutTokens,
  AppearanceMotionTokens,
  AppearanceSettings,
  AppearanceShadowTokens,
  AppearanceTypographyTokens,
} from "@/lib/appearance-settings";
import { ArrowLeft, Download, RotateCcw, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useRef } from "react";
import { COLOR_FIELDS, DENSITY_OPTIONS } from "./settings-metadata";
import type { ColorField } from "./settings-metadata";
import {
  ColorControl,
  SegmentedControl,
  SettingsSection,
  SliderControl,
} from "./settings-controls";
import { AppearancePreview } from "./settings-preview";

const percent = (value: number): string => `${Math.round(value * 100)}%`;
const MOTION_OPTIONS = [
  { label: "Full", value: "on" },
  { label: "Off", value: "off" },
] as const;

interface ColorsSettingsProps {
  readonly onChange: (token: keyof AppearanceColorTokens, value: string) => void;
  readonly settings: Readonly<AppearanceSettings>;
}

const ColorFieldControl = ({
  field,
  onChange,
  settings,
}: Readonly<{
  readonly field: ColorField;
  readonly onChange: (token: keyof AppearanceColorTokens, value: string) => void;
  readonly settings: Readonly<AppearanceSettings>;
}>) => (
  <ColorControl
    label={field.label}
    token={field.token}
    value={settings.colors[field.token]}
    onChange={onChange}
  />
);

const ColorsSettings = ({ onChange, settings }: ColorsSettingsProps) => (
  <SettingsSection
    title="Colors"
    description="Semantic palette tokens used across cards, text, and chrome."
  >
    <div className="space-y-3">
      {COLOR_FIELDS.map((field) => (
        <ColorFieldControl
          key={`color-${field.token}`}
          field={field}
          onChange={onChange}
          settings={settings}
        />
      ))}
    </div>
  </SettingsSection>
);

interface TypographySettingsProps {
  readonly onChange: (patch: Readonly<Partial<AppearanceTypographyTokens>>) => void;
  readonly settings: Readonly<AppearanceSettings>;
}

interface TypographySliderProps {
  readonly onBodyWeightChange: (value: number) => void;
  readonly onHeadingWeightChange: (value: number) => void;
  readonly onTextScaleChange: (value: number) => void;
  readonly settings: Readonly<AppearanceSettings>;
}

const TypographySliders = ({
  onBodyWeightChange,
  onHeadingWeightChange,
  onTextScaleChange,
  settings,
}: TypographySliderProps) => (
  <>
    <SliderControl
      label="Text scale"
      value={settings.typography.textScale}
      min={APPEARANCE_RANGES.textScale.min}
      max={APPEARANCE_RANGES.textScale.max}
      step={APPEARANCE_RANGES.textScale.step}
      display={percent(settings.typography.textScale)}
      onChange={onTextScaleChange}
    />
    <SliderControl
      label="Body weight"
      value={settings.typography.bodyWeight}
      min={APPEARANCE_RANGES.bodyWeight.min}
      max={APPEARANCE_RANGES.bodyWeight.max}
      step={APPEARANCE_RANGES.bodyWeight.step}
      display={String(settings.typography.bodyWeight)}
      onChange={onBodyWeightChange}
    />
    <SliderControl
      label="Heading weight"
      value={settings.typography.headingWeight}
      min={APPEARANCE_RANGES.headingWeight.min}
      max={APPEARANCE_RANGES.headingWeight.max}
      step={APPEARANCE_RANGES.headingWeight.step}
      display={String(settings.typography.headingWeight)}
      onChange={onHeadingWeightChange}
    />
  </>
);

const TypographySettings = ({ onChange, settings }: TypographySettingsProps) => {
  const changeBodyWeight = useCallback(
      (bodyWeight: number) => {
        onChange({ bodyWeight });
      },
      [onChange],
    ),
    changeHeadingWeight = useCallback(
      (headingWeight: number) => {
        onChange({ headingWeight });
      },
      [onChange],
    ),
    changeTextScale = useCallback(
      (textScale: number) => {
        onChange({ textScale });
      },
      [onChange],
    );
  return (
    <SettingsSection
      title="Typography"
      description="Scale and weight for body copy and headings."
    >
      <TypographySliders
        settings={settings}
        onTextScaleChange={changeTextScale}
        onBodyWeightChange={changeBodyWeight}
        onHeadingWeightChange={changeHeadingWeight}
      />
    </SettingsSection>
  );
};

interface LayoutSettingsProps {
  readonly onChange: (patch: Readonly<Partial<AppearanceLayoutTokens>>) => void;
  readonly settings: Readonly<AppearanceSettings>;
}

const getDensityValue = (scale: number): string => {
  const option = DENSITY_OPTIONS.find((candidate) => candidate.scale === scale);
  if (option !== undefined) {
    return option.value;
  }
  return "Custom";
};

interface LayoutControlProps {
  readonly onCornerRadiusChange: (value: number) => void;
  readonly onDensityChange: (value: string) => void;
  readonly onSpaceScaleChange: (value: number) => void;
  readonly settings: Readonly<AppearanceSettings>;
}

const LayoutControls = ({
  onCornerRadiusChange,
  onDensityChange,
  onSpaceScaleChange,
  settings,
}: LayoutControlProps) => (
  <>
    <SegmentedControl
      label="Density"
      value={getDensityValue(settings.layout.spaceScale)}
      options={DENSITY_OPTIONS}
      onChange={onDensityChange}
    />
    <SliderControl
      label="Spacing scale"
      value={settings.layout.spaceScale}
      min={APPEARANCE_RANGES.spaceScale.min}
      max={APPEARANCE_RANGES.spaceScale.max}
      step={APPEARANCE_RANGES.spaceScale.step}
      display={percent(settings.layout.spaceScale)}
      onChange={onSpaceScaleChange}
    />
    <SliderControl
      label="Corner radius"
      value={settings.layout.cornerRadius}
      min={APPEARANCE_RANGES.cornerRadius.min}
      max={APPEARANCE_RANGES.cornerRadius.max}
      step={APPEARANCE_RANGES.cornerRadius.step}
      display={`${Math.round(settings.layout.cornerRadius)}px`}
      onChange={onCornerRadiusChange}
    />
  </>
);

const LayoutSettings = ({ onChange, settings }: LayoutSettingsProps) => {
  const changeCornerRadius = useCallback(
      (cornerRadius: number) => {
        onChange({ cornerRadius });
      },
      [onChange],
    ),
    changeDensity = useCallback(
      (value: string) => {
        const option = DENSITY_OPTIONS.find((candidate) => candidate.value === value);
        if (option !== undefined) {
          onChange({ spaceScale: option.scale });
        }
      },
      [onChange],
    ),
    changeSpaceScale = useCallback(
      (spaceScale: number) => {
        onChange({ spaceScale });
      },
      [onChange],
    );
  return (
    <SettingsSection
      title="Spacing and density"
      description="Density presets move the spacing scale; fine-tune it with the slider."
    >
      <LayoutControls
        settings={settings}
        onDensityChange={changeDensity}
        onSpaceScaleChange={changeSpaceScale}
        onCornerRadiusChange={changeCornerRadius}
      />
    </SettingsSection>
  );
};

interface ShadowSettingsProps {
  readonly onChange: (patch: Readonly<Partial<AppearanceShadowTokens>>) => void;
  readonly settings: Readonly<AppearanceSettings>;
}

const ShadowSettings = ({ onChange, settings }: ShadowSettingsProps) => {
  const changeStrength = useCallback(
    (strength: number) => {
      onChange({ strength });
    },
    [onChange],
  );
  return (
    <SettingsSection
      title="Shadows"
      description="Depth of standard drop shadows on cards, panels, and buttons."
    >
      <SliderControl
        label="Shadow strength"
        value={settings.shadows.strength}
        min={APPEARANCE_RANGES.shadowStrength.min}
        max={APPEARANCE_RANGES.shadowStrength.max}
        step={APPEARANCE_RANGES.shadowStrength.step}
        display={percent(settings.shadows.strength)}
        onChange={changeStrength}
      />
    </SettingsSection>
  );
};

interface MotionSettingsProps {
  readonly onChange: (patch: Readonly<Partial<AppearanceMotionTokens>>) => void;
  readonly settings: Readonly<AppearanceSettings>;
}

const getMotionValue = (enabled: boolean): string => {
  if (enabled) {
    return "on";
  }
  return "off";
};

const MotionSettings = ({ onChange, settings }: MotionSettingsProps) => {
  const changeEnabled = useCallback(
      (value: string) => {
        onChange({ enabled: value === "on" });
      },
      [onChange],
    ),
    changeSpeed = useCallback(
      (speed: number) => {
        onChange({ speed });
      },
      [onChange],
    );
  return (
    <SettingsSection
      title="Motion"
      description="Transition speed for interface feedback."
    >
      <SegmentedControl
        label="Animations"
        value={getMotionValue(settings.motion.enabled)}
        options={MOTION_OPTIONS}
        onChange={changeEnabled}
      />
      <SliderControl
        label="Motion speed"
        value={settings.motion.speed}
        min={APPEARANCE_RANGES.motionSpeed.min}
        max={APPEARANCE_RANGES.motionSpeed.max}
        step={APPEARANCE_RANGES.motionSpeed.step}
        display={percent(settings.motion.speed)}
        disabled={!settings.motion.enabled}
        onChange={changeSpeed}
      />
    </SettingsSection>
  );
};

interface AppearanceActionsProps {
  readonly onExport: () => void;
  readonly onImportFile: (file: Readonly<File>) => Promise<void>;
  readonly onReset: () => void;
}

interface FileInputChangeEvent {
  readonly currentTarget: Readonly<{ readonly files: Readonly<FileList> | null }>;
}

const AppearanceActions = ({
  onExport,
  onImportFile,
  onReset,
}: AppearanceActionsProps) => {
  const importFormRef = useRef<HTMLFormElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const openImport = useCallback(() => {
    importInputRef.current?.click();
  }, []);
  const handleFileChange = useCallback(
    (event: FileInputChangeEvent) => {
      const file = event.currentTarget.files?.[0];
      importFormRef.current?.reset();
      if (file !== undefined) {
        void onImportFile(file);
      }
    },
    [onImportFile],
  );
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-md border border-border/70 bg-card/60 p-5">
      <Button type="button" variant="outline" onClick={onReset}>
        <RotateCcw className="h-4 w-4" />
        Reset to defaults
      </Button>
      <Button type="button" variant="outline" onClick={onExport}>
        <Download className="h-4 w-4" />
        Export JSON
      </Button>
      <Button type="button" variant="outline" onClick={openImport}>
        <Upload className="h-4 w-4" />
        Import JSON
      </Button>
      <form ref={importFormRef}>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFileChange}
        />
      </form>
      <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-widest">
        Stored locally
      </Badge>
    </section>
  );
};

const AppearanceSettingsHeader = () => (
  <header className="mb-8">
    <Link
      href="/"
      className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Back to workspace
    </Link>
    <h1 className="mt-4 font-serif text-3xl font-semibold tracking-tight text-foreground">
      Appearance
    </h1>
    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
      Tune the workspace design tokens. Changes apply immediately across the app and are saved in
      this browser. Colors you change override both themes; untouched tokens keep following the
      light and dark themes.
    </p>
  </header>
);

interface AppearanceSettingsActions {
  readonly handleExport: () => void;
  readonly handleImportFile: (file: Readonly<File>) => Promise<void>;
  readonly handleReset: () => void;
  readonly updateColorField: (token: keyof AppearanceColorTokens, value: string) => void;
  readonly updateLayout: (patch: Readonly<Partial<AppearanceLayoutTokens>>) => void;
  readonly updateMotion: (patch: Readonly<Partial<AppearanceMotionTokens>>) => void;
  readonly updateShadows: (patch: Readonly<Partial<AppearanceShadowTokens>>) => void;
  readonly updateTypography: (patch: Readonly<Partial<AppearanceTypographyTokens>>) => void;
}

const AppearanceSettingsColumn = ({
  actions,
  settings,
}: Readonly<{
  readonly actions: Readonly<AppearanceSettingsActions>;
  readonly settings: Readonly<AppearanceSettings>;
}>) => {
  const onColorChange = actions.updateColorField;
  const onLayoutChange = actions.updateLayout;
  const onMotionChange = actions.updateMotion;
  const onShadowsChange = actions.updateShadows;
  const onTypographyChange = actions.updateTypography;
  return (
    <div className="min-w-0 flex-1 space-y-6">
      <ColorsSettings settings={settings} onChange={onColorChange} />
      <TypographySettings settings={settings} onChange={onTypographyChange} />
      <LayoutSettings settings={settings} onChange={onLayoutChange} />
      <ShadowSettings settings={settings} onChange={onShadowsChange} />
      <MotionSettings settings={settings} onChange={onMotionChange} />
      <AppearanceActions
        onExport={actions.handleExport}
        onImportFile={actions.handleImportFile}
        onReset={actions.handleReset}
      />
    </div>
  );
};

const AppearanceSettingsLayout = ({
  actions,
  settings,
}: Readonly<{
  readonly actions: Readonly<AppearanceSettingsActions>;
  readonly settings: Readonly<AppearanceSettings>;
}>) => (
  <div className="flex flex-col items-start gap-6 lg:flex-row">
    <AppearanceSettingsColumn actions={actions} settings={settings} />
    <AppearancePreview settings={settings} />
  </div>
);

const AppearanceSettingsContent = ({
  actions,
  settings,
}: Readonly<{
  readonly actions: Readonly<AppearanceSettingsActions>;
  readonly settings: Readonly<AppearanceSettings>;
}>) => (
  <div className="mx-auto w-full max-w-6xl px-6 py-8">
    <AppearanceSettingsHeader />
    <AppearanceSettingsLayout actions={actions} settings={settings} />
  </div>
);

export { AppearanceSettingsContent };
