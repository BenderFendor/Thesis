"use client"

import { useCallback, useId, useRef, useSyncExternalStore } from "react"
import Link from "next/link"
import { ArrowLeft, Download, RotateCcw, Upload } from "lucide-react"
import { toast } from "sonner"

import { GlobalNavigation } from "@/components/global-navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  APPEARANCE_RANGES,
  getServerAppearanceSettings,
  loadAppearanceSettings,
  normalizeAppearanceSettings,
  resetAppearanceSettings,
  saveAppearanceSettings,
  subscribeToAppearanceSettings,
  type AppearanceColorTokens,
  type AppearanceLayoutTokens,
  type AppearanceMotionTokens,
  type AppearanceSettings,
  type AppearanceShadowTokens,
  type AppearanceTypographyTokens,
} from "@/lib/appearance-settings"

const COLOR_FIELDS: Array<{ token: keyof AppearanceColorTokens; label: string }> = [
  { token: "background", label: "Background" },
  { token: "surface", label: "Surface" },
  { token: "foreground", label: "Text" },
  { token: "secondaryText", label: "Secondary text" },
  { token: "accent", label: "Accent" },
  { token: "border", label: "Border" },
]

const DENSITY_OPTIONS = [
  { label: "Compact", scale: 0.9 },
  { label: "Default", scale: 1 },
  { label: "Roomy", scale: 1.1 },
] as const

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

interface SettingsSectionProps {
  title: string
  description?: string
  children: React.ReactNode
}

function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section className="rounded-md border border-border/70 bg-card/60 p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  )
}

interface SliderControlProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  disabled?: boolean
  onChange: (value: number) => void
}

function SliderControl({ label, value, min, max, step, display, disabled, onChange }: SliderControlProps) {
  const id = useId()
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm text-foreground">
          {label}
        </label>
        <span className={`font-mono text-xs ${disabled ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
          {display}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  )
}

interface ColorControlProps {
  label: string
  token: keyof AppearanceColorTokens
  value: string
  onChange: (token: keyof AppearanceColorTokens, value: string) => void
}

function ColorControl({ label, token, value, onChange }: ColorControlProps) {
  const id = useId()
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
          onChange={(event) => onChange(token, event.target.value)}
          className="h-9 w-14 cursor-pointer rounded-sm border border-border bg-transparent p-1"
          aria-label={`${label} color`}
        />
      </div>
    </div>
  )
}

interface SegmentedControlProps {
  label: string
  options: Array<{ label: string; value: string }>
  value: string
  onChange: (value: string) => void
}

function SegmentedControl({ label, options, value, onChange }: SegmentedControlProps) {
  return (
    <div className="space-y-2">
      <span className="text-sm text-foreground">{label}</span>
      <div className="flex gap-2" role="group" aria-label={label}>
        {options.map((option) => (
          <Button
            key={`${label}-${option.value}`}
            type="button"
            size="sm"
            variant={option.value === value ? "default" : "outline"}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

export default function AppearanceSettingsPage() {
  const settings = useSyncExternalStore(
    subscribeToAppearanceSettings,
    loadAppearanceSettings,
    getServerAppearanceSettings,
  )
  const importInputRef = useRef<HTMLInputElement>(null)

  const save = useCallback(
    (next: AppearanceSettings) => {
      saveAppearanceSettings(normalizeAppearanceSettings(next))
    },
    [],
  )

  const updateColorField = useCallback(
    (token: keyof AppearanceColorTokens, value: string) => {
      save({ ...settings, colors: { ...settings.colors, [token]: value } })
    },
    [save, settings],
  )

  const updateTypography = useCallback(
    (patch: Partial<AppearanceTypographyTokens>) =>
      save({ ...settings, typography: { ...settings.typography, ...patch } }),
    [save, settings],
  )

  const updateLayout = useCallback(
    (patch: Partial<AppearanceLayoutTokens>) =>
      save({ ...settings, layout: { ...settings.layout, ...patch } }),
    [save, settings],
  )

  const updateShadows = useCallback(
    (patch: Partial<AppearanceShadowTokens>) =>
      save({ ...settings, shadows: { ...settings.shadows, ...patch } }),
    [save, settings],
  )

  const updateMotion = useCallback(
    (patch: Partial<AppearanceMotionTokens>) =>
      save({ ...settings, motion: { ...settings.motion, ...patch } }),
    [save, settings],
  )

  const handleReset = useCallback(() => {
    resetAppearanceSettings()
    toast.success("Appearance restored to defaults")
  }, [])

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "scoop-appearance-settings.json"
    anchor.click()
    URL.revokeObjectURL(url)
  }, [settings])

  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const parsed = normalizeAppearanceSettings(JSON.parse(await file.text()))
        if (parsed.version !== 1) {
          throw new Error("Unsupported settings version")
        }
        saveAppearanceSettings(parsed)
        toast.success("Appearance settings imported")
      } catch {
        toast.error("Could not import settings: expected an exported appearance JSON file")
      }
    },
    [],
  )

  const densityValue =
    DENSITY_OPTIONS.find((option) => option.scale === settings.layout.spaceScale)?.label ?? "Custom"

  return (
    <div className="flex min-h-screen overflow-hidden bg-background text-foreground">
      <GlobalNavigation />
      <main className="relative z-10 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
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
              Tune the workspace design tokens. Changes apply immediately across the app and are
              saved in this browser. Colors you change override both themes; untouched tokens keep
              following the light and dark themes.
            </p>
          </header>

          <div className="flex flex-col items-start gap-6 lg:flex-row">
            <div className="min-w-0 flex-1 space-y-6">
              <SettingsSection
                title="Colors"
                description="Semantic palette tokens used across cards, text, and chrome."
              >
                <div className="space-y-3">
                  {COLOR_FIELDS.map((field) => (
                    <ColorControl
                      key={`color-${field.token}`}
                      label={field.label}
                      token={field.token}
                      value={settings.colors[field.token]}
                      onChange={updateColorField}
                    />
                  ))}
                </div>
              </SettingsSection>

              <SettingsSection
                title="Typography"
                description="Scale and weight for body copy and headings."
              >
                <SliderControl
                  label="Text scale"
                  value={settings.typography.textScale}
                  min={APPEARANCE_RANGES.textScale.min}
                  max={APPEARANCE_RANGES.textScale.max}
                  step={APPEARANCE_RANGES.textScale.step}
                  display={percent(settings.typography.textScale)}
                  onChange={(textScale) => updateTypography({ textScale })}
                />
                <SliderControl
                  label="Body weight"
                  value={settings.typography.bodyWeight}
                  min={APPEARANCE_RANGES.bodyWeight.min}
                  max={APPEARANCE_RANGES.bodyWeight.max}
                  step={APPEARANCE_RANGES.bodyWeight.step}
                  display={String(settings.typography.bodyWeight)}
                  onChange={(bodyWeight) => updateTypography({ bodyWeight })}
                />
                <SliderControl
                  label="Heading weight"
                  value={settings.typography.headingWeight}
                  min={APPEARANCE_RANGES.headingWeight.min}
                  max={APPEARANCE_RANGES.headingWeight.max}
                  step={APPEARANCE_RANGES.headingWeight.step}
                  display={String(settings.typography.headingWeight)}
                  onChange={(headingWeight) => updateTypography({ headingWeight })}
                />
              </SettingsSection>

              <SettingsSection
                title="Spacing and density"
                description="Density presets move the spacing scale; fine-tune it with the slider."
              >
                <SegmentedControl
                  label="Density"
                  value={densityValue}
                  options={DENSITY_OPTIONS.map((option) => ({
                    label: option.label,
                    value: option.label,
                  }))}
                  onChange={(selected) => {
                    const option = DENSITY_OPTIONS.find((candidate) => candidate.label === selected)
                    if (option) {
                      updateLayout({ spaceScale: option.scale })
                    }
                  }}
                />
                <SliderControl
                  label="Spacing scale"
                  value={settings.layout.spaceScale}
                  min={APPEARANCE_RANGES.spaceScale.min}
                  max={APPEARANCE_RANGES.spaceScale.max}
                  step={APPEARANCE_RANGES.spaceScale.step}
                  display={percent(settings.layout.spaceScale)}
                  onChange={(spaceScale) => updateLayout({ spaceScale })}
                />
                <SliderControl
                  label="Corner radius"
                  value={settings.layout.cornerRadius}
                  min={APPEARANCE_RANGES.cornerRadius.min}
                  max={APPEARANCE_RANGES.cornerRadius.max}
                  step={APPEARANCE_RANGES.cornerRadius.step}
                  display={`${Math.round(settings.layout.cornerRadius)}px`}
                  onChange={(cornerRadius) => updateLayout({ cornerRadius })}
                />
              </SettingsSection>

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
                  onChange={(strength) => updateShadows({ strength })}
                />
              </SettingsSection>

              <SettingsSection title="Motion" description="Transition speed for interface feedback.">
                <SegmentedControl
                  label="Animations"
                  value={settings.motion.enabled ? "on" : "off"}
                  options={[
                    { label: "Full", value: "on" },
                    { label: "Off", value: "off" },
                  ]}
                  onChange={(selected) => updateMotion({ enabled: selected === "on" })}
                />
                <SliderControl
                  label="Motion speed"
                  value={settings.motion.speed}
                  min={APPEARANCE_RANGES.motionSpeed.min}
                  max={APPEARANCE_RANGES.motionSpeed.max}
                  step={APPEARANCE_RANGES.motionSpeed.step}
                  display={percent(settings.motion.speed)}
                  disabled={!settings.motion.enabled}
                  onChange={(speed) => updateMotion({ speed })}
                />
              </SettingsSection>

              <section className="flex flex-wrap items-center gap-3 rounded-md border border-border/70 bg-card/60 p-5">
                <Button type="button" variant="outline" onClick={handleReset}>
                  <RotateCcw className="h-4 w-4" />
                  Reset to defaults
                </Button>
                <Button type="button" variant="outline" onClick={handleExport}>
                  <Download className="h-4 w-4" />
                  Export JSON
                </Button>
                <Button type="button" variant="outline" onClick={() => importInputRef.current?.click()}>
                  <Upload className="h-4 w-4" />
                  Import JSON
                </Button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ""
                    if (file) {
                      void handleImportFile(file)
                    }
                  }}
                />
                <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-widest">
                  Stored locally
                </Badge>
              </section>
            </div>

            <aside className="w-full shrink-0 lg:w-80" aria-label="Live preview">
              <div className="space-y-4 lg:sticky lg:top-6">
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  Live preview
                </p>
                <div className="rounded-md border border-border bg-card shadow-md">
                  <div className="space-y-3 p-4">
                    <Badge className="font-mono text-[10px] uppercase tracking-widest">Breaking</Badge>
                    <h3 className="font-serif text-xl font-semibold leading-snug text-foreground">
                      Senate report questions coverage of funding vote
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Reporters followed the story across three outlets, comparing framing,
                      sourcing, and what each left out of the record.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button type="button" size="sm">
                        Read analysis
                      </Button>
                      <Button type="button" size="sm" variant="outline">
                        Save for later
                      </Button>
                    </div>
                  </div>
                  <div className="border-t border-border p-4">
                    <Input placeholder="Search sources" aria-label="Search sources preview" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 border-t border-border p-4">
                    {COLOR_FIELDS.map((field) => (
                      <div key={`swatch-${field.token}`} className="space-y-1">
                        <div
                          className="h-6 w-full rounded-sm border border-border"
                          style={{ backgroundColor: settings.colors[field.token] }}
                        />
                        <span className="block truncate font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                          {field.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  This preview and the surrounding workspace share the same tokens. Move a control
                  and watch both react without a reload.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  )
}
