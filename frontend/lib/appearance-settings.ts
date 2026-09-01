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

interface AppearanceColorTokens {
  background: string;
  surface: string;
  foreground: string;
  secondaryText: string;
  accent: string;
  border: string;
}

interface AppearanceTypographyTokens {
  /** Multiplier applied to every named Tailwind text size. */
  textScale: number;
  bodyWeight: number;
  headingWeight: number;
}

interface AppearanceLayoutTokens {
  /** Multiplier applied to the Tailwind spacing unit. */
  spaceScale: number;
  /** Corner radius in pixels; drives --radius. */
  cornerRadius: number;
}

interface AppearanceShadowTokens {
  /** Multiplier on the alpha of standard Tailwind box shadows. */
  strength: number;
}

interface AppearanceMotionTokens {
  enabled: boolean;
  /** Multiplier on the default transition duration. */
  speed: number;
}

interface AppearanceSettings {
  version: 1;
  colors: AppearanceColorTokens;
  typography: AppearanceTypographyTokens;
  layout: AppearanceLayoutTokens;
  shadows: AppearanceShadowTokens;
  motion: AppearanceMotionTokens;
}

/**
 * Dark-first palette anchors taken from the .dark block in globals.css.
 * A field equal to its default means "no override": the theme keeps control.
 */
const APPEARANCE_DEFAULTS: AppearanceSettings = Object.freeze({
  colors: Object.freeze({
    accent: "#d0af73",
    background: "#000000",
    border: "#222222",
    foreground: "#ece3d5",
    secondaryText: "#9d917f",
    surface: "#0a0a0a",
  }),
  layout: Object.freeze({
    cornerRadius: 6,
    spaceScale: 1,
  }),
  motion: Object.freeze({
    enabled: true,
    speed: 1,
  }),
  shadows: Object.freeze({
    strength: 1,
  }),
  typography: Object.freeze({
    bodyWeight: 400,
    headingWeight: 600,
    textScale: 1,
  }),
  version: 1,
  }),

/** Numeric slider bounds shared by the model and the settings page controls. */
  APPEARANCE_RANGES = {
  bodyWeight: { max: 700, min: 300, step: 50 },
  cornerRadius: { max: 18, min: 0, step: 1 },
  headingWeight: { max: 800, min: 400, step: 50 },
  motionSpeed: { max: 2, min: 0.5, step: 0.05 },
  shadowStrength: { max: 2, min: 0, step: 0.05 },
  spaceScale: { max: 1.25, min: 0.85, step: 0.05 },
  textScale: { max: 1.3, min: 0.85, step: 0.05 },
  } as const,

  APPEARANCE_STORAGE_KEY = STORAGE_KEYS.APPEARANCE_SETTINGS,

/** Root CSS properties overridden per color token; --ring follows --accent. */
  COLOR_PROPERTY_BY_TOKEN: Record<keyof AppearanceColorTokens, string | string[]> = {
  accent: ["--primary", "--ring"],
  background: "--background",
  border: "--border",
  foreground: "--foreground",
  secondaryText: "--muted-foreground",
  surface: "--card",
},

  HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u,

/** Neutral values that mean "no override" for the numeric root properties. */
  NEUTRAL_NUMBER_BY_PROPERTY: Record<string, number> = {
  "--appearance-text-scale": 1,
  "--appearance-font-weight-body": APPEARANCE_DEFAULTS.typography.bodyWeight,
  "--appearance-font-weight-heading": APPEARANCE_DEFAULTS.typography.headingWeight,
  "--appearance-space-scale": 1,
  // Stored in pixels; applied as rem against a 16px root font size.
  "--radius": APPEARANCE_DEFAULTS.layout.cornerRadius,
  "--appearance-shadow-strength": 1,
  "--appearance-motion-speed": 1,
  };

function getServerAppearanceSettings(): AppearanceSettings {
  // Stable frozen reference required by useSyncExternalStore server snapshots.
  return APPEARANCE_DEFAULTS;
}

function clampNumber(value: unknown, range:Readonly< { min: number; max: number }>, fallback: number): number {
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
function normalizeAppearanceSettings(input: unknown): AppearanceSettings {
  const settings = appearanceInputGroups(input);
  if (settings.source.version !== 1) {
    return { ...APPEARANCE_DEFAULTS };
  }

  return {
    colors: {
      accent: normalizeHexColor(settings.colors.accent, APPEARANCE_DEFAULTS.colors.accent),
      background: normalizeHexColor(settings.colors.background, APPEARANCE_DEFAULTS.colors.background),
      border: normalizeHexColor(settings.colors.border, APPEARANCE_DEFAULTS.colors.border),
      foreground: normalizeHexColor(settings.colors.foreground, APPEARANCE_DEFAULTS.colors.foreground),
      secondaryText: normalizeHexColor(
        settings.colors.secondaryText,
        APPEARANCE_DEFAULTS.colors.secondaryText,
      ),
      surface: normalizeHexColor(settings.colors.surface, APPEARANCE_DEFAULTS.colors.surface),
    },
    layout: {
      cornerRadius: clampNumber(
        settings.layout.cornerRadius,
        APPEARANCE_RANGES.cornerRadius,
        APPEARANCE_DEFAULTS.layout.cornerRadius,
      ),
      spaceScale: snapStep(clampNumber(settings.layout.spaceScale, APPEARANCE_RANGES.spaceScale, 1)),
    },
    motion: {
      enabled: settings.motion.enabled === undefined ? true : settings.motion.enabled === true,
      speed: snapStep(clampNumber(settings.motion.speed, APPEARANCE_RANGES.motionSpeed, 1)),
    },
    shadows: {
      strength: snapStep(clampNumber(settings.shadows.strength, APPEARANCE_RANGES.shadowStrength, 1)),
    },
    typography: {
      bodyWeight: clampNumber(
        settings.typography.bodyWeight,
        APPEARANCE_RANGES.bodyWeight,
        APPEARANCE_DEFAULTS.typography.bodyWeight,
      ),
      headingWeight: clampNumber(
        settings.typography.headingWeight,
        APPEARANCE_RANGES.headingWeight,
        APPEARANCE_DEFAULTS.typography.headingWeight,
      ),
      textScale: snapStep(clampNumber(settings.typography.textScale, APPEARANCE_RANGES.textScale, 1)),
    },
    version: 1,
  };
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function group(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? (value as Record<string, unknown>) : {};
}

function appearanceInputGroups(input: unknown) {
  const source = isPlainObject(input) ? (input as Record<string, unknown>) : {};
  return {
    colors: group(source.colors),
    layout: group(source.layout),
    motion: group(source.motion),
    shadows: group(source.shadows),
    source,
    typography: group(source.typography),
  };
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
    return globalThis.localStorage.getItem(APPEARANCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

let snapshotCache: { raw: string | null; value: AppearanceSettings } | null = null;

function cacheAppearanceSettings(raw: string | null): AppearanceSettings {
  const value = normalizeAppearanceSettings(parseAppearanceStorageValue(raw));
  snapshotCache = { raw, value };
  return value;
}

function parseAppearanceStorageValue(raw: string | null): unknown {
  if (raw === null) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * UseSyncExternalStore-compatible snapshot: parses and validates at most once
 * per stored value, so React sees a stable reference between renders.
 */
function loadAppearanceSettings(): AppearanceSettings {
  const raw = readRawStorageValue();
  if (snapshotCache?.raw === raw) {
    return snapshotCache.value;
  }

  return cacheAppearanceSettings(raw);
}

function subscribeToAppearanceSettings(onChange: () => void): () => void {
  // Reuses the shared storage bus: same-tab custom events plus cross-tab
  // Native storage events.
  return subscribeToStorageKey(APPEARANCE_STORAGE_KEY, onChange);
}

function saveAppearanceSettings(settings: AppearanceSettings): boolean {
  return saveToStorage(APPEARANCE_STORAGE_KEY, settings);
}

/** Remove persisted overrides; the next snapshot falls back to defaults. */
function resetAppearanceSettings(): boolean {
  return removeFromStorage(APPEARANCE_STORAGE_KEY);
}

interface AppliedProperty {
  property: string;
  rendered: string;
  neutral: boolean;
}

function colorProperties(colors: AppearanceColorsInput): AppliedProperty[] {
  const entries: AppliedProperty[] = [];
  for (const token of Object.keys(COLOR_PROPERTY_BY_TOKEN) as (keyof AppearanceColorTokens)[]) {
    const propertyOrProperties = COLOR_PROPERTY_BY_TOKEN[token],
      value = colors[token];
    for (const property of Array.isArray(propertyOrProperties)
      ? propertyOrProperties
      : [propertyOrProperties]) {
      entries.push({
        neutral: value === APPEARANCE_DEFAULTS.colors[token],
        property,
        rendered: value,
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
      neutral: settings.typography.textScale === 1,
      property: "--appearance-text-scale",
      rendered: String(settings.typography.textScale),
    },
    {
      neutral:
        settings.typography.bodyWeight === NEUTRAL_NUMBER_BY_PROPERTY["--appearance-font-weight-body"],
      property: "--appearance-font-weight-body",
      rendered: String(settings.typography.bodyWeight),
    },
    {
      neutral:
        settings.typography.headingWeight ===
        NEUTRAL_NUMBER_BY_PROPERTY["--appearance-font-weight-heading"],
      property: "--appearance-font-weight-heading",
      rendered: String(settings.typography.headingWeight),
    },
    {
      neutral: settings.layout.spaceScale === 1,
      property: "--appearance-space-scale",
      rendered: String(settings.layout.spaceScale),
    },
    {
      neutral: settings.layout.cornerRadius === NEUTRAL_NUMBER_BY_PROPERTY["--radius"],
      property: "--radius",
      rendered: radiusRem,
    },
    {
      neutral: settings.shadows.strength === 1,
      property: "--appearance-shadow-strength",
      rendered: String(settings.shadows.strength),
    },
    {
      neutral: settings.motion.speed === 1,
      property: "--appearance-motion-speed",
      rendered: String(settings.motion.speed),
    },
  ];
}

/**
 * Apply settings as root-level CSS custom properties. Fields equal to their
 * default are removed instead of written, so untouched tokens keep following
 * the light/dark theme classes.
 */
function applyAppearanceSettings(settings: AppearanceSettings): void {
  if (typeof document === "undefined") {
    return;
  }
  const {style} = document.documentElement;

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
function buildAppearanceBootstrapScript(): string {
  const d = JSON.stringify({
    colors: APPEARANCE_DEFAULTS.colors,
    cornerRadius: APPEARANCE_DEFAULTS.layout.cornerRadius,
    motionSpeedRange: APPEARANCE_RANGES.motionSpeed,
    typography: APPEARANCE_DEFAULTS.typography,
  }),
   ranges = JSON.stringify(APPEARANCE_RANGES);

  return `(function(){try{
var d=${d};var R=${ranges};
var raw=globalThis.localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)});
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

export {
  APPEARANCE_DEFAULTS,
  APPEARANCE_RANGES,
  APPEARANCE_STORAGE_KEY,
  applyAppearanceSettings,
  buildAppearanceBootstrapScript,
  getServerAppearanceSettings,
  loadAppearanceSettings,
  normalizeAppearanceSettings,
  resetAppearanceSettings,
  saveAppearanceSettings,
  subscribeToAppearanceSettings,
};

export type {
  AppearanceColorTokens,
  AppearanceLayoutTokens,
  AppearanceMotionTokens,
  AppearanceSettings,
  AppearanceShadowTokens,
  AppearanceTypographyTokens,
};
