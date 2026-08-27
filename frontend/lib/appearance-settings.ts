/**
 * Appearance settings model: one validated settings object that drives the
 * runtime CSS-variable token layer (see app/globals.css "runtime appearance"
 * blocks). Controls edit semantic tokens; components keep their classes.
 *
 * Persistence: localStorage under STORAGE_KEYS.APPEARANCE_SETTINGS.
 * Application: documentElement inline style properties, diffed against
 * APPEARANCE_DEFAULTS so untouched tokens keep following the active theme.
 */

import {
  STORAGE_KEYS,
  removeFromStorage,
  saveToStorage,
  subscribeToStorageKey,
} from "@/lib/storage";

export const APPEARANCE_STORAGE_KEY = STORAGE_KEYS.APPEARANCE_SETTINGS;

export interface AppearanceColorTokens {
  background: string;
  surface: string;
  foreground: string;
  secondaryText: string;
  accent: string;
  border: string;
}

export interface AppearanceTypographyTokens {
  /** Multiplier applied to every named Tailwind text size. */
  textScale: number;
  bodyWeight: number;
  headingWeight: number;
}

export interface AppearanceLayoutTokens {
  /** Multiplier applied to the Tailwind spacing unit. */
  spaceScale: number;
  /** Corner radius in pixels; drives --radius. */
  cornerRadius: number;
}

export interface AppearanceShadowTokens {
  /** Multiplier on the alpha of standard Tailwind box shadows. */
  strength: number;
}

export interface AppearanceMotionTokens {
  enabled: boolean;
  /** Multiplier on the default transition duration. */
  speed: number;
}

export interface AppearanceSettings {
  version: 1;
  colors: AppearanceColorTokens;
  typography: AppearanceTypographyTokens;
  layout: AppearanceLayoutTokens;
  shadows: AppearanceShadowTokens;
  motion: AppearanceMotionTokens;
}

/** Numeric slider bounds shared by the model and the settings page controls. */
export const APPEARANCE_RANGES = {
  textScale: { min: 0.85, max: 1.3, step: 0.05 },
  bodyWeight: { min: 300, max: 700, step: 50 },
  headingWeight: { min: 400, max: 800, step: 50 },
  spaceScale: { min: 0.85, max: 1.25, step: 0.05 },
  cornerRadius: { min: 0, max: 18, step: 1 },
  shadowStrength: { min: 0, max: 2, step: 0.05 },
  motionSpeed: { min: 0.5, max: 2, step: 0.05 },
} as const;

/**
 * Dark-first palette anchors taken from the .dark block in globals.css.
 * A field equal to its default means "no override": the theme keeps control.
 */
export const APPEARANCE_DEFAULTS: AppearanceSettings = Object.freeze({
  version: 1,
  colors: Object.freeze({
    background: "#000000",
    surface: "#0a0a0a",
    foreground: "#ece3d5",
    secondaryText: "#9d917f",
    accent: "#d0af73",
    border: "#222222",
  }),
  typography: Object.freeze({
    textScale: 1,
    bodyWeight: 400,
    headingWeight: 600,
  }),
  layout: Object.freeze({
    spaceScale: 1,
    cornerRadius: 6,
  }),
  shadows: Object.freeze({
    strength: 1,
  }),
  motion: Object.freeze({
    enabled: true,
    speed: 1,
  }),
}) as AppearanceSettings;

/** Root CSS properties overridden per color token; --ring follows --accent. */
const COLOR_PROPERTY_BY_TOKEN: Record<keyof AppearanceColorTokens, string | string[]> = {
  background: "--background",
  surface: "--card",
  foreground: "--foreground",
  secondaryText: "--muted-foreground",
  accent: ["--primary", "--ring"],
  border: "--border",
};

/** Neutral values that mean "no override" for the numeric root properties. */
const NEUTRAL_NUMBER_BY_PROPERTY: Record<string, number> = {
  "--appearance-text-scale": 1,
  "--appearance-font-weight-body": APPEARANCE_DEFAULTS.typography.bodyWeight,
  "--appearance-font-weight-heading": APPEARANCE_DEFAULTS.typography.headingWeight,
  "--appearance-space-scale": 1,
  // Stored in pixels; applied as rem against a 16px root font size.
  "--radius": APPEARANCE_DEFAULTS.layout.cornerRadius,
  "--appearance-shadow-strength": 1,
  "--appearance-motion-speed": 1,
};

export function getServerAppearanceSettings(): AppearanceSettings {
  // Stable frozen reference required by useSyncExternalStore server snapshots.
  return APPEARANCE_DEFAULTS;
}

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(range.max, Math.max(range.min, value));
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !HEX_COLOR_PATTERN.test(value)) {
    return fallback;
  }
  const hex = value.toLowerCase();
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

/**
 * Validate arbitrary input into a total AppearanceSettings object. Unknown
 * keys are dropped, invalid fields fall back to their default, numbers are
 * clamped into range. Never throws.
 */
export function normalizeAppearanceSettings(input: unknown): AppearanceSettings {
  const source = isPlainObject(input) ? (input as Record<string, unknown>) : {};
  if (source.version !== 1) {
    return { ...APPEARANCE_DEFAULTS };
  }

  const colors = group(source.colors);
  const typography = group(source.typography);
  const layout = group(source.layout);
  const shadows = group(source.shadows);
  const motion = group(source.motion);

  return {
    version: 1,
    colors: {
      background: normalizeHexColor(colors.background, APPEARANCE_DEFAULTS.colors.background),
      surface: normalizeHexColor(colors.surface, APPEARANCE_DEFAULTS.colors.surface),
      foreground: normalizeHexColor(colors.foreground, APPEARANCE_DEFAULTS.colors.foreground),
      secondaryText: normalizeHexColor(
        colors.secondaryText,
        APPEARANCE_DEFAULTS.colors.secondaryText,
      ),
      accent: normalizeHexColor(colors.accent, APPEARANCE_DEFAULTS.colors.accent),
      border: normalizeHexColor(colors.border, APPEARANCE_DEFAULTS.colors.border),
    },
    typography: {
      textScale: snapStep(clampNumber(typography.textScale, APPEARANCE_RANGES.textScale, 1)),
      bodyWeight: clampNumber(
        typography.bodyWeight,
        APPEARANCE_RANGES.bodyWeight,
        APPEARANCE_DEFAULTS.typography.bodyWeight,
      ),
      headingWeight: clampNumber(
        typography.headingWeight,
        APPEARANCE_RANGES.headingWeight,
        APPEARANCE_DEFAULTS.typography.headingWeight,
      ),
    },
    layout: {
      spaceScale: snapStep(clampNumber(layout.spaceScale, APPEARANCE_RANGES.spaceScale, 1)),
      cornerRadius: clampNumber(
        layout.cornerRadius,
        APPEARANCE_RANGES.cornerRadius,
        APPEARANCE_DEFAULTS.layout.cornerRadius,
      ),
    },
    shadows: {
      strength: snapStep(clampNumber(shadows.strength, APPEARANCE_RANGES.shadowStrength, 1)),
    },
    motion: {
      enabled: motion.enabled === undefined ? true : motion.enabled === true,
      speed: snapStep(clampNumber(motion.speed, APPEARANCE_RANGES.motionSpeed, 1)),
    },
  };
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function group(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Slider steps are multiples of 0.05; snap accumulated float drift back onto
 * the grid so stored values compare equal to their neutral defaults.
 */
function snapStep(value: number): number {
  return Math.round(value * 100) / 100;
}

function readRawStorageValue(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

let snapshotCache: { raw: string | null; value: AppearanceSettings } | null = null;

/**
 * useSyncExternalStore-compatible snapshot: parses and validates at most once
 * per stored value, so React sees a stable reference between renders.
 */
export function loadAppearanceSettings(): AppearanceSettings {
  const raw = readRawStorageValue();
  if (snapshotCache && snapshotCache.raw === raw) {
    return snapshotCache.value;
  }

  let parsed: unknown = null;
  if (raw !== null) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const value = normalizeAppearanceSettings(parsed);
  snapshotCache = { raw, value };
  return value;
}

export function subscribeToAppearanceSettings(onChange: () => void): () => void {
  // Reuses the shared storage bus: same-tab custom events plus cross-tab
  // native storage events.
  return subscribeToStorageKey(APPEARANCE_STORAGE_KEY, onChange);
}

export function saveAppearanceSettings(settings: AppearanceSettings): boolean {
  return saveToStorage(APPEARANCE_STORAGE_KEY, settings);
}

/** Remove persisted overrides; the next snapshot falls back to defaults. */
export function resetAppearanceSettings(): boolean {
  return removeFromStorage(APPEARANCE_STORAGE_KEY);
}

interface AppliedProperty {
  property: string;
  rendered: string;
  neutral: boolean;
}

function colorProperties(colors: AppearanceColorsInput): AppliedProperty[] {
  const entries: AppliedProperty[] = [];
  for (const token of Object.keys(COLOR_PROPERTY_BY_TOKEN) as Array<keyof AppearanceColorTokens>) {
    const propertyOrProperties = COLOR_PROPERTY_BY_TOKEN[token];
    const value = colors[token];
    const properties = Array.isArray(propertyOrProperties)
      ? propertyOrProperties
      : [propertyOrProperties];
    for (const property of properties) {
      entries.push({
        property,
        rendered: value,
        neutral: value === APPEARANCE_DEFAULTS.colors[token],
      });
    }
  }
  return entries;
}

type AppearanceColorsInput = AppearanceSettings["colors"];

function numericProperties(settings: AppearanceSettings): AppliedProperty[] {
  const radiusRem = `${snapStep(settings.layout.cornerRadius / 16)}rem`;
  return [
    {
      property: "--appearance-text-scale",
      rendered: String(settings.typography.textScale),
      neutral: settings.typography.textScale === 1,
    },
    {
      property: "--appearance-font-weight-body",
      rendered: String(settings.typography.bodyWeight),
      neutral:
        settings.typography.bodyWeight === NEUTRAL_NUMBER_BY_PROPERTY["--appearance-font-weight-body"],
    },
    {
      property: "--appearance-font-weight-heading",
      rendered: String(settings.typography.headingWeight),
      neutral:
        settings.typography.headingWeight ===
        NEUTRAL_NUMBER_BY_PROPERTY["--appearance-font-weight-heading"],
    },
    {
      property: "--appearance-space-scale",
      rendered: String(settings.layout.spaceScale),
      neutral: settings.layout.spaceScale === 1,
    },
    {
      property: "--radius",
      rendered: radiusRem,
      neutral: settings.layout.cornerRadius === NEUTRAL_NUMBER_BY_PROPERTY["--radius"],
    },
    {
      property: "--appearance-shadow-strength",
      rendered: String(settings.shadows.strength),
      neutral: settings.shadows.strength === 1,
    },
    {
      property: "--appearance-motion-speed",
      rendered: String(settings.motion.speed),
      neutral: settings.motion.speed === 1,
    },
  ];
}

/**
 * Apply settings as root-level CSS custom properties. Fields equal to their
 * default are removed instead of written, so untouched tokens keep following
 * the light/dark theme classes.
 */
export function applyAppearanceSettings(settings: AppearanceSettings): void {
  if (typeof document === "undefined") {
    return;
  }
  const style = document.documentElement.style;

  for (const entry of [...colorProperties(settings.colors), ...numericProperties(settings)]) {
    if (entry.neutral) {
      style.removeProperty(entry.property);
    } else {
      style.setProperty(entry.property, entry.rendered);
    }
  }

  if (settings.motion.enabled) {
    delete document.documentElement.dataset.motionOff;
  } else {
    document.documentElement.dataset.motionOff = "true";
  }
}

/**
 * Blocking head snippet that mirrors applyAppearanceSettings before hydration
 * so a reload does not flash unstyled tokens. Keep the validation identical
 * to normalizeAppearanceSettings.
 */
export function buildAppearanceBootstrapScript(): string {
  const d = JSON.stringify({
    colors: APPEARANCE_DEFAULTS.colors,
    typography: APPEARANCE_DEFAULTS.typography,
    cornerRadius: APPEARANCE_DEFAULTS.layout.cornerRadius,
    motionSpeedRange: APPEARANCE_RANGES.motionSpeed,
  });
  const ranges = JSON.stringify(APPEARANCE_RANGES);

  return `(function(){try{
var d=${d};var R=${ranges};
var raw=window.localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)});
if(!raw){return;}
var s=JSON.parse(raw);
if(!s||s.version!==1){return;}
function hx(v,f){return (typeof v==="string"&&/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v))?v.toLowerCase():f;}
function num(v,min,max,f){if(typeof v!=="number"||!isFinite(v)){return f;}return Math.min(max,Math.max(min,v));}
function put(name,value,neutral){style.removeProperty(name);if(!neutral){style.setProperty(name,value);}}
function col(name,v,f){var x=hx(v,f);put(name,x,x===f);}
var style=document.documentElement.style;
var g=s.colors||{},t=s.typography||{},l=s.layout||{},sh=s.shadows||{},m=s.motion||{};
col("--background",g.background,d.colors.background);
col("--card",g.surface,d.colors.surface);
col("--foreground",g.foreground,d.colors.foreground);
col("--muted-foreground",g.secondaryText,d.colors.secondaryText);
col("--primary",g.accent,d.colors.accent);
col("--ring",g.accent,d.colors.accent);
col("--border",g.border,d.colors.border);
var ts=num(t.textScale,R.textScale.min,R.textScale.max,1);put("--appearance-text-scale",String(ts),ts===1);
var bw=num(t.bodyWeight,R.bodyWeight.min,R.bodyWeight.max,d.typography.bodyWeight);put("--appearance-font-weight-body",String(bw),bw===d.typography.bodyWeight);
var hw=num(t.headingWeight,R.headingWeight.min,R.headingWeight.max,d.typography.headingWeight);put("--appearance-font-weight-heading",String(hw),hw===d.typography.headingWeight);
var ss=num(l.spaceScale,R.spaceScale.min,R.spaceScale.max,1);put("--appearance-space-scale",String(ss),ss===1);
var cr=num(l.cornerRadius,R.cornerRadius.min,R.cornerRadius.max,d.cornerRadius);put("--radius",(Math.round(cr/16*100)/100)+"rem",cr===d.cornerRadius);
var st=num(sh.strength,R.shadowStrength.min,R.shadowStrength.max,1);put("--appearance-shadow-strength",String(st),st===1);
var ms=num(m.speed,d.motionSpeedRange.min,d.motionSpeedRange.max,1);put("--appearance-motion-speed",String(ms),ms===1);
if(m.enabled===false){document.documentElement.setAttribute("data-motion-off","true");}
}catch(e){}})();`;
}
